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
	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/web"
)

type fakeSource struct {
	reports []store.RepoReport
	tel     Telemetry
	pipe    *pipeline.State
}

func (f fakeSource) Reports() ([]store.RepoReport, error) { return f.reports, nil }
func (f fakeSource) Telemetry() Telemetry                 { return f.tel }
func (f fakeSource) Pipeline() (*pipeline.State, error)   { return f.pipe, nil }

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
		`class="cell warn lit wide"`,    // WATCH CLAIMED lit
		`data-v="cw-watch-claimed">1<`,  // with its count
		`acme/rocket#1738`,              // named in the cell detail
		`data-v="cw-repo-dormant">1<`,   // dormant counted
		`<b>NO DATA</b> · 0 PRs opened`, // empty pipeline is explicit
		`data-v="pr-merged">0<`,         // instruments present and zeroed
		`data-v="pr-rate">—<`,           // no fake rate
		`723/5000 /HR`,                  // API used with units
		`78 S`, `>104<`,                 // cycle telemetry
		`class="light DORMANT"`, `class="gate ok"`, // health light and verdict
		`<i class="done"></i><i class="done"></i><i class="current"></i>`, // rocket at select
		`https://github.com/acme/rocket/pull/1756`,                        // denial links to its PR
		`http-equiv="refresh" content="300"`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(html, "<script>alert(1)") {
		t.Error("PR title was not escaped")
	}
	if strings.Contains(html, "prefers-color-scheme") {
		t.Error("dashboard is dark only")
	}
	channel := html[strings.Index(html, `aria-label="Watch channel"`):]
	if strings.Index(channel, "CLAIMED") > strings.Index(channel, "STILL_OPEN") {
		t.Error("watch channel should list CLAIMED before STILL_OPEN")
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
	for _, want := range []string{`data-v="cw-watch-claimed">NONE WATCHED<`, `data-v="cw-watch-closed">NONE WATCHED<`, `cell warn wide empty`, `NO ISSUES WATCHED`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(html, `data-v="cw-watch-claimed">0<`) {
		t.Error("a bare 0 on WATCH CLAIMED reads as all clear when nothing is watched")
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
	for _, want := range []string{`data-v="cw-poll-fail">2<`, `data-v="cw-data-stale">180 MIN<`, `AWAITING PR SEARCH`, `last search failed`, `class="light UNKNOWN"`} {
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
		i := strings.Index(html, "POLL FAIL")
		t.Errorf("POLL FAIL should show one short name and carry +5 outside the clamped span:\n%s", html[i:i+400])
	}
	if strings.Contains(html, "own-rocket/rocket,") {
		t.Error("POLL FAIL detail should use short repo names")
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
	for _, want := range []string{`class="panel nopipe"`, `YOUR PRS`, `junegunn/</span>fzf`, `HELLOGITTY`, `V0.1.0 · BLACK BOMBAY <span class="baby">(baby)</span>`, `NO DATA`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	for _, unwanted := range []string{`class="phead"`, `class="phase`, `REPO FLAGGED`, `STAGE FAILED`, `repos by stage`, `In pipeline`, `class="occ"`} {
		if strings.Contains(html, unwanted) {
			t.Errorf("pipeline-only element %q rendered without a pipeline", unwanted)
		}
	}
}

func TestPipelineLabelsComeFromTheCommand(t *testing.T) {
	now := time.Now()
	st, err := pipeline.Parse([]byte(`{"stages":["a","b"],"labels":{"flagged":"GATE ESCALATE","failed":"TASK FAILED"},
		"repos":{"o/x":{"stage":"b","done":["a"],"failed":["b"],"level":"caution","label":"ESCALATE"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	src := fakeSource{pipe: st, tel: Telemetry{LastPoll: now}, reports: []store.RepoReport{{Repo: store.Repo{Owner: "o", Name: "x", LastPoll: &now}}}}
	_, html := get(t, handler(src), "/")
	for _, want := range []string{`GATE ESCALATE</span><span class="cnt" data-v="cw-repo-flagged">1<`, `TASK FAILED</span><span class="cnt" data-v="cw-stage-failed">1<`, `class="gate caution"`, `<i class="done"></i><i class="failed"></i>`} {
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
