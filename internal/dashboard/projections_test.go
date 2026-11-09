package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/security"
	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/web"
)

// securityFeedSource wraps fakeSource with a controllable Security feed. The
// base fake only returns an empty one, which is enough for most other tests
// but blanks the assertion we're after here.
type securityFeedSource struct {
	fakeSource
	feed security.Feed
}

func (s securityFeedSource) Security() security.Feed { return s.feed }

// The three fields the Checks panel reads off /app/api/settings.json:
// polling.workIntervalMinutes, polling.lastCycleMs, api.callsPerCycle.
//
// Each has its own "unknown is not zero" story. workIntervalMinutes is
// configured once at startup and is zero only when the operator did not set
// it — a real 0, in that case, means "no work loop", and the client renders
// an em-dash for that too. lastCycleMs and callsPerCycle are zero before
// the first repo-poll cycle has completed; the companion `polling.known`
// flag already distinguishes "no poll yet" from "last poll was quick", so
// a separate `cycleKnown` would be redundant.
func TestSettingsAPICarriesCycleProjections(t *testing.T) {
	now := time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC)
	poll := now.Add(-30 * time.Second)
	h := &Handler{
		Template: web.Index,
		Source: fakeSource{
			reports: []store.RepoReport{
				{Repo: store.Repo{Owner: "acme", Name: "rocket", Status: "active", LastPoll: &poll}},
			},
			tel: Telemetry{
				LastPoll:      poll,
				CycleDuration: 1250 * time.Millisecond,
				CycleRequests: 42,
				RateLimit:     5000,
				RateRemaining: 4958,
				RateReset:     now.Add(30 * time.Minute),
			},
		},
		PollInterval: 5 * time.Minute,
		WorkRefresh:  2 * time.Minute,
		Version:      "V0.1.0 · PROJECTIONS",
		Now:          func() time.Time { return now },
	}

	rec := httptest.NewRecorder()
	h.serveSettingsAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/settings.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	// Read the raw bytes before decoding to a struct — the zod schema on the
	// client is wire-level, so a MISSING field coerces to undefined there in
	// a way a struct decode would quietly fill with a zero.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	var polling, api map[string]json.RawMessage
	if err := json.Unmarshal(raw["polling"], &polling); err != nil {
		t.Fatalf("bad polling block: %v", err)
	}
	if err := json.Unmarshal(raw["api"], &api); err != nil {
		t.Fatalf("bad api block: %v", err)
	}
	for _, key := range []string{"workIntervalMinutes", "lastCycleMs"} {
		if _, ok := polling[key]; !ok {
			t.Errorf("polling.%s missing on the wire — the Checks panel cannot render what is not there", key)
		}
	}
	if _, ok := api["callsPerCycle"]; !ok {
		t.Error(`api.callsPerCycle missing on the wire — the Checks panel renders "API calls per check" off this field`)
	}

	var doc SettingsAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	if doc.Polling.WorkIntervalMinutes != 2 {
		t.Errorf("polling.workIntervalMinutes = %d, want 2 — Handler.WorkRefresh was 2m", doc.Polling.WorkIntervalMinutes)
	}
	if doc.Polling.LastCycleMs != 1250 {
		t.Errorf("polling.lastCycleMs = %d, want 1250 — tel.CycleDuration was 1.25s", doc.Polling.LastCycleMs)
	}
	if doc.API.CallsPerCycle != 42 {
		t.Errorf("api.callsPerCycle = %d, want 42 — tel.CycleRequests was 42", doc.API.CallsPerCycle)
	}
}

// Before the first repo-poll cycle has completed, tel.CycleDuration is zero
// and the projection fields must stay zero too. The companion `polling.known`
// flag carries the signal, so a client that renders unknown as em-dash reads
// these zeros honestly — but only as long as they ARE zero rather than a
// stale value from a previous process.
func TestSettingsAPICycleFieldsZeroBeforeFirstCycle(t *testing.T) {
	h := &Handler{
		Template:     web.Index,
		Source:       fakeSource{},
		PollInterval: time.Hour,
		WorkRefresh:  5 * time.Minute,
	}

	rec := httptest.NewRecorder()
	h.serveSettingsAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/settings.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200", rec.Code)
	}
	var doc SettingsAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	if doc.Polling.Known {
		t.Error("polling.known = true on a fresh handler; without a successful poll the Checks panel must render em-dashes")
	}
	if doc.Polling.LastCycleMs != 0 {
		t.Errorf("polling.lastCycleMs = %d, want 0 before the first cycle", doc.Polling.LastCycleMs)
	}
	if doc.API.CallsPerCycle != 0 {
		t.Errorf("api.callsPerCycle = %d, want 0 before the first cycle", doc.API.CallsPerCycle)
	}
	// WorkIntervalMinutes is startup config, not telemetry; it must carry
	// whatever the Handler was configured with even without a cycle done.
	if doc.Polling.WorkIntervalMinutes != 5 {
		t.Errorf("polling.workIntervalMinutes = %d, want 5 — the field is startup config, not telemetry", doc.Polling.WorkIntervalMinutes)
	}
}

// A real condition that live-tested the first draft of this PR: the poller
// completed a per-repo poll (so tel.LastPoll is set and polling.known is
// true), then the cycle aborted on rate-limit before recording CycleDuration.
// In that state lastCycleMs is 0 even though polling.known is true. The
// client must gate its em-dash on `lastCycleMs == 0`, not on `!known`.
func TestSettingsAPICycleFieldsZeroWhenPollKnownButCycleAborted(t *testing.T) {
	now := time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC)
	poll := now.Add(-30 * time.Second)
	h := &Handler{
		Template: web.Index,
		Source: fakeSource{
			reports: []store.RepoReport{
				{Repo: store.Repo{Owner: "acme", Name: "rocket", Status: "active", LastPoll: &poll}},
			},
			// LastPoll is set — a repo poll finished. CycleDuration stays
			// zero — a rate-limit aborted the cycle before telemetry
			// recorded the duration.
			tel: Telemetry{LastPoll: poll, CycleDuration: 0, CycleRequests: 0},
		},
		PollInterval: time.Hour,
		WorkRefresh:  5 * time.Minute,
		Now:          func() time.Time { return now },
	}

	rec := httptest.NewRecorder()
	h.serveSettingsAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/settings.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200", rec.Code)
	}
	var doc SettingsAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	if !doc.Polling.Known {
		t.Error("polling.known = false, want true — tel.LastPoll was set and that is what carries `known`")
	}
	if doc.Polling.LastCycleMs != 0 {
		t.Errorf("polling.lastCycleMs = %d, want 0 — the cycle aborted before recording a duration", doc.Polling.LastCycleMs)
	}
	if doc.API.CallsPerCycle != 0 {
		t.Errorf("api.callsPerCycle = %d, want 0 — the cycle aborted before recording a call count", doc.API.CallsPerCycle)
	}
}

// /app/api/security.json is read-only and does not vary with poll state. The
// contract is: 200 on GET, 405 on writes, no-store, nosniff, `cves` and
// `tips` always present as arrays (never null), FetchedAt a string.
func TestSecurityAPIContract(t *testing.T) {
	h := handler(fakeSource{})

	rec := httptest.NewRecorder()
	h.serveSecurityAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/security.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}

	// cves and tips must be [] when empty, so a client writing
	// `doc.cves.map(...)` cannot crash on a dashboard with nothing to report.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if string(raw["cves"]) == "null" || len(raw["cves"]) == 0 {
		t.Error(`cves is null or missing — must be [] so the client iterates without a guard`)
	}
	if string(raw["tips"]) == "null" || len(raw["tips"]) == 0 {
		t.Error(`tips is null or missing — must be [] so the client iterates without a guard`)
	}

	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		rec := httptest.NewRecorder()
		h.serveSecurityAPI(rec, httptest.NewRequest(m, "/app/api/security.json", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s = %d, want 405 — this endpoint is read-only", m, rec.Code)
		}
	}
}

// The projection carries the feed verbatim — same CVEs, same tips, same
// FetchedAt — without reshaping anything. The React Security panel renders
// these directly; a translation step here would be a second place for
// vocabulary to drift.
func TestSecurityAPIReflectsFeed(t *testing.T) {
	feed := security.Feed{
		CVEs: []security.CVE{{
			ID:          "CVE-2026-0001",
			Description: "example",
			Severity:    security.High,
			Published:   "2026-11-01T00:00:00Z",
			URL:         "https://example.test/CVE-2026-0001",
			Packages:    []string{"acme"},
		}},
		Tips:      []security.Tip{{Text: "rotate", Level: "warn"}},
		FetchedAt: "2026-11-08T10:00:00Z",
	}
	h := &Handler{
		Template:     web.Index,
		Source:       securityFeedSource{feed: feed},
		PollInterval: time.Hour,
	}

	rec := httptest.NewRecorder()
	h.serveSecurityAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/security.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200", rec.Code)
	}
	var doc SecurityAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	if len(doc.CVEs) != 1 || doc.CVEs[0].ID != "CVE-2026-0001" {
		t.Errorf("cves = %+v, want one entry with ID CVE-2026-0001", doc.CVEs)
	}
	if len(doc.Tips) != 1 || doc.Tips[0].Text != "rotate" {
		t.Errorf("tips = %+v, want one entry with Text \"rotate\"", doc.Tips)
	}
	if doc.FetchedAt != "2026-11-08T10:00:00Z" {
		t.Errorf("fetchedAt = %q, want the feed's own value", doc.FetchedAt)
	}
}

// The Watched array on /app/api/dashboard.json is the row list for the
// Watched panel. Its shape is shared with the alerts endpoint's `claimed` /
// `closed` arrays (one WatchItem type), and the two must not diverge.
func TestDashboardAPICarriesWatchedPanel(t *testing.T) {
	now := time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC)
	poll := now.Add(-30 * time.Second)
	changed := now.Add(-2 * time.Hour)
	reports := []store.RepoReport{
		{
			Repo: store.Repo{Owner: "acme", Name: "rocket", Status: "active", LastPoll: &poll},
			Watch: []store.WatchReport{
				{Number: 1, Title: "fine", Status: "open"},
				{Number: 2, Title: "taken", Status: "claimed", ClaimDetail: "octocat", StatusChangedAt: &changed},
			},
		},
	}
	h := &Handler{
		Template:     web.Index,
		Source:       fakeSource{reports: reports, tel: Telemetry{LastPoll: poll}},
		PollInterval: time.Hour,
		Now:          func() time.Time { return now },
	}

	rec := httptest.NewRecorder()
	h.serveDashboardAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/dashboard.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	var doc DashboardAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	if len(doc.Watched) != 2 {
		t.Fatalf("watched = %d rows, want 2 (the two watch entries on acme/rocket)", len(doc.Watched))
	}

	byNum := map[int]WatchItem{}
	for _, w := range doc.Watched {
		byNum[w.Number] = w
	}
	claimed, ok := byNum[2]
	if !ok {
		t.Fatal("watched: #2 missing — the claimed row must be carried so the panel can style it")
	}
	if claimed.Status != "CLAIMED" {
		t.Errorf("watched #2 status = %q, want CLAIMED — the server's own vocabulary is the contract, not a translated label", claimed.Status)
	}
	if claimed.ClaimDetail != "octocat" {
		t.Errorf("watched #2 claimDetail = %q, want \"octocat\"", claimed.ClaimDetail)
	}
	if claimed.ChangedAt == "" {
		t.Error("watched #2 changedAt is empty — a StatusChangedAt was set and must be carried as RFC 3339")
	}
	if claimed.Repo != "acme/rocket" {
		t.Errorf("watched #2 repo = %q, want \"acme/rocket\"", claimed.Repo)
	}
}

// Empty slice, not nil. A JSON null here would crash a client writing the
// obvious `doc.watched.map(...)`. Same discipline as doc.Repos / doc.StageHeads
// in the same document.
func TestDashboardAPIWatchedIsEmptyArrayNotNull(t *testing.T) {
	h := handler(fakeSource{})

	rec := httptest.NewRecorder()
	h.serveDashboardAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/dashboard.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200", rec.Code)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if _, ok := raw["watched"]; !ok {
		t.Fatal("watched field missing — the React Watched panel cannot render what is not there")
	}
	if string(raw["watched"]) == "null" {
		t.Error("watched is null; must be [] so the client iterates without a guard")
	}
}
