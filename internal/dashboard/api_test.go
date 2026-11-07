package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The API is the Phase 3 contract. These hold the parts of it that are
// promises to the client rather than incidental behaviour.
func TestDashboardAPIContract(t *testing.T) {
	h := handler(fakeSource{})

	rec := httptest.NewRecorder()
	h.serveDashboardAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/dashboard.json", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	// no-store, because these figures move on every poll. A cached document is
	// a dashboard that quietly stops updating, which is the failure mode
	// hardest to notice: it looks exactly like nothing happening.
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store — a cached dashboard looks identical to an idle one", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}

	var doc DashboardAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}

	if len(doc.KPIs) != 4 {
		t.Fatalf("got %d KPIs, want 4 — the rail renders exactly four tiles", len(doc.KPIs))
	}
	wantIDs := []string{"needs", "prs", "repos", "api"}
	for i, want := range wantIDs {
		if doc.KPIs[i].ID != want {
			t.Errorf("KPI %d id = %q, want %q — the client matches tiles by id and order is the contract", i, doc.KPIs[i].ID, want)
		}
	}

	// generatedAt must be a full instant or empty, never a time of day. The
	// first version of this endpoint returned "00:44:56Z" — the string the
	// template prints in its footer — from which no client can compute
	// staleness, and which silently reads as "today" across midnight.
	if doc.GeneratedAt != "" {
		if !strings.Contains(doc.GeneratedAt, "T") || !strings.HasSuffix(doc.GeneratedAt, "Z") {
			t.Errorf("generatedAt = %q, want RFC 3339 or empty — a time of day cannot express staleness", doc.GeneratedAt)
		}
	}
}

// The document must never leak the acknowledgement token. It exists on the
// page struct this projection is built from, and marshalling that struct
// directly — the obvious shortcut — would publish it.
func TestDashboardAPIDoesNotLeakTheToken(t *testing.T) {
	h := handler(fakeSource{})

	// token is derived, not settable — so compare against the real one the
	// page would carry rather than planting a value.
	secret := h.token()
	if secret == "" {
		t.Skip("this build derives no acknowledgement token, so there is nothing to leak")
	}

	rec := httptest.NewRecorder()
	h.serveDashboardAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/dashboard.json", nil))

	if strings.Contains(rec.Body.String(), secret) {
		t.Fatal("the acknowledgement token appears in the public JSON document — this endpoint must be a projection, never the view model marshalled whole")
	}
}

// Writes have no business here.
func TestDashboardAPIRejectsWrites(t *testing.T) {
	h := handler(fakeSource{})
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := httptest.NewRecorder()
		h.serveDashboardAPI(rec, httptest.NewRequest(m, "/app/api/dashboard.json", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s = %d, want 405", m, rec.Code)
		}
		if got := rec.Header().Get("Allow"); got != "GET, HEAD" {
			t.Errorf("%s Allow = %q, want \"GET, HEAD\"", m, got)
		}
	}
}

// An unknown figure must stay distinguishable from a real zero all the way to
// the wire. Flattening it is the one bug in this endpoint that would be
// invisible in the UI and wrong in the worst direction: "nothing needs you".
func TestDashboardAPIKeepsUnknownDistinctFromZero(t *testing.T) {
	h := handler(fakeSource{})

	rec := httptest.NewRecorder()
	h.serveDashboardAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/dashboard.json", nil))

	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	kpis, ok := raw["kpis"].([]any)
	if !ok || len(kpis) == 0 {
		t.Fatal("no kpis in the document")
	}
	for _, k := range kpis {
		m, ok := k.(map[string]any)
		if !ok {
			t.Fatalf("kpi is not an object: %#v", k)
		}
		if _, present := m["known"]; !present {
			t.Fatalf("kpi %v has no `known` field — without it the client cannot tell an unfetched figure from a real zero, and renders 'nothing needs you'", m["id"])
		}
	}
}

// Empty collections must be [] and never null.
//
// A nil Go slice encodes as JSON null, and a client writing the obvious
// `doc.repos.map(...)` crashes on a dashboard that simply tracks nothing yet.
// Making "none" and "some" the same shape means the empty case needs no
// special handling on the client and so cannot be forgotten there.
func TestDashboardAPIEmptyCollectionsAreArrays(t *testing.T) {
	h := handler(fakeSource{})

	rec := httptest.NewRecorder()
	h.serveDashboardAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/dashboard.json", nil))

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	for _, field := range []string{"repos", "stageHeads", "kpis"} {
		v, ok := raw[field]
		if !ok {
			t.Errorf("%q missing from the document", field)
			continue
		}
		if string(v) == "null" {
			t.Errorf("%q is null; it must be [] so a client can map over it without a guard", field)
		}
	}

	// And per-row, where the same nil-slice trap repeats one level down.
	var doc DashboardAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	for _, r := range doc.Repos {
		if r.Stages == nil {
			t.Errorf("repo %s/%s has null stages; it must be []", r.Owner, r.Name)
		}
	}
}

// The settings document is read-only and leaks nothing it should not.
func TestSettingsAPIIsReadOnly(t *testing.T) {
	h := handler(fakeSource{})
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		rec := httptest.NewRecorder()
		h.serveSettingsAPI(rec, httptest.NewRequest(m, "/app/api/settings.json", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s = %d, want 405 — this endpoint reads; writes go to /repos/add and /repos/remove", m, rec.Code)
		}
	}
}

// The settings document shows paths, never contents, and never the token.
func TestSettingsAPICarriesNoSecrets(t *testing.T) {
	h := handler(fakeSource{})
	rec := httptest.NewRecorder()
	h.serveSettingsAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/settings.json", nil))

	body := rec.Body.String()
	if tok := h.token(); tok != "" && strings.Contains(body, tok) {
		t.Error("the acknowledgement token appears in the settings document; it belongs only in /app/api/session.json")
	}
	// The GitHub token must never appear anywhere near this.
	if strings.Contains(strings.ToLower(body), "ghp_") || strings.Contains(strings.ToLower(body), "github_pat_") {
		t.Error("something shaped like a GitHub token is in the settings document")
	}
}

// The session document is the only one that carries the write token, and it
// says whether writing is possible at all rather than offering an action that
// 404s.
func TestSessionAPI(t *testing.T) {
	h := handler(fakeSource{})
	rec := httptest.NewRecorder()
	h.serveSessionAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/session.json", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store — a cached credential outlives the process that issued it", got)
	}
	var doc Session
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if doc.Token == "" && h.token() != "" {
		t.Error("the session document carries no token, so no write from the React UI can be authorised")
	}

	rec = httptest.NewRecorder()
	h.serveSessionAPI(rec, httptest.NewRequest(http.MethodPost, "/app/api/session.json", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST = %d, want 405", rec.Code)
	}
}

// A repository removed through the UI must leave the tracked list immediately,
// even though the snapshot still holds it until the next poll.
//
// Listing the snapshot alone made removal look like it had failed: the request
// answered 200 and the row stayed, because the poller writes the snapshot and
// had not run again. The subtraction is what makes the action visible.
func TestSettingsAPISubtractsRemovedFromTracked(t *testing.T) {
	h := handler(fakeSource{})

	rec := httptest.NewRecorder()
	h.serveSettingsAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/settings.json", nil))
	var before SettingsAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &before); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if before.Repos.Removed == nil {
		t.Error("`removed` is null; it must be [] so the client can iterate it without a guard")
	}
	if before.Repos.Count != len(before.Repos.Tracked) {
		t.Errorf("count %d does not match the tracked list of %d — the count must describe what is shown",
			before.Repos.Count, len(before.Repos.Tracked))
	}
	for _, r := range before.Repos.Tracked {
		for _, gone := range before.Repos.Removed {
			if strings.EqualFold(r, gone) {
				t.Errorf("%s appears in both tracked and removed; a removed repository must leave the tracked list", r)
			}
		}
	}
}

// The pipeline document must keep the funnel the page was reorganised into.
//
// PR #222 fixed the owner's complaint that eleven numbers sat as peers and
// "do not seem like they're coherent numbers" — several were subsets of Open,
// so they summed to nothing. The fix separated lifetime totals from what is
// open now and demoted the subsets to table filters.
//
// A flat document would let a React page quietly reintroduce exactly that, by
// rendering the subsets beside their own parent again. The shape is the fix,
// so the shape is what this holds.
func TestPipelineAPIKeepsTheFunnelSeparation(t *testing.T) {
	h := handler(fakeSource{pipe: pipeFixture(t)})

	rec := httptest.NewRecorder()
	h.servePipelineAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/pipeline.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}

	// Lifetime and open-now are separate objects, not eleven sibling integers.
	for _, group := range []string{"lifetime", "openNow"} {
		if _, ok := raw[group]; !ok {
			t.Errorf("no %q group — the funnel separation is the fix for the owner's complaint, and a flat document loses it", group)
		}
	}
	// The subsets live under openNow, never at the top level beside it.
	for _, subset := range []string{"pending", "approved", "draft", "open", "opened", "merged", "closed"} {
		if _, ok := raw[subset]; ok {
			t.Errorf("%q is a top-level field; it belongs inside lifetime or openNow, because a subset rendered beside its parent is what made these numbers incoherent", subset)
		}
	}

	var doc PipelinePageAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if doc.PullRequests == nil || doc.Repos == nil {
		t.Error("pullRequests or repos is null; both must be [] so a client can iterate without a guard")
	}
	// Each subset counts a subset of Open — never more than it.
	if doc.OpenNow.Open > 0 {
		for name, n := range map[string]int{
			"pending":  doc.OpenNow.Pending,
			"approved": doc.OpenNow.Approved,
			"draft":    doc.OpenNow.Draft,
		} {
			if n > doc.OpenNow.Open {
				t.Errorf("%s is %d with only %d open; a subset cannot exceed the set it is part of", name, n, doc.OpenNow.Open)
			}
		}
	}
}

// Derived predicates are computed once, on the server.
//
// "A requested review waits on the reviewer, so it does not count as pending"
// is a rule. Restating it in TypeScript gives it two homes and one of them
// will drift.
func TestPipelineAPIDerivesPredicatesServerSide(t *testing.T) {
	h := handler(fakeSource{pipe: pipeFixture(t)})
	rec := httptest.NewRecorder()
	h.servePipelineAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/pipeline.json", nil))

	var doc PipelinePageAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	for _, pr := range doc.PullRequests {
		if pr.ChecksFailing != (pr.Checks == "FAILURE" || pr.Checks == "ERROR") {
			t.Errorf("%s#%d: checksFailing=%v disagrees with checks=%q", pr.Repo, pr.Number, pr.ChecksFailing, pr.Checks)
		}
		if pr.Approved != (pr.ReviewDecision == "APPROVED") {
			t.Errorf("%s#%d: approved=%v disagrees with reviewDecision=%q", pr.Repo, pr.Number, pr.Approved, pr.ReviewDecision)
		}
		// A pull request waiting only on a reviewer is not pending on us.
		if pr.Pending && pr.UnresolvedThreads == 0 && pr.ReviewDecision != "CHANGES_REQUESTED" && !pr.ChecksFailing {
			t.Errorf("%s#%d is marked pending with nothing waiting on us", pr.Repo, pr.Number)
		}
	}
}

// The work board keeps its groups apart.
//
// "Waiting on you" and "waiting on them" is the question this page exists to
// answer; one merged list sorted by date answers a different one, which you
// could get from GitHub directly. Done and Dismissed are separate for the same
// reason — finished is not set aside, and only one of them can be restored.
func TestWorkAPIKeepsGroupsApart(t *testing.T) {
	h := handler(fakeSource{})
	rec := httptest.NewRecorder()
	h.serveWorkAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/work.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200", rec.Code)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	for _, group := range []string{"you", "them", "done", "dismissed"} {
		v, ok := raw[group]
		if !ok {
			t.Errorf("no %q group — merging the groups answers a different question than this page asks", group)
			continue
		}
		if string(v) == "null" {
			t.Errorf("%q is null; it must be [] so the client can iterate without a guard", group)
		}
	}
	// A single flat list would be the regression: it must not appear.
	if _, ok := raw["items"]; ok {
		t.Error("a flat `items` list is present; the groups are the page, and flattening them loses the question it answers")
	}

	var doc WorkPageAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	// Known and Partial are different states and both must survive the wire:
	// "no board yet" is not "half a board".
	if !doc.Known && doc.Partial {
		t.Error("partial is true while known is false; a board that has never been fetched cannot be half-fetched")
	}
	for _, r := range doc.You {
		if r.Labels == nil {
			t.Errorf("%s#%d has null labels; it must be []", r.Repo, r.Number)
		}
	}
}

// Reads only. Restoring goes to /cells/restore, which already exists.
func TestWorkAPIIsReadOnly(t *testing.T) {
	h := handler(fakeSource{})
	for _, m := range []string{http.MethodPost, http.MethodDelete} {
		rec := httptest.NewRecorder()
		h.serveWorkAPI(rec, httptest.NewRequest(m, "/app/api/work.json", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s = %d, want 405", m, rec.Code)
		}
	}
}
