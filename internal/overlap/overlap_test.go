package overlap

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

var now = time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

func tp(t time.Time) *time.Time { return &t }

// hapi8504 is hapifhir/hapi-fhir#8504 as GitHub described it on 2026-10-20: rasmus0201's #8521 open
// and linked since 2026-10-19T08:28Z, and our own #8530, opened sixteen hours later.
func hapi8504() Facts {
	return Facts{Repo: "hapifhir/hapi-fhir", Number: 8504, State: "OPEN",
		Title: "Accept-Encoding: gzip;q=1.0 does not enable gzip response compression",
		PRs: []PR{
			{Repo: "hapifhir/hapi-fhir", Number: 8521, Title: "[8504] Enable gzip responses when Accept-Encoding uses quality values",
				URL: "https://github.com/hapifhir/hapi-fhir/pull/8521", State: "OPEN", Author: "rasmus0201",
				CreatedAt: time.Date(2026, 10, 19, 8, 28, 25, 0, time.UTC), Cites: true},
			{Repo: "hapifhir/hapi-fhir", Number: 8530, Title: "Fix Accept-Encoding quality parameter handling for gzip",
				URL: "https://github.com/hapifhir/hapi-fhir/pull/8530", State: "OPEN", Author: "FawwazLawal",
				CreatedAt: time.Date(2026, 10, 20, 0, 38, 0, 0, time.UTC), Cites: true},
		}}
}

func TestTheHapiFhirRaceIsReported(t *testing.T) {
	got := Signals(hapi8504(), Target{Repo: "hapifhir/hapi-fhir", Number: 8504, OurPRs: []int{8530}}, "fawwazlawal", now)
	if len(got) != 1 {
		t.Fatalf("want exactly the other PR, got %+v", got)
	}
	s := got[0]
	if s.ID != "pr-8521" || !s.Hard || s.Actor != "rasmus0201" || !s.At.Equal(time.Date(2026, 10, 19, 8, 28, 25, 0, time.UTC)) {
		t.Errorf("signal %+v", s)
	}
	want := "Another pull request cites this issue: #8521 by @rasmus0201, opened 2026-10-19: [8504] Enable gzip responses when Accept-Encoding uses quality values (your PR #8530 is open on this issue)"
	if s.Summary != want {
		t.Errorf("summary\n got  %s\n want %s", s.Summary, want)
	}
}

func TestOnlyOtherPeoplesRecentWorkCounts(t *testing.T) {
	old := now.Add(-200 * 24 * time.Hour)
	f := Facts{Repo: "o/r", Number: 7, State: "OPEN", Title: "Parser drops trailing comments in nested blocks",
		Assignees: []string{"me"},
		Comments: []Comment{
			{Author: "me", Body: "I'll take this", At: now.Add(-time.Hour), URL: "u#issuecomment-1"},
			{Author: "helper", Bot: true, Body: "I'm on it", At: now.Add(-time.Hour), URL: "u#issuecomment-2"},
			{Author: "early", Body: "can I work on this?", At: now.Add(-40 * 24 * time.Hour), URL: "u#issuecomment-3"},
			{Author: "reader", Body: "Same problem here", At: now.Add(-time.Hour), URL: "u#issuecomment-4"},
		},
		PRs: []PR{
			{Number: 1, Author: "me", State: "OPEN", Cites: true, CreatedAt: now},
			{Number: 2, Author: "dependabot", Bot: true, State: "OPEN", Cites: true, CreatedAt: now},
			{Number: 3, Author: "x", State: "CLOSED", Cites: true, CreatedAt: old},
			{Number: 4, Author: "x", State: "MERGED", Cites: true, CreatedAt: old, MergedAt: tp(old)},
			{Number: 5, Author: "y", State: "OPEN", Title: "Parser speedups", CreatedAt: now}, // one shared word
			{Repo: "someone/portfolio", Number: 16, Author: "z", State: "MERGED", Cites: true, CreatedAt: now, MergedAt: tp(now)},
		}}
	if got := Signals(f, Target{}, "Me", now); len(got) != 0 {
		t.Errorf("none of these are someone else's current work: %+v", got)
	}
}

func TestEachKindOfSignal(t *testing.T) {
	f := Facts{Repo: "o/r", Number: 7, State: "CLOSED", StateReason: "COMPLETED", ClosedAt: tp(now.Add(-time.Hour)), ClosedBy: "maint",
		Title:      "[Feature] Configurable output paths for generated reports",
		Assignees:  []string{"alice"},
		AssignedAt: map[string]time.Time{"alice": now.Add(-3 * time.Hour)},
		Comments:   []Comment{{Author: "bob", Body: "I'm working on this, PR soon", At: now.Add(-2 * time.Hour), URL: "https://github.com/o/r/issues/7#issuecomment-99"}},
		PRs: []PR{
			{Repo: "o/r", Number: 10, Author: "carol", State: "OPEN", Title: "[Feature] Configurable output paths", CreatedAt: now.Add(-4 * time.Hour)},
			{Repo: "o/r", Number: 12, Author: "fay", State: "OPEN", Title: "Configurable output for logs", CreatedAt: now}, // 2 of 5 words: noise
			{Repo: "o/r", Number: 13, Author: "gus", State: "CLOSED", Cites: true, Title: "Generated reports path option", CreatedAt: now.Add(-30 * time.Hour)},
			{Repo: "o/r", Number: 11, Author: "dan", State: "OPEN", Title: "[Feature] Paths in docs", CreatedAt: now},
			{Repo: "o/website", Number: 3, Author: "erin", State: "MERGED", Cites: true, Title: "Closes o/r#7", CreatedAt: now.Add(-5 * time.Hour), MergedAt: tp(now.Add(-time.Hour))},
		}}
	byID := map[string]Signal{}
	for _, s := range Signals(f, Target{}, "me", now) {
		byID[s.ID] = s
	}
	for id, summary := range map[string]string{
		"closed":         "Closed as completed by @maint",
		"assigned-alice": "Assigned to @alice",
		"claim-99":       `@bob claimed it in a comment: "I'm working on this, PR soon"`,
		"pr-3":           "A pull request citing this issue was merged: o/website#3 by @erin, merged 2026-10-20: Closes o/r#7",
		"similar-pr-10":  "Worth a look: #10 by @carol (open since 2026-10-20) shares the title words configurable, output, paths: [Feature] Configurable output paths",
		"similar-pr-13":  "Worth a look: #13 by @gus cited this issue and was closed without merging (opened 2026-10-19): Generated reports path option",
	} {
		s, ok := byID[id]
		if !ok {
			t.Errorf("missing %s in %v", id, byID)
			continue
		}
		if s.Summary != summary {
			t.Errorf("%s summary\n got  %s\n want %s", id, s.Summary, summary)
		}
		if s.Hard == strings.HasPrefix(id, "similar") {
			t.Errorf("%s: hard=%v", id, s.Hard)
		}
	}
	if _, ok := byID["similar-pr-11"]; ok {
		t.Error(`"[Feature]" is a tag every title shares, not a subject word`)
	}
	if _, ok := byID["similar-pr-12"]; ok {
		t.Error("two shared words out of five is not the same subject")
	}
	if len(byID) != 6 {
		t.Errorf("got %d signals: %v", len(byID), byID)
	}
}

func TestClosedByOurOwnPRIsNotAConflict(t *testing.T) {
	f := Facts{Repo: "o/r", Number: 7, State: "CLOSED", Closer: &PR{Number: 9, Author: "me"}}
	if got := Signals(f, Target{}, "me", now); len(got) != 0 {
		t.Errorf("our own fix closing it is not someone else's work: %+v", got)
	}
}

func TestKeywordsDropTagsAndScopes(t *testing.T) {
	for title, want := range map[string]string{
		"[Feature] Persian and RTL guidance in harden":                          "persian guidance harden",
		"crypto/x509: clarify VerifyOptions.CertificatePolicies semantics":      "clarify verifyoptions certificatepolicies semantics",
		"fix(ui): Margin in SMTP configuration edition form":                    "margin smtp configuration edition form",
		"Accept-Encoding: gzip;q=1.0 does not enable gzip response compression": "accept encoding gzip enable response compression",
	} {
		if got := strings.Join(Keywords(title), " "); got != want {
			t.Errorf("%q: got %q want %q", title, got, want)
		}
	}
}

func TestChooseReportsOnceAndQuietly(t *testing.T) {
	claim := Signal{ID: "claim-1", Hard: true, At: now.Add(-time.Hour)}
	pr := Signal{ID: "pr-8", Hard: true, At: now.Add(-2 * time.Hour)}
	similar := Signal{ID: "similar-pr-8", At: now.Add(-3 * time.Hour)}
	other := Signal{ID: "similar-pr-9", At: now.Add(-4 * time.Hour)}

	if got := Choose([]Signal{claim, pr, similar}, Prior{}); got == nil || got.ID != "pr-8" {
		t.Errorf("the earliest thing that happened is reported, not a soft match: %+v", got)
	}
	if got := Choose([]Signal{claim, pr}, Prior{Hard: []string{"pr-8"}}); got != nil {
		t.Errorf("after the first report nothing more is said about the issue: %+v", got)
	}
	if got := Choose([]Signal{similar, other}, Prior{}); got == nil || got.ID != "similar-pr-9" {
		t.Errorf("one soft match when nothing has happened: %+v", got)
	}
	if got := Choose([]Signal{similar, other}, Prior{Soft: []string{"similar-pr-9"}}); got != nil {
		t.Errorf("a soft match is worth one entry per issue, ever: %+v", got)
	}
	if got := Choose([]Signal{pr}, Prior{Soft: []string{"similar-pr-8"}}); got != nil {
		t.Errorf("the same pull request is never reported twice against one issue: %+v", got)
	}
	if got := Choose([]Signal{pr, claim}, Prior{Soft: []string{"similar-pr-8"}}); got == nil || got.ID != "claim-1" {
		t.Errorf("something else happening is still worth one report: %+v", got)
	}
}

// fakeGitHub answers the watcher's two requests from canned issue and search data.
func fakeGitHub(t *testing.T, issue string) *github.Client {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var req struct{ Query string }
		json.Unmarshal(b, &req)
		if strings.Contains(req.Query, "...facts") {
			if !strings.Contains(req.Query, `"repo:hapifhir/hapi-fhir is:pr 8504 in:title"`) {
				t.Errorf("cite search missing from %s", req.Query)
			}
			io.WriteString(w, `{"data":{"rateLimit":{"cost":1,"remaining":4999},"i0":{"issue":`+issue+`},
				"c0":{"nodes":[{"__typename":"PullRequest","number":8521,"title":"[8504] Enable gzip responses","url":"https://github.com/hapifhir/hapi-fhir/pull/8521","state":"OPEN","createdAt":"2026-10-19T08:28:25Z","author":{"login":"rasmus0201","__typename":"User"},"repository":{"nameWithOwner":"hapifhir/hapi-fhir"}},
				{"__typename":"PullRequest","number":3622,"title":"Freetext search tag types support","url":"u","state":"OPEN","createdAt":"2026-10-01T00:00:00Z","author":{"login":"x","__typename":"User"},"repository":{"nameWithOwner":"hapifhir/hapi-fhir"}}]},
				"i1":{"issue":null}},"errors":[{"message":"Could not resolve to an Issue with the number of 1."}]}`)
			return
		}
		if !strings.Contains(req.Query, "in:title accept OR encoding OR gzip OR enable OR response OR compression") {
			t.Errorf("subject search %s", req.Query)
		}
		io.WriteString(w, `{"data":{"rateLimit":{"cost":1,"remaining":4998},"s0":{"nodes":[
			{"__typename":"PullRequest","number":8600,"title":"Response compression for bulk export","url":"https://github.com/hapifhir/hapi-fhir/pull/8600","state":"OPEN","createdAt":"2026-10-20T09:00:00Z","author":{"login":"z","__typename":"User"},"repository":{"nameWithOwner":"hapifhir/hapi-fhir"}}]}}}`)
	}))
	t.Cleanup(srv.Close)
	gh := github.New("test")
	gh.BaseURL = srv.URL
	return gh
}

func TestRunReportsOnceAcrossRuns(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	issue := `{"number":8504,"title":"Accept-Encoding: gzip;q=1.0 does not enable gzip response compression","state":"OPEN",
		"assignees":{"nodes":[]},"closedByPullRequestsReferences":{"nodes":[]},"timelineItems":{"nodes":[]},"comments":{"nodes":[]}}`
	w := &Watcher{GH: fakeGitHub(t, issue), Store: st, Now: func() time.Time { return now }}
	targets := []Target{{Repo: "hapifhir/hapi-fhir", Number: 8504}, {Repo: "o/r", Number: 1}, {Repo: "bad repo", Number: 2}}

	if _, ready := w.Watching(); ready {
		t.Error("not ready before the first run")
	}
	res, err := w.Run(context.Background(), "FawwazLawal", targets)
	if err != nil {
		t.Fatal(err)
	}
	if res.Checked != 1 || res.Cost != 2 || res.Remaining != 4998 || len(res.Skipped) != 2 {
		t.Errorf("result %+v", res)
	}
	if len(res.Reported) != 1 || res.Reported[0].Signal != "pr-8521" {
		t.Fatalf("the title citation [8504] is the report, ahead of the similar title: %+v", res.Reported)
	}
	again, _ := w.Run(context.Background(), "FawwazLawal", targets)
	if len(again.Reported) != 0 {
		t.Errorf("a second run must not report again: %+v", again.Reported)
	}
	rows, _ := st.Overlaps()
	if len(rows) != 1 {
		t.Errorf("stored %+v", rows)
	}
	watching, ready := w.Watching()
	if !ready || !watching["hapifhir/hapi-fhir#8504"] || !watching["o/r#1"] || watching["bad repo#2"] {
		t.Errorf("watching %v ready %v", watching, ready)
	}
}

// Pairs from the first live run on 2026-10-21 that shared two title words and nothing else.
func TestRealNoiseStaysQuiet(t *testing.T) {
	for issue, pr := range map[string]PR{
		"cmd/go,testing,doc: better information about debugging test cache failures": {Number: 70254, State: "OPEN",
			Title: "debug/dwarf: improve error when debugging information is absent", CreatedAt: now.Add(-700 * 24 * time.Hour)},
		"fix(ui): trash lines popover does not have the correct size": {Number: 18337, State: "OPEN",
			Title: "docs: correct JVM options syntax for ELASTIC_MEMORY_SIZE", CreatedAt: now.Add(-33 * 24 * time.Hour)},
		"fix(ui): shift-click on a row checkbox in entity Knowledge views opens the clicked entity in a new window": {Number: 18684, State: "OPEN",
			Title: "feat(history): add knowledge time machine with as-of views, diffs, landscape changes", CreatedAt: now.Add(-17 * 24 * time.Hour)},
		"Batch2 work chunk heartbeat triggers are never unscheduled": {Number: 8441, State: "MERGED", MergedAt: tp(now.Add(-4 * 24 * time.Hour)),
			Title: "Stop in-flight batch2 work before JPA test cleanup purges the database", CreatedAt: now.Add(-9 * 24 * time.Hour)},
	} {
		pr.Author = "someone"
		f := Facts{Repo: "o/r", Number: 1, State: "OPEN", Title: issue, PRs: []PR{pr}}
		if got := Signals(f, Target{}, "me", now); len(got) != 0 {
			t.Errorf("%q vs %q: %+v", issue, pr.Title, got)
		}
	}
}
