package poller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

func TestContainsClaim(t *testing.T) {
	yes := []string{"I'll take this one", "I’m working on a fix", "Taking this!", "i can do this tonight",
		"Can I work on this?", "Thanks for the report. I'd like to take it.", "Please assign me"}
	no := []string{"Is anyone working on it?", "This is still broken", "",
		"@geonseok-ship-it Are you still working on this? Happy to leave it to you if so.",
		"> I'll take this\n\nThanks, any update?"}
	for _, s := range yes {
		if !containsClaim(s) {
			t.Errorf("should detect claim: %q", s)
		}
	}
	for _, s := range no {
		if containsClaim(s) {
			t.Errorf("false claim: %q", s)
		}
	}
}

func TestReviewVerdictAndClosingComment(t *testing.T) {
	t1 := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	t2, t3, closed := t1.Add(time.Hour), t1.Add(2*time.Hour), t1.Add(3*time.Hour)
	late := closed.Add(time.Hour)
	reviews := []github.Review{
		{State: "COMMENTED", SubmittedAt: &t1},
		{State: "CHANGES_REQUESTED", SubmittedAt: &t2},
		{State: "APPROVED", SubmittedAt: &late},
	}
	if v := reviewVerdict(reviews, &closed); v != "CHANGES_REQUESTED" {
		t.Errorf("verdict %q", v)
	}
	if v := reviewVerdict([]github.Review{{State: "COMMENTED", SubmittedAt: &t1}}, &closed); v != "COMMENTED" {
		t.Errorf("comment-only verdict %q", v)
	}

	pr := github.PullRequest{User: github.User{Login: "outsider"}, ClosedAt: &closed}
	comments := []github.Comment{
		{Body: "Thanks!", AuthorAssociation: "MEMBER", CreatedAt: &t1},
		{Body: "This would break existing configs. Closing.", AuthorAssociation: "OWNER", CreatedAt: &t3},
		{Body: "ok :(", AuthorAssociation: "NONE", User: github.User{Login: "outsider"}, CreatedAt: &t3},
		{Body: "Reopening later maybe", AuthorAssociation: "OWNER", CreatedAt: &late},
	}
	if c := closingComment(comments, pr); c != "This would break existing configs. Closing." {
		t.Errorf("closing comment %q", c)
	}
}

func TestHealth(t *testing.T) {
	now := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	at := func(days int) *time.Time { x := now.AddDate(0, 0, -days); return &x }
	for days, want := range map[int]string{1: "active", 30: "active", 31: "slow", 90: "slow", 91: "dormant"} {
		if got := health(at(days), now); got != want {
			t.Errorf("%d days: %s want %s", days, got, want)
		}
	}
	if health(nil, now) != "dormant" {
		t.Error("no commits should be dormant")
	}
}

// fakeGitHub serves one repo. Issue 10 is watched and has a fresh claim comment; issue 20 is
// watched and was closed by a merged PR; issue 30 is assigned.
func fakeGitHub(t *testing.T, now time.Time) *httptest.Server {
	recent := now.Add(-48 * time.Hour).Format(time.RFC3339)
	old := now.AddDate(0, -3, 0).Format(time.RFC3339)
	closed := now.Add(-24 * time.Hour).Format(time.RFC3339)
	routes := map[string]string{
		"/repos/o/r/commits": fmt.Sprintf(`[{"commit":{"committer":{"date":%q}}}]`, recent),
		"/repos/o/r/issues": `[
			{"number":10,"title":"Watched open","state":"open","labels":[{"name":"good first issue"}],"assignees":[]},
			{"number":30,"title":"Assigned","state":"open","labels":[],"assignees":[{"login":"someone"}]},
			{"number":40,"title":"A PR","state":"open","pull_request":{}}]`,
		"/repos/o/r/issues/10/comments": fmt.Sprintf(`[
			{"body":"I'll take this","html_url":"https://github.com/o/r/issues/10#c1","created_at":%q,"author_association":"NONE"}]`, recent),
		"/repos/o/r/issues/20":          fmt.Sprintf(`{"number":20,"title":"Watched closed","state":"closed","closed_at":%q,"labels":[],"assignees":[]}`, closed),
		"/repos/o/r/issues/20/timeline": `[{"event":"cross-referenced","source":{"issue":{"number":21,"html_url":"https://github.com/o/r/pull/21","pull_request":{"merged_at":"2026-10-17T00:00:00Z"}}}},{"event":"closed","commit_id":null}]`,
		"/repos/o/r/pulls": fmt.Sprintf(`[
			{"number":50,"title":"Outside denied","state":"closed","merged_at":null,"closed_at":%q,"author_association":"NONE","user":{"login":"x"}},
			{"number":51,"title":"Merged","state":"closed","merged_at":%q,"closed_at":%q,"author_association":"CONTRIBUTOR","user":{"login":"y"}},
			{"number":52,"title":"Maintainer closed own","state":"closed","merged_at":null,"closed_at":%q,"author_association":"OWNER","user":{"login":"m"}},
			{"number":53,"title":"build(deps): bump x","state":"closed","merged_at":null,"closed_at":%q,"author_association":"CONTRIBUTOR","user":{"login":"dependabot[bot]","type":"Bot"}}]`,
			closed, closed, closed, old, closed),
		"/user": `{"login":"me"}`,
		"/search/issues": `{"items":[
			{"number":77,"title":"fix: thing","state":"closed","html_url":"https://github.com/o/r/pull/77","repository_url":"https://api.github.com/repos/o/r","pull_request":{"merged_at":"2026-10-17T00:00:00Z"}},
			{"number":5,"title":"elsewhere","state":"open","html_url":"https://github.com/x/y/pull/5","repository_url":"https://api.github.com/repos/x/y","pull_request":{"merged_at":null}}]}`,
		"/repos/o/r/pulls/50/reviews":   fmt.Sprintf(`[{"state":"CHANGES_REQUESTED","submitted_at":%q}]`, old),
		"/repos/o/r/issues/50/comments": fmt.Sprintf(`[{"body":"Out of scope, sorry.","author_association":"OWNER","created_at":%q,"user":{"login":"m"}}]`, old),
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := routes[r.URL.Path]
		if !ok {
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		fmt.Fprint(w, body)
	}))
}

func TestPollRepoEndToEnd(t *testing.T) {
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	srv := fakeGitHub(t, now)
	defer srv.Close()

	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	gh := github.New("t")
	gh.BaseURL = srv.URL
	p := &Poller{GH: gh, Store: st, Now: func() time.Time { return now },
		Targets: func() ([]Target, error) {
			return []Target{{Owner: "o", Name: "r", Upstream: "https://github.com/o/r"}}, nil
		}}

	id, _ := st.UpsertRepo("o", "r", "https://github.com/o/r")
	st.AddWatch(id, 10)
	st.AddWatch(id, 20)

	if err := p.PollAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	ps := p.Status()
	if len(ps.Errors) != 0 {
		t.Fatalf("poll errors: %v", ps.Errors)
	}
	if !ps.PRsKnown || len(ps.OurPRs) != 1 || ps.OurPRs[0].Number != 77 || !ps.OurPRs[0].Merged {
		t.Errorf("our PRs should hold only the tracked, merged #77: %+v (err %q)", ps.OurPRs, ps.PRError)
	}
	if ps.CycleRequests == 0 || ps.CycleDuration <= 0 {
		t.Errorf("telemetry not recorded: %+v", ps)
	}

	rep, err := st.Report(10)
	if err != nil {
		t.Fatal(err)
	}
	r := rep[0]
	if store.HealthLabel(r.Repo) != "ACTIVE" {
		t.Errorf("health %s", store.HealthLabel(r.Repo))
	}
	if r.OpenIssuesTotal != 2 || r.OpenIssuesGFI != 1 || r.OpenIssuesUnassigned != 1 {
		t.Errorf("counts %d/%d/%d want 2/1/1", r.OpenIssuesTotal, r.OpenIssuesGFI, r.OpenIssuesUnassigned)
	}
	status := map[int]string{}
	for _, w := range r.Watch {
		status[w.Number] = w.Status
	}
	if status[10] != "claimed" || status[20] != "closed_fixed" {
		t.Errorf("watch statuses %v, want 10=claimed 20=closed_fixed", status)
	}
	if len(r.DeniedPRs) != 1 || r.DeniedPRs[0].Number != 50 ||
		r.DeniedPRs[0].ClosingComment != "Out of scope, sorry." || r.DeniedPRs[0].ReviewVerdict != "CHANGES_REQUESTED" {
		t.Errorf("denied PRs %+v", r.DeniedPRs)
	}
}

func TestPollAllContinuesPastFailingRepo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/repos/gone/") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		fmt.Fprint(w, `[]`)
	}))
	defer srv.Close()
	dir := t.TempDir()
	st, _ := store.Open(filepath.Join(dir, "m.db"))
	defer st.Close()
	gh := github.New("t")
	gh.BaseURL = srv.URL
	p := &Poller{GH: gh, Store: st, Targets: func() ([]Target, error) {
		return []Target{{Owner: "gone", Name: "x"}, {Owner: "ok", Name: "y"}}, nil
	}}
	if err := p.PollAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	errs := p.Status().Errors
	if _, failed := errs["gone/x"]; !failed || len(errs) != 1 {
		t.Errorf("want only gone/x failing, got %v", errs)
	}
	r, _ := st.RepoByName("ok", "y")
	if r == nil || r.LastPoll == nil {
		t.Error("ok/y should have been polled after gone/x failed")
	}
}

func TestClosingCommentSkipsBotsAndCIStatus(t *testing.T) {
	closed := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	before := closed.Add(-time.Hour)
	pr := github.PullRequest{User: github.User{Login: "outsider"}, ClosedAt: &closed}
	comments := []github.Comment{
		{Body: "This duplicates #10; closing.", AuthorAssociation: "MEMBER", User: github.User{Login: "maint"}, CreatedAt: &before},
		{Body: "<!-- add-pr-comment:spotless -->\nFormatting check succeeded!", AuthorAssociation: "COLLABORATOR", User: github.User{Login: "maint2", Type: "User"}, CreatedAt: &before},
		{Body: "Coverage 91%", AuthorAssociation: "MEMBER", User: github.User{Login: "codecov[bot]", Type: "Bot"}, CreatedAt: &before},
	}
	if got := closingComment(comments, pr); got != "This duplicates #10; closing." {
		t.Errorf("closing comment %q", got)
	}
	policy := []github.Comment{{Body: "<!-- impeccable-pr-policy:v1:no-approval --> This repository requires maintainer approval.", AuthorAssociation: "OWNER", User: github.User{Login: "owner"}, CreatedAt: &before}}
	if got := closingComment(policy, pr); got == "" {
		t.Error("a maintainer's policy closure is a real reason and must be kept")
	}
}

func TestCappedIssueListUsesExactTotals(t *testing.T) {
	var srv *httptest.Server
	searchFails := false
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/big/repo/issues":
			w.Header().Set("Link", fmt.Sprintf(`<%s/repos/big/repo/issues?page=2>; rel="next"`, srv.URL))
			fmt.Fprint(w, `[{"number":1,"title":"a","state":"open","labels":[],"assignees":[]}]`)
		case "/search/issues":
			if searchFails {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			q := r.URL.Query().Get("q")
			switch {
			case strings.Contains(q, "label:"):
				fmt.Fprint(w, `{"total_count":40}`)
			case strings.Contains(q, "no:assignee"):
				fmt.Fprint(w, `{"total_count":8100}`)
			case strings.Contains(q, "is:issue is:open"):
				fmt.Fprint(w, `{"total_count":9400}`)
			default:
				fmt.Fprint(w, `{"items":[]}`)
			}
		case "/user":
			fmt.Fprint(w, `{"login":"me"}`)
		default:
			fmt.Fprint(w, `[]`)
		}
	}))
	defer srv.Close()
	run := func() Status {
		st, _ := store.Open(filepath.Join(t.TempDir(), "m.db"))
		defer st.Close()
		gh := github.New("t")
		gh.BaseURL = srv.URL
		p := &Poller{GH: gh, Store: st, MaxIssuePages: 1, Targets: func() ([]Target, error) {
			return []Target{{Owner: "big", Name: "repo"}}, nil
		}}
		if err := p.PollAll(context.Background()); err != nil {
			t.Fatal(err)
		}
		return p.Status()
	}
	ps := run()
	if got, ok := ps.Totals["big/repo"]; !ok || got != (IssueTotals{Open: 9400, GFI: 40, Unassigned: 8100}) || len(ps.Errors) != 0 {
		t.Errorf("exact totals %+v ok=%v errors %v", got, ok, ps.Errors)
	}
	searchFails = true
	ps = run()
	if _, ok := ps.Totals["big/repo"]; ok || !strings.Contains(ps.Errors["big/repo"], "exact totals are unavailable") {
		t.Errorf("a failed totals search must surface as a poll failure: totals %v errors %v", ps.Totals, ps.Errors)
	}
}

func TestFindClaimSkipsYouAndBots(t *testing.T) {
	now := time.Now()
	since := now.Add(-time.Hour)
	at := now.Add(-time.Minute)
	comments := []github.Comment{
		{Body: "I'll take this", User: github.User{Login: "someone"}, CreatedAt: &at, HTMLURL: "theirs"},
		{Body: "I'm working on a fix", User: github.User{Login: "Me"}, CreatedAt: &at, HTMLURL: "mine"},
		{Body: "Taking this!", User: github.User{Login: "helper[bot]", Type: "Bot"}, CreatedAt: &at, HTMLURL: "bot"},
	}
	if c := findClaim(comments, since, "me"); c == nil || c.HTMLURL != "theirs" {
		t.Fatalf("want the other person's claim, got %+v", c)
	}
	if c := findClaim(comments[1:], since, "me"); c != nil {
		t.Fatalf("your own comment or a bot's must not count as a claim: %+v", c)
	}
}
