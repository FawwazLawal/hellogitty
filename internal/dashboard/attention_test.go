package dashboard

import (
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/notify"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

func TestNotificationsLandOnTheirRows(t *testing.T) {
	now := time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)
	b := &work.Board{Login: "me", Sent: []work.Item{
		{PR: true, Role: work.RoleAuthor, Repo: "lakehq/sail", Number: 2821, Move: work.MoveThem, Head: "doctest-listfunctions"},
		{PR: true, Role: work.RoleAuthor, Repo: "hapifhir/hapi-fhir", Number: 8530, Move: work.MoveDone, Head: "fix/8504-gzip-quality-parameter"},
		{Repo: "hapifhir/hapi-fhir", Number: 8504, Role: work.RoleInvolved, Move: work.MoveThem},
		{PR: true, Role: work.RoleAuthor, Repo: "corazawaf/coraza", Number: 1785, Move: work.MoveYou},
	}}
	at := func(h int) time.Time { return now.Add(-time.Duration(h) * time.Hour) }
	items := []notify.Item{
		{ID: "1", Repo: "lakehq/sail", Number: 2821, Kind: "PullRequest", Reason: "author", Unread: true, UpdatedAt: at(1)},
		{ID: "2", Repo: "hapifhir/hapi-fhir", Kind: "CheckSuite", Reason: "ci_activity", Unread: true, UpdatedAt: at(9),
			Branch: "fix/8504-gzip-quality-parameter", Failed: true, Title: "lint workflow run failed for fix/8504-gzip-quality-parameter branch"},
		{ID: "3", Repo: "hapifhir/hapi-fhir", Number: 8504, Kind: "Issue", Reason: "comment", Unread: false, UpdatedAt: at(20)},
		{ID: "4", Repo: "o/elsewhere", Number: 9, Kind: "PullRequest", Reason: "review_requested", Unread: false, UpdatedAt: at(3), Title: "Review asked"},
		{ID: "7", Repo: "o/elsewhere", Number: 11, Kind: "Issue", Reason: "mention", Unread: false, UpdatedAt: at(3), Title: "Read mention"},
		{ID: "8", Repo: "me/app", Kind: "CheckSuite", Reason: "ci_activity", Unread: false, UpdatedAt: at(30), Failed: true, Branch: "main", Title: "Go workflow run failed for main branch"},
		{ID: "9", Repo: "me/app", Kind: "CheckSuite", Reason: "ci_activity", Unread: false, UpdatedAt: at(50), Failed: true, Branch: "main", Title: "Go workflow run failed for main branch"},
		{ID: "5", Repo: "o/elsewhere", Number: 10, Kind: "Issue", Reason: "subscribed", Unread: false, UpdatedAt: at(2), Title: "Read, nothing asked"},
		{ID: "6", Repo: "o/other", Kind: "Release", Reason: "subscribed", Unread: true, UpdatedAt: at(4), Title: "v2.0"},
	}
	a := matchNotifications(b, items, now)
	if n := a.Rows["lakehq/sail#2821"]; n.New != at(1).Unix() || n.What != "New activity" {
		t.Errorf("unread thread on a row: %+v", n)
	}
	if n := a.Rows["hapifhir/hapi-fhir#8530"]; n.What != "CI failed: lint" {
		t.Errorf("a CI run lands on the PR of its branch: %+v", a.Rows)
	}
	if _, ok := a.Rows["hapifhir/hapi-fhir#8504"]; ok {
		t.Error("a read thread is not new")
	}
	if len(a.Other) != 3 || a.Other[0].Title != "v2.0" || a.Other[0].Attn != "new" || a.Other[1].Title != "Review asked" ||
		a.Other[1].Attn != "caution" || a.Other[1].Move != work.MoveYou || a.Other[2].Key != "n:8" {
		t.Errorf("other: unread first, then read ones that still ask something, a repeated CI failure once; read mentions drop off: %+v", a.Other)
	}

	v := buildWork(b, "", false, now)
	applyAttention(&v, notify.View{State: "ok"}, a)
	dots := map[string]string{}
	for _, list := range [][]workRow{v.You, v.Them, v.Done} {
		for _, r := range list {
			dots[r.K] = r.Attn
		}
	}
	if dots["lakehq/sail#2821"] != "new" || dots["hapifhir/hapi-fhir#8504"] != "" || dots["corazawaf/coraza#1785"] != "caution" {
		t.Errorf("green unread, amber your move, hollow otherwise: %v", dots)
	}

	off := buildWork(b, "", false, now)
	applyAttention(&off, notify.View{State: "off", Note: "no"}, attention{Rows: a.Rows})
	for _, r := range off.Them {
		if r.Attn == "new" {
			t.Error("with notifications off nothing is marked new")
		}
	}
}

func TestDropClearedComesBackOnNewActivity(t *testing.T) {
	cleared := time.Date(2026, 10, 22, 8, 0, 0, 0, time.UTC)
	rows := []otherRow{
		{Key: "n:1", Updated: cleared.Add(-time.Hour)}, // cleared after its last activity: stays away
		{Key: "n:2", Updated: cleared.Add(time.Hour)},  // new activity since: back
		{Key: "n:3", Updated: cleared},                 // never cleared
	}
	got := dropCleared(rows, map[string]time.Time{"n:1": cleared, "n:2": cleared})
	if len(got) != 2 || got[0].Key != "n:2" || got[1].Key != "n:3" {
		t.Fatalf("got %+v", got)
	}
}
