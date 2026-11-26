package inbox

import (
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/work"
)

// A label the account owner puts on their own pull request is their own action, not news: it must
// not be shouted as high priority or handed back to them as their move. A label anyone else adds on
// the same pull request, or one whose author is unknown, still is.
func TestOwnLabelOnOwnPRIsNotShouted(t *testing.T) {
	at := time.Date(2026, 11, 25, 9, 0, 0, 0, time.UTC)
	b := &work.Board{Login: "me", Sent: []work.Item{
		{PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 12, State: "OPEN", URL: "https://github.com/o/r/pull/12",
			Move:   work.MoveYou,
			Labels: []string{"blocked", "needs rebase", "triage: hold", "unsure"},
			LabeledBy: map[string]work.LabelEvent{
				"blocked":      {Actor: "me", At: at},
				"needs rebase": {Actor: "Me", At: at}, // GitHub's casing of the login may differ
				"triage: hold": {Actor: "maint", At: at},
			}},
	}}
	got := Build(b, nil, seenAt(map[string]time.Time{}, at))
	byID := map[string]Entry{}
	for _, e := range got {
		byID[e.ID] = e
	}
	for _, id := range []string{"hg-o-r-12-label-blocked", "hg-o-r-12-label-needs-rebase"} {
		if e, ok := byID[id]; ok && (e.Priority == "high" || e.Move == work.MoveYou) {
			t.Errorf("%s: the owner's own label is reported as priority %q, move %q", id, e.Priority, e.Move)
		}
	}
	for _, id := range []string{"hg-o-r-12-label-triage-hold", "hg-o-r-12-label-unsure"} {
		if e, ok := byID[id]; !ok || e.Priority != "high" {
			t.Errorf("%s: a label by someone else, or by nobody known, must stay high: %+v", id, e)
		}
	}
}

// With no login known (a board fetched before the viewer was), no label can be the owner's: an
// unattributed label must not be taken for one and dropped.
func TestUnattributedLabelStaysWithoutALogin(t *testing.T) {
	at := time.Date(2026, 11, 25, 9, 0, 0, 0, time.UTC)
	b := &work.Board{Sent: []work.Item{
		{PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 13, State: "OPEN", URL: "https://github.com/o/r/pull/13",
			Labels: []string{"unsure"}},
	}}
	for _, e := range Build(b, nil, seenAt(map[string]time.Time{}, at)) {
		if e.ID == "hg-o-r-13-label-unsure" && e.Priority == "high" {
			return
		}
	}
	t.Error("an unattributed label with no login known was dropped")
}
