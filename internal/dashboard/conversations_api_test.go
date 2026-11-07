package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/work"
	"github.com/FawwazLawal/hellogitty/web"
)

// The /conversations page reads /app/api/work.json, so the work API has to
// carry the conversation groups it used to hide. ADR-UI-002 §4: "add fields to
// the existing projection if needed; do not create a second endpoint computing
// the same thing." This test is the API side of that contract.
//
// THE QUIET LIE this guards against: a wire format where convYou/convThem land
// in the WorkPageAPI type but silently stay empty because the handler never
// wrote them, so the page renders three zero cards and looks fine. The fixture
// below puts a named row in each group; a handler that forgot to populate them
// fails on the specific name, not on a count equal by accident.
func conversationsFixture(now time.Time) *work.Board {
	mk := func(repo string, n int, title, role, move string) work.Item {
		return work.Item{
			PR: false, Repo: repo, Number: n, Title: title, State: "OPEN",
			Role: role, Move: move,
			CreatedAt: now.Add(-72 * time.Hour), UpdatedAt: now.Add(-3 * time.Hour),
			Since: now.Add(-3 * time.Hour),
		}
	}
	return &work.Board{
		Login: "alice", Scope: "repos owned by alice", FetchedAt: now.Add(-time.Minute),
		Sent: []work.Item{
			// A thing the owner opened — this must NOT end up in convYou.
			mk("acme/rocket", 1, "owner's own issue", work.RoleAuthor, work.MoveYou),
			// Joined, waiting on the owner — convYou.
			mk("acme/rocket", 11, "conv-you-marker", work.RoleInvolved, work.MoveYou),
			// Joined, waiting on someone else — convThem.
			mk("other/repo", 22, "conv-them-marker", work.RoleInvolved, work.MoveThem),
		},
	}
}

func TestWorkAPICarriesConversationGroups(t *testing.T) {
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	h := handler(fakeSource{board: conversationsFixture(now)})
	rec := httptest.NewRecorder()
	h.serveWorkAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/work.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200", rec.Code)
	}

	// Unmarshal into the raw map first so a missing field (not just an empty
	// one) is called out specifically: a client with `convYou?.length` would
	// coerce a missing field to zero and lose the signal.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	for _, k := range []string{"convYou", "convThem", "convNew"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("no %q in /app/api/work.json — the conversations page cannot read what is not there", k)
		}
	}
	for _, k := range []string{"convYou", "convThem"} {
		if string(raw[k]) == "null" {
			t.Errorf("%q is null; it must be [] so the client iterates without a guard", k)
		}
	}

	var doc WorkPageAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	// Exactly one row per group, by the title we planted. A handler that wrote
	// Work.You/Them into these fields by mistake would miss the match entirely.
	if got := rowTitles(doc.ConvYou); !sameSet(got, []string{"conv-you-marker"}) {
		t.Errorf("convYou titles = %v, want [conv-you-marker] — authored items must not leak into conversations", got)
	}
	if got := rowTitles(doc.ConvThem); !sameSet(got, []string{"conv-them-marker"}) {
		t.Errorf("convThem titles = %v, want [conv-them-marker]", got)
	}
	// Attn carries the server's reason the row should stand out: the convYou
	// marker is waiting on the owner, so Classify sets Attn="caution".
	for _, r := range doc.ConvYou {
		if r.Attn != "caution" {
			t.Errorf("%s#%d convYou attn = %q, want \"caution\": the row's whole reason to be in this group is that the owner's move is next", r.Repo, r.Number, r.Attn)
		}
	}
	// SinceUnix is a real instant, not the string Ago. A regression that drops
	// this to 0 makes sort-by-updated order the whole page by nothing.
	for _, r := range doc.ConvYou {
		if r.SinceUnix == 0 {
			t.Errorf("%s#%d sinceUnix = 0 even though the row has an UpdatedAt; the client's sort-by-updated depends on this", r.Repo, r.Number)
		}
	}
}

// Unknown is not zero. Before the first work refresh, Known is false and the
// conversation groups MUST come back empty rather than being populated from
// somewhere else; a count of zero on a never-polled board is a real zero when
// the client reads it, and the UI lies with consequences.
func TestWorkAPIConversationsEmptyWhenUnknown(t *testing.T) {
	h := handler(fakeSource{}) // no board at all → Known is false
	rec := httptest.NewRecorder()
	h.serveWorkAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/work.json", nil))
	var doc WorkPageAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	if doc.Known {
		t.Fatalf("known = true with no board; the client reads known to pick em dash vs zero")
	}
	if len(doc.ConvYou) != 0 || len(doc.ConvThem) != 0 || doc.ConvNew != 0 {
		t.Errorf("unknown board produced convYou=%d convThem=%d convNew=%d; all three must be empty so the client cannot mistake them for a cleared inbox",
			len(doc.ConvYou), len(doc.ConvThem), doc.ConvNew)
	}
}

// /conversations is served by the React shell when ReactIsDefault is on, and
// the legacy templated page stays reachable at /legacy/conversations. The two
// must come from DIFFERENT handlers; a config change that leaves /conversations
// pointing at the template silently ships the old page on the new URL.
func TestConversationsRoutingUnderReactDefault(t *testing.T) {
	src := fakeSource{board: conversationsFixture(time.Now())}
	// A handler with React as default AND an App FS to serve.
	h := handler(src)
	h.ReactIsDefault = true
	// The templated conversations page is still compiled in: /legacy keeps it
	// reachable, which is what makes the flag flip survivable.
	h.ConversationsTemplate = web.Conversations
	// A shim index.html is enough: serveAppIndex reads h.App for it.
	h.App = fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte(`<!doctype html><title>react shell</title>`)}}

	code, body := get(t, h, "/conversations")
	if code != http.StatusOK {
		t.Fatalf("/conversations under ReactIsDefault = %d, want 200", code)
	}
	if !strings.Contains(body, "react shell") {
		t.Errorf("/conversations did not serve the React shell; the title marker was missing from the body")
	}

	code, body = get(t, h, "/legacy/conversations")
	if code != http.StatusOK {
		t.Fatalf("/legacy/conversations = %d, want 200", code)
	}
	if strings.Contains(body, "react shell") {
		t.Errorf("/legacy/conversations served the React shell; the templated page must survive the flag")
	}
	if !strings.Contains(body, "Conversations") {
		t.Errorf("/legacy/conversations body missing the templated page title marker")
	}
}

// sameSet reports whether two slices hold the same strings regardless of order.
func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := map[string]int{}
	for _, s := range a {
		m[s]++
	}
	for _, s := range b {
		m[s]--
	}
	for _, v := range m {
		if v != 0 {
			return false
		}
	}
	return true
}

func rowTitles(rows []WorkRow) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Title)
	}
	return out
}
