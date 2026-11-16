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
// takes the next error in its script (nil is success) and reports a fixed page count. GitHub
// itself is a server that answers every other request with an empty list.
type retryHarness struct {
	p     *Poller
	calls map[string]int
	slept []time.Duration
	// seen is the per-request timeout carried on each check's context, 0 when none was set.
	seen []time.Duration
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

	h := &retryHarness{calls: map[string]int{}}
	h.p = &Poller{GH: gh, Store: st, RetryBackoff: 7 * time.Second,
		Targets: func() ([]Target, error) { return targets, nil }}
	h.p.sleep = func(_ context.Context, d time.Duration) error { h.slept = append(h.slept, d); return nil }
	h.p.poll = func(ctx context.Context, tg Target) (*IssueTotals, int, error) {
		key := strings.ToLower(tg.Owner + "/" + tg.Name)
		n := h.calls[key]
		h.calls[key] = n + 1
		d, _ := github.RequestTimeoutFrom(ctx)
		h.seen = append(h.seen, d)
		var err error
		if errs := script[key]; n < len(errs) {
			err = errs[n]
		}
		return nil, pages[key], err
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
