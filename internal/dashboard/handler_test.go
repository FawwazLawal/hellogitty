package dashboard

import (
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
	reports []store.RepoReport
	tel     Telemetry
	pipe    *pipeline.State
	board   *work.Board
	workErr string
}

func (f fakeSource) Reports() ([]store.RepoReport, error) { return f.reports, nil }
func (f fakeSource) Telemetry() Telemetry                 { return f.tel }
func (f fakeSource) Pipeline() (*pipeline.State, error)   { return f.pipe, nil }
func (f fakeSource) Work() (*work.Board, string)          { return f.board, f.workErr }
func (f fakeSource) Security() security.Feed              { return security.Feed{} }

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
		`class="cell warn lit wide linked"`,                      // watched issue claimed, lit and clickable
		`data-v="cw-watch-claimed">1<`,                          // with its count
		`acme/rocket#1738`,                                      // named in the cell detail
		`data-v="cw-repo-dormant">1<`,                           // dormant counted
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
	for _, want := range []string{`data-v="cw-watch-claimed">nothing watched<`, `data-v="cw-watch-closed">nothing watched<`, `cell warn wide empty`, `<b>Nothing watched.</b>`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(html, `data-v="cw-watch-claimed">0<`) {
		t.Error("a bare 0 on the claimed cell reads as all clear when nothing is watched")
	}
}

func TestStaleAndPollFailLight(t *testing.T) {
	now := time.Now()
	old := now.Add(-3 * time.Hour)
	h := &Handler{
		Template: web.Index,
		Source: fakeSource{pipe: pipeFixture(t), tel: Telemetry{LastPoll: old, Errors: map[string]string{"gone/x": "github: 404"}, PRError: "search failed"},
			reports: []store.RepoReport{{Repo: store.Repo{Owner: "gone", Name: "x"}}}},
		PollInterval: time.Hour,
	}
	_, html := get(t, h, "/")
	for _, want := range []string{`data-v="cw-poll-fail">2<`, `data-v="cw-data-stale">3 hours ago<`, `<b>Not counted yet.</b>`, `Something went wrong`, `class="light UNKNOWN"`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestOverflowCountRendersOutsideTheClamp(t *testing.T) {
	now := time.Now()
	var reports []store.RepoReport
	errs := map[string]string{}
	for _, n := range []string{"rocket", "anvil", "Beacon", "comet", "delta-core", "ui"} {
		owner := "own-" + strings.ToLower(n)
		reports = append(reports, store.RepoReport{Repo: store.Repo{Owner: owner, Name: n, LastPoll: &now}})
		errs[strings.ToLower(owner+"/"+n)] = "github: 401"
	}
	h := &Handler{
		Template:     web.Index,
		Source:       fakeSource{pipe: pipeFixture(t), reports: reports, tel: Telemetry{LastPoll: now, Errors: errs}},
		PollInterval: time.Hour,
	}
	_, html := get(t, h, "/")
	if !strings.Contains(html, `<span class="det">anvil</span><span class="more">+5</span>`) {
		i := strings.Index(html, "Check failed")
		t.Errorf("the failed-check cell should show one short name and carry +5 outside the clamped span:\n%s", html[i:i+400])
	}
	if strings.Contains(html, "own-rocket/rocket,") {
		t.Error("failed-check detail should use short repo names")
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
	for _, want := range []string{`Gate escalated</span><span class="cnt" data-v="cw-repo-flagged">1<`, `Task failed</span><span class="cnt" data-v="cw-stage-failed">1<`, `class="gate caution"`, `<i class="done"></i><i class="failed"></i>`} {
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
		`Your move</span><span class="cnt" data-v="cw-your-move">2<`, // cell counts sent and incoming
		`proj#7, tool#9`, // and names them
		`data-v="work-you">1<`, `data-v="work-them">1<`, `data-v="work-inyou">1<`,
		`Fix &lt;it&gt;`, // titles escaped
		`<span class="say caution">Changes requested by @lead</span><span class="note caution" data-term="merge-conflict" tabindex="0">Merge conflict</span>`,
		`>@lead</a>Please add a test. x</blockquote>`, // quote cleaned of markup, HTML and quoted replies
		`2 days ago`, `3 hours ago`, `updated 2 min ago`,
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
		`<span class="movetag you">Your move</span>`,
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
		`data-extra="rocket: GitHub took too long to answer while sending its pull requests. HelloGitty tries again on the next check, in about 50 minutes."`,
		`<span class="errtag" title="Last check failed: GitHub took too long to answer while sending its pull requests.">check failed</span>`,
		`The last check failed: GitHub took too long to answer while sending its pull requests. The numbers shown`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
}
