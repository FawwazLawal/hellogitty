package dashboard

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/work"
)

// workFixture is a board with every row kind the dashboard panels draw: work you sent, threads
// you only joined, and work coming at you. The panels that render these are behind
// {{if .Work.Known}}, so a board with no items never exercises them.
func workFixture(now time.Time) *work.Board {
	mk := func(repo string, n int, role, move, title string) work.Item {
		return work.Item{
			PR: true, Repo: repo, Number: n, Title: title, State: "OPEN",
			Role: role, Move: move,
			CreatedAt: now.Add(-72 * time.Hour), UpdatedAt: now.Add(-3 * time.Hour),
		}
	}
	return &work.Board{
		Login: "alice", Scope: "repos owned by alice", FetchedAt: now.Add(-time.Minute),
		Sent: []work.Item{
			mk("acme/rocket", 1, "", work.MoveYou, "fix: landing gear"),
			mk("acme/rocket", 2, "", work.MoveThem, "feat: autopilot"),
			mk("other/repo", 3, work.RoleInvolved, work.MoveYou, "thread that asks you"),
			mk("other/repo", 4, work.RoleInvolved, work.MoveThem, "quiet thread"),
		},
		Incoming: []work.Item{
			mk("acme/rocket", 5, "", work.MoveYou, "review requested"),
			mk("acme/rocket", 6, "", work.MoveThem, "waiting on contributor"),
		},
	}
}

// The flattening removed every .dot element but left the new-activity script querying one and
// dereferencing it without a guard, so paint() threw on the first row. That killed the rest of
// the inline script: panel collapse, the layout dialog, resizing, sorting and the triage default
// all stopped working, on any dashboard that had work to show.
func TestDashboardDoesNotReferenceRemovedIndicators(t *testing.T) {
	_, body := get(t, handler(fakeSource{board: workFixture(time.Now())}), "/")

	if !strings.Contains(body, `data-module="conversations"`) || !strings.Contains(body, `data-module="your-repos"`) {
		t.Fatal("fixture did not render the work panels, so this test proves nothing")
	}
	if strings.Contains(body, `class="dot`) {
		t.Error(`a .dot element is back in the markup; the status pill replaced it`)
	}
	for _, ref := range []string{`querySelector(".dot")`, `querySelectorAll(".dot")`, `.dot {`, `.dot.`} {
		if strings.Contains(body, ref) {
			t.Errorf("script or stylesheet still references removed .dot vocabulary: %q", ref)
		}
	}
}

// Every triage toggle needs the list it is meant to filter, or the panel silently shows
// everything while its button claims otherwise.
func TestTriageTogglesHaveTheirLists(t *testing.T) {
	_, body := get(t, handler(fakeSource{board: workFixture(time.Now())}), "/")

	keys := regexp.MustCompile(`data-triage="([a-z-]+)"`).FindAllStringSubmatch(body, -1)
	if len(keys) == 0 {
		t.Fatal("no triage toggles rendered")
	}
	for _, m := range keys {
		if !strings.Contains(body, `data-triage-list="`+m[1]+`"`) {
			t.Errorf("toggle %q has no matching data-triage-list", m[1])
		}
	}
}
