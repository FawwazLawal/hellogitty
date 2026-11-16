package poller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

// retryHarness runs PollAll with a scripted per-repository check: each call for a repository
// takes the next error in its script (nil is success) and reports fixed page counts. GitHub
// itself is a server that answers every other request with an empty list.
type retryHarness struct {
	p     *Poller
	calls map[string]int
	slept []time.Duration
	// seen is the per-request issue timeout carried on each check's context, 0 when none was set.
	seen []time.Duration
	// prSeen is the per-request PR timeout the PollAll loop attached via withPRBudget before
	// handing the context to pollTarget, 0 when none was set. The two are tracked separately
	// because the PR-timeout fix (#355) separates the issue and PR budgets per cycle.
	prSeen []time.Duration
	// prPages is the PR-page count each scripted call reports (sibling of pages). Keyed by
	// lowercase "owner/name"; omitted keys report 0.
	prPages map[string]int
}

func newRetryHarness(t *testing.T, script map[string][]error, pages map[string]int) *retryHarness {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `[]`) }))
	t.Cleanup(srv.Close)
	st, err := store.Open(filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	gh := github.New("t")
	gh.BaseURL = srv.URL

	var targets []Target
	for key := range script {
		owner, name, _ := strings.Cut(key, "/")
		targets = append(targets, Target{Owner: owner, Name: name})
	}
	sort.Slice(targets, func(i, j int) bool { return targets[i].Owner+targets[i].Name < targets[j].Owner+targets[j].Name })

	h := &retryHarness{calls: map[string]int{}, prPages: map[string]int{}}
	h.p = &Poller{GH: gh, Store: st, RetryBackoff: 7 * time.Second,
		Targets: func() ([]Target, error) { return targets, nil }}
	h.p.sleep = func(_ context.Context, d time.Duration) error { h.slept = append(h.slept, d); return nil }
	h.p.poll = func(ctx context.Context, tg Target) (*IssueTotals, int, int, error) {
		key := strings.ToLower(tg.Owner + "/" + tg.Name)
		n := h.calls[key]
		h.calls[key] = n + 1
		d, _ := github.RequestTimeoutFrom(ctx)
		h.seen = append(h.seen, d)
		pd, _ := prBudgetFrom(ctx)
		h.prSeen = append(h.prSeen, pd)
		var err error
		if errs := script[key]; n < len(errs) {
			err = errs[n]
		}
		return nil, pages[key], h.prPages[key], err
	}
	return h
}

func TestPollAllRetriesTimedOutRepositoryOnce(t *testing.T) {
	h := newRetryHarness(t, map[string][]error{"o/r": {context.DeadlineExceeded}}, nil)
	if err := h.p.PollAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	ps := h.p.Status()
	if len(ps.Errors) != 0 {
		t.Errorf("a timeout that passed on retry must not count as an error: %v", ps.Errors)
	}
	if got := ps.Retried["o/r"]; !strings.Contains(got, "deadline") {
		t.Errorf("Retried[o/r] = %q, want the first error recorded", got)
	}
	if h.calls["o/r"] != 2 {
		t.Errorf("check called %d times, want 2 (one retry)", h.calls["o/r"])
	}
	if len(h.slept) != 1 || h.slept[0] != 7*time.Second {
		t.Errorf("slept %v, want one RetryBackoff of 7s before the retry", h.slept)
	}
}

func TestPollAllDoesNotRetryTerminalFailure(t *testing.T) {
	gone := &github.StatusError{Code: 404, URL: "u", Body: "Not Found"}
	h := newRetryHarness(t, map[string][]error{"gone/x": {gone, gone}}, nil)
	if err := h.p.PollAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	ps := h.p.Status()
	if _, failed := ps.Errors["gone/x"]; !failed || len(ps.Retried) != 0 {
		t.Errorf("a 404 is terminal: errors %v retried %v", ps.Errors, ps.Retried)
	}
	if h.calls["gone/x"] != 1 || len(h.slept) != 0 {
		t.Errorf("calls %d slept %v, want one call and no backoff", h.calls["gone/x"], h.slept)
	}
}

func TestPollAllFailureSurvivingRetryIsAnError(t *testing.T) {
	h := newRetryHarness(t, map[string][]error{"o/r": {context.DeadlineExceeded, &github.StatusError{Code: 503}}}, nil)
	if err := h.p.PollAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	ps := h.p.Status()
	if got := ps.Errors["o/r"]; !strings.Contains(got, "503") {
		t.Errorf("Errors[o/r] = %q, want the error the retry hit", got)
	}
	if len(ps.Retried) != 0 || h.calls["o/r"] != 2 {
		t.Errorf("retried %v calls %d, want nothing recovered and exactly one retry", ps.Retried, h.calls["o/r"])
	}
}

func TestRequestTimeoutScalesWithPages(t *testing.T) {
	for pages, want := range map[int]time.Duration{0: 30 * time.Second, 1: 30 * time.Second, 4: 60 * time.Second, 10: 120 * time.Second, 50: 120 * time.Second} {
		if got := requestTimeoutFor(pages); got != want {
			t.Errorf("requestTimeoutFor(%d) = %s, want %s", pages, got, want)
		}
	}
}

func TestPollAllSizesTimeoutFromLastCyclePages(t *testing.T) {
	h := newRetryHarness(t, map[string][]error{"big/repo": nil}, map[string]int{"big/repo": 10})
	for i := 0; i < 2; i++ {
		if err := h.p.PollAll(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if got := h.p.Status().Pages["big/repo"]; got != 10 {
		t.Errorf("Pages[big/repo] = %d, want 10", got)
	}
	if len(h.seen) != 2 || h.seen[0] != 0 || h.seen[1] != 120*time.Second {
		t.Errorf("request timeouts seen %v, want [0 2m0s]: unknown size first, then sized from last cycle", h.seen)
	}
}

// TestPollAllSizesPRTimeoutFromLastCyclePRPages covers the PR-phase analogue of the issue test
// above: with N PR pages recorded last cycle, the next cycle wraps the ctx with a PR-sized
// budget (requestTimeoutFor on PR pages), visible to pollTarget via prBudgetFrom. This is
// The #355 fix: before this change the PR phase inherited the issue-sized budget, so a repo
// with few issues but deep PR history (meshtastic, coraza, ripple/explorer per the
// measurements in #355) burned ~138s per cycle on a budget sized for its issue pagination.
func TestPollAllSizesPRTimeoutFromLastCyclePRPages(t *testing.T) {
	h := newRetryHarness(t, map[string][]error{"meshtastic/meshtastic": nil}, nil)
	h.prPages["meshtastic/meshtastic"] = 10
	for i := 0; i < 2; i++ {
		if err := h.p.PollAll(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if got := h.p.Status().PRPages["meshtastic/meshtastic"]; got != 10 {
		t.Errorf("PRPages[meshtastic/meshtastic] = %d, want 10 (what the harness reports)", got)
	}
	if len(h.prSeen) != 2 || h.prSeen[0] != 0 || h.prSeen[1] != 120*time.Second {
		t.Errorf("PR request timeouts seen %v, want [0 2m0s]: unknown first, then sized from last cycle's PR pages", h.prSeen)
	}
}

// TestPollAllSkipsRetryWhenPRBudgetAtCapAndDeadlineExceeded covers the second half of the
// #355 fix: when a repo's PR-page count is already at the cap (requestTimeoutFor >=
// maxRequestTimeout), a DeadlineExceeded this cycle is NOT retried — a second ~138s attempt
// cannot buy more time (measurements showed ~150s wasted per such retry, 28–32% of a
// 100-minute cycle). The repo's Errors row carries the first error; no backoff sleep is spent.
func TestPollAllSkipsRetryWhenPRBudgetAtCapAndDeadlineExceeded(t *testing.T) {
	// Seed: one previous cycle in which the harness reported PR pages at the cap-triggering
	// count (10 pages → 120s budget), so this cycle's PollAll reads it off Status.PRPages.
	h := newRetryHarness(t, map[string][]error{"deep/prs": {nil, context.DeadlineExceeded}}, nil)
	h.prPages["deep/prs"] = 10
	// First cycle: succeeds, records PRPages=10.
	if err := h.p.PollAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := h.p.Status().PRPages["deep/prs"]; got != 10 {
		t.Fatalf("after cycle 1: PRPages[deep/prs] = %d, want 10", got)
	}
	// Second cycle: hits DeadlineExceeded on the only attempt; the fix skips the retry because
	// the budget is already at the cap.
	if err := h.p.PollAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	st := h.p.Status()
	if got, want := h.calls["deep/prs"], 2; got != want {
		t.Errorf("total calls = %d, want %d (one call per cycle; no retry on cycle 2)", got, want)
	}
	if len(h.slept) != 0 {
		t.Errorf("slept %v, want none — the skipped retry costs no backoff", h.slept)
	}
	if _, failed := st.Errors["deep/prs"]; !failed {
		t.Errorf("Errors[deep/prs] is unset; a skipped-retry failure must still record as failed")
	}
	if len(st.Retried) != 0 {
		t.Errorf("Retried = %v, want empty — the retry was intentionally skipped, not attempted and failed", st.Retried)
	}
}

// TestPollAllRetriesPRDeadlineWhenBelowCap is the inverse guard: a DeadlineExceeded that
// arrives with the PR budget BELOW the cap still earns the usual retry. Prevents the skip
// from firing on repos where a bigger budget next cycle would actually help.
func TestPollAllRetriesPRDeadlineWhenBelowCap(t *testing.T) {
	// 3 PR pages last cycle → requestTimeoutFor(3) = 50s, below the 120s cap.
	h := newRetryHarness(t, map[string][]error{"shallow/prs": {nil, context.DeadlineExceeded}}, nil)
	h.prPages["shallow/prs"] = 3
	if err := h.p.PollAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := h.p.PollAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if h.calls["shallow/prs"] != 3 {
		t.Errorf("total calls = %d, want 3 (one cycle 1 + two cycle 2 attempts via retry)", h.calls["shallow/prs"])
	}
	if len(h.slept) != 1 {
		t.Errorf("slept %v, want one RetryBackoff (retry was attempted)", h.slept)
	}
}
