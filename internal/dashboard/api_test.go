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
