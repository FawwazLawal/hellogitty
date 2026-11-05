package dashboard

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/pipeline"
	"github.com/FawwazLawal/hellogitty/internal/security"
	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
	"github.com/FawwazLawal/hellogitty/web"
)

type fakeSource struct {
	reports     []store.RepoReport
	tel         Telemetry
	pipe        *pipeline.State
	board       *work.Board
	workErr     string
	workPartial bool
	writes      []WriteStatus
}

func (f fakeSource) Reports() ([]store.RepoReport, error) { return f.reports, nil }
func (f fakeSource) Telemetry() Telemetry                 { return f.tel }
func (f fakeSource) Pipeline() (*pipeline.State, error)   { return f.pipe, nil }
func (f fakeSource) Work() (*work.Board, string, bool)    { return f.board, f.workErr, f.workPartial }
func (f fakeSource) Security() security.Feed              { return security.Feed{} }
func (f fakeSource) WriteStatus() []WriteStatus           { return f.writes }

// pipeFixture is a pipeline with rocket two stages in and lullaby one stage in.
func pipeFixture(t *testing.T) *pipeline.State {
	t.Helper()
	notes := filepath.Join(t.TempDir(), "rocket-notes.md")
	os.WriteFile(notes, []byte("# notes for acme/rocket\n"), 0o644)
	st, err := pipeline.Parse([]byte(`{
		"stages": ["recon", "gate", "select", "build", "review", "pr", "respond"],
		"labels": {"status": "GATE", "notes": "LOG"},
		"repos": {
			"acme/rocket": {"stage": "select", "done": ["recon", "gate"], "label": "PASS", "level": "ok", "notes": ` + strconv.Quote(notes) + `},
			"sleepyco/lullaby": {"stage": "gate", "done": ["recon"]}
		}}`))
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func handler(src fakeSource) *Handler {
	return &Handler{Template: web.Index, Source: src, PollInterval: time.Hour, Version: "V0.1.0 · BLACK BOMBAY", Baby: true}
}

func get(t *testing.T, h http.Handler, path string) (int, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
	b, _ := io.ReadAll(rec.Body)
	return rec.Code, string(b)
}

func TestDashboardEmptyPipelineAndAlarms(t *testing.T) {
	now := time.Date(2026, 10, 19, 4, 0, 0, 0, time.UTC)
	poll := now.Add(-10 * time.Minute)
	old := now.AddDate(0, 0, -226)
	reports := []store.RepoReport{
		{
			Repo:            store.Repo{Owner: "acme", Name: "rocket", Status: "active", LastPoll: &poll, LastCommit: &poll},
			OpenIssuesTotal: 49, OpenIssuesGFI: 4, OpenIssuesUnassigned: 39,
			Watch: []store.WatchReport{
				{Number: 1761, Title: "fine", Status: "open"},
				{Number: 1738, Title: "taken", Status: "claimed", ClaimDetail: "octocat"},
			},
			DeniedPRsTotal: 7,
			DeniedPRs:      []store.DeniedPR{{Number: 1756, Title: "<script>alert(1)</script>", AuthorAssociation: "NONE", ClosingComment: "Duplicate of #1742.", ClosedAt: &poll}},
		},
		{Repo: store.Repo{Owner: "sleepyco", Name: "lullaby", Status: "dormant", LastPoll: &poll, LastCommit: &old}},
	}
	h := &Handler{
		Template: web.Index,
		Source: fakeSource{reports: reports, pipe: pipeFixture(t), tel: Telemetry{
			LastPoll: poll, Errors: map[string]string{}, CycleDuration: 78 * time.Second, CycleRequests: 104,
			RateRemaining: 4277, RateLimit: 5000, RateReset: now.Add(40 * time.Minute), PRsKnown: true,
		}},
		PollInterval: time.Hour,
		Now:          func() time.Time { return now },
	}

	code, html := get(t, h, "/")
	if code != 200 {
		t.Fatalf("status %d\n%s", code, html)
	}
	for _, want := range []string{
		`acme/rocket#1738`,                                      // named in the cell detail
		`<b>No pull requests yet</b>`,                           // empty pipeline is explicit
		`data-v="pr-merged">0<`,                                 // instruments present and zeroed
		`data-v="pr-rate">—<`,                                   // no fake rate
		`723</span> of <span class="fig">5000</span> this hour`, // API used in words
		`1 min 18 s`, `>104<`,                                   // cycle telemetry
		`Not fetched yet`,                          // work board before its first fetch
		`class="light DORMANT"`, `class="gate ok"`, // health light and verdict
		`<i class="done"></i><i class="done"></i><i class="current"></i>`, // rocket at select
		`https://github.com/acme/rocket/pull/1756`,                        // denial links to its PR
		`var delay = 300000`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(html, "<script>alert(1)") {
		t.Error("PR title was not escaped")
	}
	if !strings.Contains(html, `:root[data-theme="light"]`) || !strings.Contains(html, "prefers-color-scheme: light") {
		t.Error("the page should follow the system theme and allow a light override")
	}
	channel := html[strings.Index(html, `id="watch-h"`):]
	if strings.Index(channel, `st CLAIMED`) > strings.Index(channel, `st STILL_OPEN`) {
		t.Error("watched issues should list claimed before still open")
	}
	if strings.Index(html, "acme/</span>rocket") > strings.Index(html, "sleepyco/</span>lullaby") {
		t.Error("repo further along the pipeline should be listed first")
	}
}

func TestPipelineCountsAndRate(t *testing.T) {
	now := time.Now()
	h := &Handler{
		Template: web.Index,
		Source: fakeSource{pipe: pipeFixture(t), reports: []store.RepoReport{{Repo: store.Repo{Owner: "acme", Name: "rocket", LastPoll: &now}}},
			tel: Telemetry{LastPoll: now, PRsKnown: true, OurPRs: []PR{
				{Owner: "acme", Name: "rocket", Number: 1, Title: "a", State: "closed", Merged: true},
				{Owner: "acme", Name: "rocket", Number: 2, Title: "b", State: "closed"},
				{Owner: "acme", Name: "rocket", Number: 3, Title: "c", State: "closed", Merged: true},
				{Owner: "acme", Name: "rocket", Number: 4, Title: "d", State: "open"},
			}}},
		PollInterval: time.Hour,
	}
	_, html := get(t, h, "/")
	for _, want := range []string{`data-v="pr-opened">4<`, `data-v="pr-merged">2<`, `data-v="pr-closed">1<`, `data-v="pr-open">1<`, `data-v="pr-rate">66%<`, `href="/notes/acme/rocket"`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestNothingWatchedIsNotAnAllClear(t *testing.T) {
	now := time.Now()
	h := &Handler{
		Template:     web.Index,
		Source:       fakeSource{pipe: pipeFixture(t), tel: Telemetry{LastPoll: now}, reports: []store.RepoReport{{Repo: store.Repo{Owner: "acme", Name: "rocket", LastPoll: &now}}}},
		PollInterval: time.Hour,
	}
	_, html := get(t, h, "/")
	for _, want := range []string{`<b>Nothing watched.</b>`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestStaleAndPollFailLight(t *testing.T) {
	now := time.Date(2026, 10, 29, 15, 0, 0, 0, time.UTC)
	old := now.Add(-3 * time.Hour)
	h := &Handler{
		Template: web.Index,
		Source: fakeSource{pipe: pipeFixture(t), tel: Telemetry{LastPoll: old, Errors: map[string]string{"gone/x": "github: 404"}, PRError: "search failed"},
			reports: []store.RepoReport{{Repo: store.Repo{Owner: "gone", Name: "x"}}}},
		PollInterval: time.Hour,
		Now:          func() time.Time { return now },
	}
	_, html := get(t, h, "/")
	for _, want := range []string{`<b>Not counted yet.</b>`, `Something went wrong`, `class="light UNKNOWN"`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestNotesRoute(t *testing.T) {
	h := handler(fakeSource{pipe: pipeFixture(t)})
	if code, body := get(t, h, "/notes/acme/rocket"); code != 200 || !strings.Contains(body, "notes for acme/rocket") {
		t.Errorf("named notes file: %d %q", code, body)
	}
	for _, bad := range []string{"/notes/sleepyco/lullaby", "/notes/acme/rocket/../../x", "/notes/../etc/passwd", "/notes/nope/nope", "/notes/"} {
		if code, _ := get(t, h, bad); code != 404 {
			t.Errorf("%s should 404, got %d", bad, code)
		}
	}
	if code, _ := get(t, handler(fakeSource{}), "/notes/acme/rocket"); code != 404 {
		t.Error("without a pipeline there are no notes")
	}
}

func TestNoPipelineHidesPipelinePanels(t *testing.T) {
	now := time.Now()
	src := fakeSource{tel: Telemetry{LastPoll: now, PRsKnown: true}, reports: []store.RepoReport{
		{Repo: store.Repo{Owner: "junegunn", Name: "fzf", Status: "active", LastPoll: &now, LastCommit: &now}, OpenIssuesTotal: 3},
	}}
	code, html := get(t, handler(src), "/")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	for _, want := range []string{`class="panel nopipe"`, `Merge rate`, `junegunn/</span>fzf`, `<h1>HelloGitty</h1>`, `V0.1.0 · BLACK BOMBAY <span class="baby">(baby)</span>`, `No pull requests yet`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	for _, unwanted := range []string{`class="phead"`, `class="phase`, `Repo flagged`, `Stage failed`, `repos by stage`, `in the pipeline`, `class="occ"`} {
		if strings.Contains(html, unwanted) {
			t.Errorf("pipeline-only element %q rendered without a pipeline", unwanted)
		}
	}
}

func TestPipelineLabelsComeFromTheCommand(t *testing.T) {
	now := time.Now()
	st, err := pipeline.Parse([]byte(`{"stages":["a","b"],"labels":{"flagged":"Gate escalated","failed":"Task failed"},
		"repos":{"o/x":{"stage":"b","done":["a"],"failed":["b"],"level":"caution","label":"ESCALATE"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	src := fakeSource{pipe: st, tel: Telemetry{LastPoll: now}, reports: []store.RepoReport{{Repo: store.Repo{Owner: "o", Name: "x", LastPoll: &now}}}}
	_, html := get(t, handler(src), "/")
	for _, want := range []string{`class="gate caution"`, `<i class="done"></i><i class="failed"></i>`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestMascotLaneAndAssets(t *testing.T) {
	now := time.Now()
	src := fakeSource{tel: Telemetry{LastPoll: now}, reports: []store.RepoReport{{Repo: store.Repo{Owner: "o", Name: "r", LastPoll: &now}}}}
	h := handler(src)
	h.Mascot = fstest.MapFS{
		"kitten-routine-01-glance.mp4": {Data: []byte("mp4-1")},
		"kitten-routine-02-bow.mp4":    {Data: []byte("mp4-2")},
		"kitten-news-01-alert.mp4":     {Data: []byte("mp4-n")},
		"rest.png":                     {Data: []byte("png")},
		"notes.txt":                    {Data: []byte("ignored")},
	}
	_, html := get(t, h, "/")
	for _, want := range []string{
		`class="status has-mascot"`,
		`data-routine="/mascot/kitten-routine-01-glance.mp4 /mascot/kitten-routine-02-bow.mp4"`,
		`data-news="/mascot/kitten-news-01-alert.mp4"`,
		`poster="/mascot/rest.png"`,
		`aria-hidden="true"`,
		`prefers-reduced-motion: reduce`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(html, "notes.txt") {
		t.Error("non-clip files must not be listed")
	}
	if code, body := get(t, h, "/mascot/kitten-routine-01-glance.mp4"); code != 200 || body != "mp4-1" {
		t.Errorf("clip not served: %d %q", code, body)
	}

	h.Mascot = fstest.MapFS{"kitten-routine-01-glance.mp4": {Data: []byte("x")}}
	if _, html := get(t, h, "/"); strings.Contains(html, `class="status has-mascot"`) {
		t.Error("without a rest still there is no mascot lane")
	}
	h.Mascot = nil
	if _, html := get(t, h, "/"); strings.Contains(html, `<div class="mascot"`) {
		t.Error("no mascot FS, no mascot lane")
	}
	if code, _ := get(t, h, "/mascot/rest.png"); code != 404 {
		t.Errorf("no mascot FS should 404 its assets, got %d", code)
	}
}

func TestWorkBoardPanels(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	b := &work.Board{Login: "me", Scope: "repos owned by me", FetchedAt: now.Add(-2 * time.Minute),
		Sent: []work.Item{
			{PR: true, Repo: "up/proj", Number: 7, Title: "Fix <it>", URL: "https://github.com/up/proj/pull/7", Role: work.RoleAuthor, State: "OPEN",
				Move: work.MoveYou, Status: "Changes requested by @lead", Level: "caution", Notes: []string{"Merge conflict"}, Since: now.Add(-50 * time.Hour),
				Last: &work.Activity{Author: "lead", Body: "<!-- bot -->Please **add** a test.\n> quoted\n<script>x</script>", URL: "https://r"}},
			{PR: true, Repo: "up/other", Number: 2, Title: "Docs", Role: work.RoleAuthor, State: "OPEN", Move: work.MoveThem, Status: "Waiting for a first review", Since: now.Add(-3 * time.Hour)},
			{Repo: "up/proj", Number: 3, Title: "Old", Role: work.RoleAuthor, State: "CLOSED", Move: work.MoveDone, Status: "Closed as completed", Since: now.Add(-24 * time.Hour)},
		},
		Incoming: []work.Item{{Repo: "me/tool", Number: 9, Title: "Crash", Author: "user", Role: work.RoleMaintains, State: "OPEN", Move: work.MoveYou, Status: "New from @user; no reply yet", Level: "caution", Since: now.Add(-time.Hour)}},
	}
	src := fakeSource{board: b, tel: Telemetry{LastPoll: now}, reports: []store.RepoReport{{Repo: store.Repo{Owner: "o", Name: "r", LastPoll: &now}}}}
	h := handler(src)
	h.Now = func() time.Time { return now }
	_, html := get(t, h, "/")
	for _, want := range []string{
		`data-v="work-you">1<`, `data-v="work-inyou">1<`,
		`Fix &lt;it&gt;`, // titles escaped
		`<span class="say caution">Changes requested by @lead</span><span class="note caution" data-term="merge-conflict" tabindex="0">Merge conflict</span>`,
		`>@lead</a>Please add a test. x</blockquote>`, // quote cleaned of markup, HTML and quoted replies
		`Sat 10:00`, `09:00`, `updated 2 min ago`,
		`Pull requests, issues and notifications in repos owned by me`,
		`Closed as completed`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(html, "<script>x") {
		t.Error("comment HTML must not reach the page")
	}

	src.workErr = "github graphql: boom"
	_, html = get(t, handler(src), "/")
	if !strings.Contains(html, "The last refresh failed, so this is the previous list.") || !strings.Contains(html, "github graphql: boom") || !strings.Contains(html, "your work") {
		t.Error("a failed refresh should say so and keep the previous board")
	}
}

func TestWorkRowShowsPersonalActionLabelsAndThreadQuote(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	b := &work.Board{Login: "me", Scope: "repos owned by me", FetchedAt: now, Cost: 28, Remaining: 4912,
		Sent: []work.Item{{PR: true, Repo: "o/r", Number: 5, Title: "T", Role: work.RoleAuthor, State: "OPEN", Move: work.MoveYou,
			Status: "Sign the CLA (filigran/cla: CLA signature required)", Level: "caution", Personal: "Sign the CLA",
			Labels: []string{"needs-triage"}, Notes: []string{"1 unresolved thread", "Waiting on: filigran/cla"}, Since: now,
			Quote: &work.Activity{Author: "greptile-apps", Body: "Advice is reversed", URL: "https://t"},
			Last:  &work.Activity{Author: "someone", Body: "older chatter"}}}}
	src := fakeSource{board: b, tel: Telemetry{LastPoll: now}, reports: []store.RepoReport{{Repo: store.Repo{Owner: "o", Name: "r", LastPoll: &now}}}}
	h := handler(src)
	h.Now = func() time.Time { return now }
	_, html := get(t, h, "/")
	for _, want := range []string{
		`<span class="only" data-term="only-you" tabindex="0">Only you</span><span class="say caution">Sign the CLA`,
		`<span class="label">needs-triage</span>`,
		`<span class="note caution" data-term="threads" tabindex="0">1 unresolved thread</span>`, `<span class="note " data-term="checks-running" tabindex="0">Waiting on: filigran/cla</span>`,
		`>@greptile-apps</a>Advice is reversed`, // the thread is quoted, not the older chatter
		`<span class="fig">28</span> GraphQL points`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(html, "older chatter") {
		t.Error("the status's own comment should be quoted instead of the latest one")
	}
}

func TestToolbarAndFilterHooks(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	b := &work.Board{Login: "me", FetchedAt: now, Sent: []work.Item{
		{PR: true, Repo: "Acme/Rocket", Number: 7, Title: "Fix Launch", Author: "me", Role: work.RoleAuthor, State: "OPEN", Move: work.MoveYou,
			Status: "Changes requested by @lead", Personal: "Sign the CLA", Labels: []string{"needs-triage"}, Since: now},
	}}
	src := fakeSource{board: b, tel: Telemetry{LastPoll: now}, reports: []store.RepoReport{
		{Repo: store.Repo{Owner: "Acme", Name: "Rocket", Status: "active", LastPoll: &now, LastCommit: &now}, OpenIssuesTotal: 12, OpenIssuesGFI: 3},
	}}
	h := handler(src)
	h.Now = func() time.Time { return now }
	_, html := get(t, h, "/")
	for _, want := range []string{
		`data-wsort="updated"`, `data-rsort="denied"`, // sorting is by column header; there is no Sort dropdown
		`data-kind="pr" data-repo="acme/rocket" data-name="Acme/Rocket" data-move="you" data-personal`, // a work row's hooks
		`data-s="fix launch acme/rocket #7 pr changes requested by @lead`,                              // its search text, lowercase
		`needs-triage`,
		`data-repo="acme/rocket" data-name="Acme/Rocket" data-s="acme/rocket active" data-open="12" data-gfi="3"`, // a tracked row's hooks
		`<span class="wpill you">Your move</span>`,                                                                // the pill, not the display:none movetag it replaced
		`hellogitty-view`, // the view survives the reload
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestCheckFailedSaysWhy(t *testing.T) {
	now := time.Now()
	h := &Handler{
		Template: web.Index,
		Source: fakeSource{pipe: pipeFixture(t), reports: []store.RepoReport{{Repo: store.Repo{Owner: "acme", Name: "rocket", LastPoll: &now}}},
			tel: Telemetry{LastPoll: now.Add(-10 * time.Minute), Errors: map[string]string{"acme/rocket": "pull requests: context deadline exceeded (Client.Timeout)"}}},
		PollInterval: time.Hour,
	}
	_, html := get(t, h, "/")
	for _, want := range []string{
		`<span class="errtag" title="Last check failed: GitHub took too long to answer while sending its pull requests.">check failed</span>`,
		`The last check failed: GitHub took too long to answer while sending its pull requests. The numbers shown`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestPipelinePageActionsAndFilters(t *testing.T) {
	now := time.Now()
	reports := []store.RepoReport{
		{Repo: store.Repo{Owner: "acme", Name: "rocket", LastPoll: &now}},
		{Repo: store.Repo{Owner: "sleepyco", Name: "lullaby", LastPoll: &now}},
	}
	board := &work.Board{Sent: []work.Item{
		{PR: true, Role: work.RoleAuthor, Repo: "acme/rocket", Number: 1, State: "OPEN", ReviewDecision: "CHANGES_REQUESTED", Checks: "FAILURE",
			Threads: []work.Thread{{Author: "rev"}, {Author: "rev", RepliedLast: true}}},
		{PR: true, Role: work.RoleAuthor, Repo: "acme/rocket", Number: 2, State: "OPEN", ReviewDecision: "APPROVED", Requested: []string{"bob"}, Conflict: true},
		{PR: true, Role: work.RoleAuthor, Repo: "sleepyco/lullaby", Number: 3, State: "OPEN", Draft: true, Checks: "ERROR"},
		// Closed pull requests keep their last verdict, but nothing waits on it.
		{PR: true, Role: work.RoleAuthor, Repo: "sleepyco/lullaby", Number: 4, State: "CLOSED", ReviewDecision: "CHANGES_REQUESTED"},
	}}
	h := &Handler{
		Template: web.Index, PipelineTemplate: web.Pipeline, PollInterval: time.Hour,
		Source: fakeSource{reports: reports, board: board, tel: Telemetry{LastPoll: now, PRsKnown: true, OurPRs: []PR{
			{Owner: "acme", Name: "rocket", Number: 1, Title: "a", State: "open"},
			{Owner: "acme", Name: "rocket", Number: 2, Title: "b", State: "open"},
			{Owner: "sleepyco", Name: "lullaby", Number: 3, Title: "c", State: "open"},
			{Owner: "sleepyco", Name: "lullaby", Number: 4, Title: "d", State: "closed"},
		}}},
	}
	code, html := get(t, h, "/pipeline")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	html = strings.Join(strings.Fields(html), " ")
	for _, want := range []string{
		`<title>PR Pipeline · HelloGitty</title>`,
		// Action counts in the new "Needs you" tier — same numbers, new markup.
		`>1</span><span class="al">Review requested<`,
		`>1</span><span class="al">Changes requested<`,
		`>2</span><span class="al">Checks failing<`,
		`>1</span><span class="al">Conflicts<`,
		// Approved and Draft are now filter chips above the table (states, not actions).
		`title="Open and approved — ready to merge">Approved<span class="pcount">1</span>`,
		`title="Open drafts, not yet ready for review">Draft<span class="pcount">1</span>`,
		`class="lit" title="Threads to answer, changes requested or checks failing">Pending<span class="pcount">2</span>`,
		`<option value="acme/rocket">acme/rocket</option><option value="sleepyco/lullaby">sleepyco/lullaby</option>`,
		`data-repo="acme/rocket" data-pending="1" data-approved="0" data-draft="0"><td class="num">1<`,
		`data-repo="acme/rocket" data-pending="0" data-approved="1" data-draft="0"><td class="num">2<`,
		`data-repo="sleepyco/lullaby" data-pending="1" data-approved="0" data-draft="1"><td class="num">3<`,
		`data-repo="sleepyco/lullaby" data-pending="0" data-approved="0" data-draft="0"><td class="num">4<`,
		`1 unresolved thread<`,
		// The new column exists and its header is clickable for sort.
		`data-sort="num" data-col="activity">Last activity</th>`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
}

// TestHealthEndpoint exercises the /health contract (#208): per-loop staleness at 2.5x cadence,
// write outcomes that reflect what actually hit disk, and a 503 whenever any check fails.
func TestHealthEndpoint(t *testing.T) {
	now := time.Date(2026, 11, 4, 1, 0, 0, 0, time.UTC)
	// A board fetched 2 minutes ago is fresh for the 5-minute work_refresh loop.
	board := &work.Board{FetchedAt: now.Add(-2 * time.Minute)}
	// A poll 29 minutes ago is fresh for the 60-minute repo_poll loop.
	polled := now.Add(-29 * time.Minute)

	cases := []struct {
		name       string
		src        fakeSource
		wantCode   int
		wantStatus string
		// Substrings the JSON body must contain.
		wantHas []string
		// Substrings the JSON body must NOT contain.
		wantHasNot []string
		// Loops expected, keyed by name — maps to {stale: bool, partial *bool}. Nil partial means
		// the key must be absent (repo_poll never emits partial). false/true checks the value.
		loopStale   map[string]bool
		loopPartial map[string]*bool
		// Files expected by name → current flag. Absent means must NOT appear in files[].
		filesCurrent map[string]bool
		filesAbsent  []string
	}{
		{
			name: "all_green_200",
			src: fakeSource{
				tel:   Telemetry{LastPoll: polled},
				board: board,
				writes: []WriteStatus{
					{Name: "inbox.json", LastAttempt: now.Add(-2 * time.Minute), LastSuccess: now.Add(-2 * time.Minute), Outcome: "written", Detail: "25 entries"},
					{Name: "unreplied.json", LastAttempt: now.Add(-2 * time.Minute), LastSuccess: now.Add(-2 * time.Minute), Outcome: "written", Detail: "6 PRs, 9 threads"},
				},
			},
			wantCode:    200,
			wantStatus:  "ok",
			loopStale:   map[string]bool{"repo_poll": false, "work_refresh": false},
			loopPartial: map[string]*bool{"work_refresh": ptrBool(false)},
			filesCurrent: map[string]bool{
				"inbox.json":     true,
				"unreplied.json": true,
			},
			wantHas: []string{`"detail":"25 entries"`, `"detail":"6 PRs, 9 threads"`},
		},
		{
			// (a) kills S1 — work_refresh is 20m old, repo_poll is fine. A shared threshold
			// would miss this.
			name: "work_refresh_stale_but_repo_poll_ok_503",
			src: fakeSource{
				tel:   Telemetry{LastPoll: polled},
				board: &work.Board{FetchedAt: now.Add(-20 * time.Minute)},
				writes: []WriteStatus{
					{Name: "inbox.json", LastAttempt: now.Add(-20 * time.Minute), LastSuccess: now.Add(-20 * time.Minute), Outcome: "written", Detail: "25 entries"},
					{Name: "unreplied.json", LastAttempt: now.Add(-20 * time.Minute), LastSuccess: now.Add(-20 * time.Minute), Outcome: "written", Detail: "6 PRs, 9 threads"},
				},
			},
			wantCode:    503,
			wantStatus:  "degraded",
			loopStale:   map[string]bool{"repo_poll": false, "work_refresh": true},
			loopPartial: map[string]*bool{"work_refresh": ptrBool(false)},
		},
		{
			// (b) kills S2 — poll is 3h old (>2h30m), board is 15m old (>12m30s), both files
			// errored. Fully degraded; no 200 allowed.
			name: "fully_degraded_503",
			src: fakeSource{
				tel:   Telemetry{LastPoll: now.Add(-3 * time.Hour)},
				board: &work.Board{FetchedAt: now.Add(-15 * time.Minute)},
				writes: []WriteStatus{
					{Name: "inbox.json", LastAttempt: now.Add(-15 * time.Minute), LastSuccess: now.Add(-3 * time.Hour), Outcome: "error: disk full", Detail: "disk full"},
					{Name: "unreplied.json", LastAttempt: now.Add(-15 * time.Minute), LastSuccess: now.Add(-3 * time.Hour), Outcome: "error: disk full", Detail: "disk full"},
				},
			},
			wantCode:   503,
			wantStatus: "degraded",
			loopStale:  map[string]bool{"repo_poll": true, "work_refresh": true},
			filesCurrent: map[string]bool{
				"inbox.json":     false,
				"unreplied.json": false,
			},
			wantHas: []string{`"outcome":"error: disk full"`},
		},
		{
			// (c) kills S3 — inbox was skipped on a partial board. Must report current:false
			// even though the file on disk is recent.
			name: "inbox_skipped_on_partial_503",
			src: fakeSource{
				tel:         Telemetry{LastPoll: polled},
				board:       board,
				workPartial: true,
				writes: []WriteStatus{
					{Name: "inbox.json", LastAttempt: now.Add(-2 * time.Minute), LastSuccess: now.Add(-10 * time.Minute), Outcome: "skipped: partial work board", Detail: ""},
					{Name: "unreplied.json", LastAttempt: now.Add(-2 * time.Minute), LastSuccess: now.Add(-10 * time.Minute), Outcome: "skipped: partial work board", Detail: ""},
				},
			},
			wantCode:    503,
			wantStatus:  "degraded",
			loopPartial: map[string]*bool{"work_refresh": ptrBool(true)},
			filesCurrent: map[string]bool{
				"inbox.json":     false,
				"unreplied.json": false,
			},
			wantHas: []string{`"outcome":"skipped: partial work board"`},
		},
		{
			// A file with no path configured is left out of the files array entirely.
			name: "unconfigured_file_absent",
			src: fakeSource{
				tel:   Telemetry{LastPoll: polled},
				board: board,
				writes: []WriteStatus{
					{Name: "inbox.json", LastAttempt: now.Add(-2 * time.Minute), LastSuccess: now.Add(-2 * time.Minute), Outcome: "written", Detail: "25 entries"},
				},
			},
			wantCode:   200,
			wantStatus: "ok",
			filesCurrent: map[string]bool{
				"inbox.json": true,
			},
			filesAbsent: []string{"unreplied.json"},
			wantHasNot:  []string{`"name":"unreplied.json"`},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := handler(tc.src)
			h.Now = func() time.Time { return now }
			code, body := get(t, h, "/health")
			if code != tc.wantCode {
				t.Errorf("status: got %d, want %d; body=%s", code, tc.wantCode, body)
			}
			var resp struct {
				Status    string `json:"status"`
				CheckedAt string `json:"checked_at"`
				Loops     []struct {
					Name     string `json:"name"`
					Interval int    `json:"interval_minutes"`
					Age      int    `json:"age_minutes"`
					Stale    bool   `json:"stale"`
					Errors   int    `json:"errors"`
					Partial  *bool  `json:"partial,omitempty"`
				} `json:"loops"`
				Files []struct {
					Name    string `json:"name"`
					Outcome string `json:"outcome"`
					Detail  string `json:"detail"`
					Current bool   `json:"current"`
				} `json:"files"`
			}
			if err := json.Unmarshal([]byte(body), &resp); err != nil {
				t.Fatalf("unmarshal: %v; body=%s", err, body)
			}
			if resp.Status != tc.wantStatus {
				t.Errorf("status field: got %q, want %q", resp.Status, tc.wantStatus)
			}
			for name, wantStale := range tc.loopStale {
				var got *bool
				for _, l := range resp.Loops {
					if l.Name == name {
						s := l.Stale
						got = &s
						break
					}
				}
				if got == nil {
					t.Errorf("loop %q not in response", name)
					continue
				}
				if *got != wantStale {
					t.Errorf("loop %q stale: got %v, want %v", name, *got, wantStale)
				}
			}
			for name, wantPartial := range tc.loopPartial {
				var found bool
				for _, l := range resp.Loops {
					if l.Name == name {
						found = true
						if wantPartial == nil {
							if l.Partial != nil {
								t.Errorf("loop %q should have no partial field, got %v", name, *l.Partial)
							}
						} else {
							if l.Partial == nil {
								t.Errorf("loop %q missing partial field", name)
							} else if *l.Partial != *wantPartial {
								t.Errorf("loop %q partial: got %v, want %v", name, *l.Partial, *wantPartial)
							}
						}
					}
				}
				if !found {
					t.Errorf("loop %q not in response", name)
				}
			}
			for name, wantCurrent := range tc.filesCurrent {
				var found bool
				for _, f := range resp.Files {
					if f.Name == name {
						found = true
						if f.Current != wantCurrent {
							t.Errorf("file %q current: got %v, want %v (outcome=%q)", name, f.Current, wantCurrent, f.Outcome)
						}
					}
				}
				if !found {
					t.Errorf("file %q missing from files[]", name)
				}
			}
			for _, name := range tc.filesAbsent {
				for _, f := range resp.Files {
					if f.Name == name {
						t.Errorf("file %q should be absent (no path configured)", name)
					}
				}
			}
			for _, want := range tc.wantHas {
				if !strings.Contains(body, want) {
					t.Errorf("body missing %q; body=%s", want, body)
				}
			}
			for _, bad := range tc.wantHasNot {
				if strings.Contains(body, bad) {
					t.Errorf("body contains %q but should not; body=%s", bad, body)
				}
			}
		})
	}
}

func ptrBool(b bool) *bool { return &b }

// A run started with -interval 10m polls every 10 minutes, so a poll 40 minutes old is four
// missed ticks and must read stale. Handler.PollInterval already carries the real value.
func TestHealthHonoursConfiguredPollInterval(t *testing.T) {
	now := time.Date(2026, 11, 4, 1, 0, 0, 0, time.UTC)
	h := handler(fakeSource{
		tel:   Telemetry{LastPoll: now.Add(-40 * time.Minute)},
		board: &work.Board{FetchedAt: now.Add(-2 * time.Minute)},
		writes: []WriteStatus{
			{Name: "inbox.json", LastAttempt: now, LastSuccess: now, Outcome: "written", Detail: "25 entries"},
		},
	})
	h.Now = func() time.Time { return now }
	h.PollInterval = 10 * time.Minute

	code, body := get(t, h, "/health")
	if !strings.Contains(body, `"interval_minutes":10`) {
		t.Errorf("repo_poll interval: want 10 (the configured value), body=%s", body)
	}
	if !strings.Contains(body, `"name":"repo_poll","interval_minutes":10,"last_success":"2026-11-04T00:20:00Z","age_minutes":40,"stale":true`) {
		t.Errorf("repo_poll should be stale: 40m old against a 10m cadence is 4 missed ticks; body=%s", body)
	}
	if code != 503 {
		t.Errorf("status: got %d, want 503", code)
	}
}

// The same for the other loop, and it needs its own test: work_refresh's cadence is a constant in
// the binary rather than a config value, so nothing stops someone writing 5 minutes here again and
// leaving h.WorkRefresh unread. The inbox file already reports refresh_interval_minutes from that
// constant, and two copies of one number is how a field name becomes a lie.
func TestHealthHonoursConfiguredWorkRefresh(t *testing.T) {
	now := time.Date(2026, 11, 4, 1, 0, 0, 0, time.UTC)
	h := handler(fakeSource{
		tel:   Telemetry{LastPoll: now.Add(-5 * time.Minute)},
		board: &work.Board{FetchedAt: now.Add(-7 * time.Minute)},
		writes: []WriteStatus{
			{Name: "inbox.json", LastAttempt: now, LastSuccess: now, Outcome: "written", Detail: "25 entries"},
		},
	})
	h.Now = func() time.Time { return now }
	h.WorkRefresh = 2 * time.Minute

	// 7 minutes against a 2-minute cadence is three missed ticks. Against the 5-minute default it
	// would still be fresh, so a hardcoded 5 here reads healthy on a loop that has stopped.
	code, body := get(t, h, "/health")
	if !strings.Contains(body, `"name":"work_refresh","interval_minutes":2,"last_success":"2026-11-04T00:53:00Z","age_minutes":7,"stale":true`) {
		t.Errorf("work_refresh should report a 2-minute cadence and read stale; body=%s", body)
	}
	if code != 503 {
		t.Errorf("status: got %d, want 503", code)
	}
}

// TestHealthFirstCycleGrace covers #210: a zero LastPoll is not stale while the process has
// been up for less than 2.5x the poll interval. Once uptime passes that, it IS stale.
func TestHealthFirstCycleGrace(t *testing.T) {
	now := time.Date(2026, 11, 4, 1, 0, 0, 0, time.UTC)

	cases := []struct {
		name         string
		pollInterval time.Duration
		startedAt    time.Time
		wantCode     int
		wantStatus   string
		wantHas      []string
		wantHasNot   []string
	}{
		{
			// Fresh process, zero LastPoll, uptime 2 minutes against a 1h cadence. Must be 200.
			// Kills S2 (zero LastPoll always stale).
			name:         "fresh_process_within_grace_200",
			pollInterval: time.Hour,
			startedAt:    now.Add(-2 * time.Minute),
			wantCode:     200,
			wantStatus:   "ok",
			wantHas: []string{
				// repo_poll must carry never_polled:true with no last_success key.
				`"name":"repo_poll","interval_minutes":60,"age_minutes":0,"stale":false,"errors":0,"never_polled":true}`,
			},
		},
		{
			// Uptime is 3 hours against a 1h cadence — well past 2h30m grace. Must be 503. The
			// grace window exists so a healthy first cycle is not misreported; it does not
			// exist to hide a poll loop that never turns. Kills S1 (unbounded uptime).
			name:         "long_up_no_cycle_503",
			pollInterval: time.Hour,
			startedAt:    now.Add(-3 * time.Hour),
			wantCode:     503,
			wantStatus:   "degraded",
			wantHas:      []string{`"never_polled":true`, `"stale":true`},
		},
		{
			// Non-default interval: -interval 10m means 2.5x = 25m. Uptime 30m with no cycle
			// is past that, so 503. A fixed grace based on the 60m default would be 2h30m and
			// would still read 200 here. Kills S3 (ignore configured interval).
			name:         "custom_interval_past_grace_503",
			pollInterval: 10 * time.Minute,
			startedAt:    now.Add(-30 * time.Minute),
			wantCode:     503,
			wantStatus:   "degraded",
			wantHas:      []string{`"interval_minutes":10`, `"stale":true`, `"never_polled":true`},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := handler(fakeSource{
				tel:   Telemetry{}, // zero LastPoll
				board: &work.Board{FetchedAt: now.Add(-2 * time.Minute)},
				writes: []WriteStatus{
					{Name: "inbox.json", LastAttempt: now, LastSuccess: now, Outcome: "written", Detail: "25 entries"},
				},
			})
			h.Now = func() time.Time { return now }
			h.PollInterval = tc.pollInterval
			h.StartedAt = tc.startedAt

			code, body := get(t, h, "/health")
			if code != tc.wantCode {
				t.Errorf("status: got %d, want %d; body=%s", code, tc.wantCode, body)
			}
			if !strings.Contains(body, `"status":"`+tc.wantStatus+`"`) {
				t.Errorf("status field: want %q in body; body=%s", tc.wantStatus, body)
			}
			for _, want := range tc.wantHas {
				if !strings.Contains(body, want) {
					t.Errorf("missing %q; body=%s", want, body)
				}
			}
			for _, bad := range tc.wantHasNot {
				if strings.Contains(body, bad) {
					t.Errorf("should NOT contain %q; body=%s", bad, body)
				}
			}
		})
	}
}

// Work-refresh gets the same treatment, so neither of the two is honest by luck.
func TestHealthWorkRefreshNeverRefreshed(t *testing.T) {
	now := time.Date(2026, 11, 4, 1, 0, 0, 0, time.UTC)
	h := handler(fakeSource{
		tel:   Telemetry{LastPoll: now.Add(-5 * time.Minute)},
		board: nil, // never fetched
		writes: []WriteStatus{
			{Name: "inbox.json", LastAttempt: now, LastSuccess: now, Outcome: "written", Detail: "25 entries"},
		},
	})
	h.Now = func() time.Time { return now }
	h.PollInterval = time.Hour
	h.WorkRefresh = 5 * time.Minute
	h.StartedAt = now.Add(-30 * time.Second) // 2.5x = 12m30s, well within grace

	code, body := get(t, h, "/health")
	if code != 200 {
		t.Errorf("status: got %d, want 200; body=%s", code, body)
	}
	if !strings.Contains(body, `"name":"work_refresh"`) || !strings.Contains(body, `"never_refreshed":true`) {
		t.Errorf("work_refresh should report never_refreshed:true; body=%s", body)
	}
}

// An unwired StartedAt must not buy a never-completed cycle an unlimited grace period. There is
// one Handler construction site today and it sets the field, so this guards the next one: without
// an uptime there is no evidence the first cycle is in flight rather than stopped, and reporting
// healthy on no evidence is the failure /health exists to catch.
func TestHealthRefusesGraceWithoutUptime(t *testing.T) {
	now := time.Date(2026, 11, 4, 1, 0, 0, 0, time.UTC)
	h := handler(fakeSource{
		writes: []WriteStatus{
			{Name: "inbox.json", LastAttempt: now, LastSuccess: now, Outcome: "written", Detail: "25 entries"},
		},
	})
	h.Now = func() time.Time { return now }
	// StartedAt deliberately left at its zero value, as a caller that forgot to wire it leaves it.

	code, body := get(t, h, "/health")
	if !strings.Contains(body, `"name":"repo_poll","interval_minutes":60,"age_minutes":0,"stale":true`) {
		t.Errorf("repo_poll should read stale with no uptime to justify a grace; body=%s", body)
	}
	if !strings.Contains(body, `"never_polled":true`) {
		t.Errorf("never_polled should still say which state it is in; body=%s", body)
	}
	if code != 503 {
		t.Errorf("status: got %d, want 503", code)
	}
}

// TestPrRowLastActivity: the Last activity column takes the newest of comments/reviews
// (including bots), review threads, and our own commits — NOT GitHub's updated_at on its own.
func TestPrRowLastActivity(t *testing.T) {
	at := func(d time.Duration) time.Time {
		return time.Date(2026, 11, 4, 1, 0, 0, 0, time.UTC).Add(-d)
	}
	commit := at(2 * time.Hour)   // oldest
	humanMsg := at(90 * time.Minute)
	botReview := at(30 * time.Minute) // newest
	thread := at(45 * time.Minute)
	it := work.Item{
		PR: true, Repo: "acme/rocket", Number: 42, State: "OPEN",
		Last:         &work.Activity{Author: "alice", At: humanMsg},
		BotReviews:   []work.Activity{{Author: "coderabbit", Bot: true, At: botReview}},
		Threads:      []work.Thread{{Author: "bob", At: thread}},
		LastCommitAt: &commit,
	}
	var r prRow
	r.withActions(it)
	if r.LastActivity == nil {
		t.Fatal("LastActivity nil, want the bot-review timestamp")
	}
	if !r.LastActivity.Equal(botReview) {
		t.Errorf("LastActivity: got %s, want the newest (bot review at %s)", r.LastActivity, botReview)
	}

	// With nothing to go on, it stays nil (not zero-time masquerading as data).
	var r2 prRow
	r2.withActions(work.Item{PR: true})
	if r2.LastActivity != nil {
		t.Errorf("LastActivity with no inputs: got %v, want nil", r2.LastActivity)
	}

	// A commit, no activity: commit wins.
	var r3 prRow
	r3.withActions(work.Item{PR: true, LastCommitAt: &commit})
	if r3.LastActivity == nil || !r3.LastActivity.Equal(commit) {
		t.Errorf("LastActivity with only a commit: got %v, want %v", r3.LastActivity, commit)
	}
}
