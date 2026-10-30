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
	// Every one of these named something the flattening deleted. A stylesheet rule for a class with
	// no elements is dead weight; a script lookup for one is how the whole dashboard went down once.
	for _, ref := range []string{
		`querySelector(".dot")`, `querySelectorAll(".dot")`, `.dot {`, `.dot.`,
		`.group `, `.group{`, `closest(".group")`, `movetag`, `.tag.you`,
	} {
		if strings.Contains(body, ref) {
			t.Errorf("script or stylesheet still references removed vocabulary: %q", ref)
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

// The sort bar is a column-header row: it mirrors the .wi grid so each label sits over the column
// it sorts. The triage toggle is panel state rather than a column, so it belongs in the heading.
// Putting it back in the bar pushes "Updated" off the timestamp column it labels.
func TestSortBarHoldsOnlyColumnHeaders(t *testing.T) {
	_, body := get(t, handler(fakeSource{board: workFixture(time.Now())}), "/")

	bar := regexp.MustCompile(`(?s)<div class="wsort"[^>]*>(.*?)</div>`)
	found := bar.FindAllStringSubmatch(body, -1)
	if len(found) == 0 {
		t.Fatal("no sort bar rendered")
	}
	for _, m := range found {
		if strings.Contains(m[1], "triage-toggle") {
			t.Error("triage toggle is back in the sort bar; it belongs in the panel heading")
		}
		if strings.TrimSpace(m[1]) == "" {
			t.Error("an empty sort bar rendered; drop the element instead")
		}
	}
	for _, key := range []string{"your-work", "conversations", "your-repos"} {
		re := regexp.MustCompile(`(?s)<h2[^>]*>.*?data-triage="` + key + `".*?</h2>`)
		if !re.MatchString(body) {
			t.Errorf("triage toggle for %q is not in its panel heading", key)
		}
	}
}

// An amber flag on something nobody has touched in days should not read as loudly as one raised an
// hour ago. The flags keep no history of their own, so the row's own last change drives this.
func TestStaleRowsCarryTheirBucket(t *testing.T) {
	now := time.Now()
	for _, c := range []struct {
		name string
		age  time.Duration
		want string
	}{
		{"fresh", time.Hour, ""},
		{"just under a day", 23*time.Hour + 59*time.Minute, ""},
		{"a day", 24 * time.Hour, "stale"},
		{"just under a week", 7*24*time.Hour - time.Minute, "stale"},
		{"a week", 7 * 24 * time.Hour, "cold"},
		{"a month", 30 * 24 * time.Hour, "cold"},
	} {
		if got := staleness(now, now.Add(-c.age)); got != c.want {
			t.Errorf("%s: staleness = %q, want %q", c.name, got, c.want)
		}
	}
	if got := staleness(now, time.Time{}); got != "" {
		t.Errorf("a row with no timestamp should not be called stale, got %q", got)
	}
}

func TestStaleBucketReachesTheRow(t *testing.T) {
	now := time.Now()
	board := workFixture(now)
	board.Sent[0].Since = now.Add(-10 * 24 * time.Hour) // cold
	board.Sent[1].Since = now.Add(-2 * time.Hour)       // fresh
	_, body := get(t, handler(fakeSource{board: board}), "/")

	if !strings.Contains(body, `class="wi cold"`) {
		t.Error("a row untouched for ten days did not reach the page as cold")
	}
	if strings.Count(body, `class="wi"`) == 0 {
		t.Error("a row touched two hours ago should carry no staleness class")
	}
}
