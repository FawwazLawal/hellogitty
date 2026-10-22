package dashboard

import (
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/feed"
	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

func TestRepoDetailTabsAndNewCounts(t *testing.T) {
	now := time.Date(2026, 10, 21, 21, 0, 0, 0, time.UTC)
	rows := []feed.Row{
		{ID: "i:pbakaus/impeccable#1101", Kind: "new-issue", Repo: "pbakaus/impeccable", Number: 1101, At: now.Add(-4 * time.Hour)},
		{ID: "i:pbakaus/impeccable#1100", Kind: "new-issue", Repo: "pbakaus/impeccable", Number: 1100, At: now.Add(-5 * time.Hour), Thread: "77"},
		{ID: "i:pbakaus/impeccable#1099", Kind: "new-issue", Repo: "pbakaus/impeccable", Number: 1099, At: now.Add(-6 * time.Hour), Acked: true},
		{ID: "e:merged", Kind: "pr", Label: "Your PR", Repo: "pbakaus/impeccable", Number: 1084, Text: "Merged by @pbakaus", At: now.Add(-2 * time.Hour)},
	}
	news := newsByRepo(rows)["pbakaus/impeccable"]
	r := store.RepoReport{Repo: store.Repo{Owner: "pbakaus", Name: "impeccable"},
		NewestIssues: []store.RecentIssue{
			{Number: 1101, Title: "Stop deep pass is silent", CreatedAt: now.Add(-4 * time.Hour), Labels: []string{"needs triage"}},
			{Number: 1100, Title: "Subscribed one", CreatedAt: now.Add(-5 * time.Hour)},
			{Number: 1099, Title: "Already seen", CreatedAt: now.Add(-6 * time.Hour), Assignees: []string{"x"}},
		},
		LatestClosed: []store.ClosedPR{{Number: 1084, Title: "Arabic-script specifics", Merged: true, At: now.Add(-2 * time.Hour), AuthorAssociation: "FIRST_TIME_CONTRIBUTOR"}},
	}
	open := []OpenPR{{Number: 1102, Title: "Someone's fix", Author: "dev", CreatedAt: now.Add(-time.Hour)}, {Number: 1103, Title: "Bump deps", Author: "dependabot", Bot: true}}
	var rw row
	fillRepoDetail(&rw, r, news, open, now)
	if rw.NewCount != 3 || rw.NewIDs != "i:pbakaus/impeccable#1101 i:pbakaus/impeccable#1100 e:merged" || rw.NewIssues != 2 || rw.Tab != "issues" {
		t.Errorf("counts %d %q %d tab %s", rw.NewCount, rw.NewIDs, rw.NewIssues, rw.Tab)
	}
	if !rw.Issues[0].New || rw.Issues[0].AckID != "i:pbakaus/impeccable#1101" {
		t.Errorf("a new issue with no notification is acknowledged by looking: %+v", rw.Issues[0])
	}
	if !rw.Issues[1].New || rw.Issues[1].AckID != "" {
		t.Errorf("one with a GitHub notification behind it needs Ack in the feed: %+v", rw.Issues[1])
	}
	if rw.Issues[2].New || rw.Issues[2].Taken != "assigned" {
		t.Errorf("seen and assigned: %+v", rw.Issues[2])
	}
	if len(rw.OpenPRs) != 1 || rw.OpenPRs[0].Author != "dev" {
		t.Errorf("bots' pull requests are left out: %+v", rw.OpenPRs)
	}
	if c := rw.ClosedPRs[0]; c.State != "merged" || !c.Outside || !strings.HasSuffix(c.URL, "/pull/1084") {
		t.Errorf("closed %+v", c)
	}
	if len(rw.Activity) != 1 || rw.Activity[0].Text != "Merged by @pbakaus" {
		t.Errorf("activity %+v", rw.Activity)
	}
}

func TestBoardFillsPRsTheSearchMissed(t *testing.T) {
	created := time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC)
	search := []PR{{Owner: "corazawaf", Name: "coraza", Number: 1785, State: "open"}}
	b := &work.Board{Sent: []work.Item{
		{PR: true, Role: work.RoleAuthor, Repo: "pbakaus/impeccable", Number: 1084, State: "MERGED", Title: "Arabic-script", CreatedAt: created},
		{PR: true, Role: work.RoleAuthor, Repo: "corazawaf/coraza", Number: 1785, State: "OPEN"},
		{PR: true, Role: work.RoleAuthor, Repo: "someone/untracked", Number: 1, State: "OPEN"},
		{PR: false, Role: work.RoleAuthor, Repo: "pbakaus/impeccable", Number: 1085, State: "CLOSED"},
	}}
	reports := []store.RepoReport{{Repo: store.Repo{Owner: "pbakaus", Name: "impeccable"}}, {Repo: store.Repo{Owner: "corazawaf", Name: "coraza"}}}
	got := withBoardPRs(search, b, reports)
	if len(got) != 2 || got[1].Number != 1084 || !got[1].Merged || got[1].State != "closed" || prState(got[1]) != "Merged" {
		t.Errorf("the merged PR search missed is added once; untracked repos and issues are not: %+v", got)
	}
}
