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

// emptyConversationsFixture is a board whose Sent has one PR but no Involved items, so
// ConvYou and ConvThem both come out empty while Work.Known is still true. The Conversations
// panel renders, but its body is the empty-state block — which is exactly the case the old
// "vast black void with one sentence" complaint was about.
func emptyConversationsFixture(now time.Time) *work.Board {
	return &work.Board{
		Login: "alice", Scope: "repos owned by alice", FetchedAt: now.Add(-time.Minute),
		Sent: []work.Item{
			{PR: true, Repo: "acme/rocket", Number: 1, Title: "fix: landing gear",
				State: "OPEN", Role: work.RoleAuthor, Move: work.MoveYou,
				CreatedAt: now.Add(-72 * time.Hour), UpdatedAt: now.Add(-3 * time.Hour)},
		},
	}
}

// Before: the empty Conversations panel read "Nobody in a thread you joined is waiting on you."
// with nothing else — a 280px panel with one short sentence at the top left and nothing to do
// about it. This test anchors the redesign: the empty state has to say what is actually true,
// name the user's next move, and link somewhere a reader can go. The old sentence is gone.
func TestConversationsEmptyStateIsInformative(t *testing.T) {
	_, body := get(t, handler(fakeSource{board: emptyConversationsFixture(time.Now())}), "/")

	if !strings.Contains(body, `data-module="conversations"`) {
		t.Fatal("conversations panel did not render; fixture broken")
	}
	// The old empty must be gone — a sentence alone is what the owner's complaint was about.
	if strings.Contains(body, `Nobody in a thread you joined is waiting on you.`) {
		t.Error("old empty-state sentence is still rendered; the redesign is not applied")
	}
	if !strings.Contains(body, `class="panel-empty"`) {
		t.Error("new empty state missing the panel-empty block")
	}
	// A clear next action — a link off the panel to the full conversations page, where the
	// quiet threads actually live.
	if !strings.Contains(body, `href="/conversations"`) {
		t.Error("empty state missing a link to the full /conversations page as the next move")
	}
	// The container element is the empty-state block; it stays inside the conversations panel.
	// Panels sit side by side in the layout grid; this one carries the data-module hook that
	// the layout presets and keyboard reordering key off of.
	re := regexp.MustCompile(`(?s)<section class="panel"[^>]*data-module="conversations"[^>]*>.*?</section>`)
	m := re.FindString(body)
	if m == "" {
		t.Fatal("conversations panel markup not matched")
	}
	if !strings.Contains(m, `class="panel-empty"`) {
		t.Error("panel-empty block is not inside the conversations panel")
	}
	// The panel must advertise its empty state so the stylesheet can compress the card to its
	// content height. The owner's complaint on the dashboard brief was not "the sentence is
	// unhelpful" — it was that the panel occupies screen it has not earned. Better content
	// without compression leaves the same void with better words in it.
	if !strings.Contains(m, `data-empty`) {
		t.Error("empty conversations panel is not marked data-empty for the compression rule")
	}
}

// TestPanelEmptyCompressionRuleExists anchors the CSS counterpart to the data-empty attribute:
// a .panel[data-empty] rule must force height off the preset-driven inline style so the empty
// card shrinks to its content. A min-height keeps the panel visibly present — a zero-height
// panel in a user's Custom layout would be a bug report waiting to happen.
func TestPanelEmptyCompressionRuleExists(t *testing.T) {
	_, body := get(t, handler(fakeSource{board: emptyConversationsFixture(time.Now())}), "/")
	if !strings.Contains(body, `.panel[data-empty]`) {
		t.Error("stylesheet has no .panel[data-empty] rule — the panel will keep its preset height even when marked empty")
	}
	if !strings.Contains(body, `height: auto !important`) {
		t.Error(".panel[data-empty] rule does not force height auto !important — the inline style set from the layout preset wins and the panel does not compress")
	}
	if !strings.Contains(body, `min-height`) {
		t.Error(".panel[data-empty] rule has no min-height — risk of collapsing a user's Custom panel to zero")
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

// A refresh that half-worked replaces the board with new, incomplete data, while one that failed
// outright leaves the old whole board on screen. The two look identical from outside and call for
// opposite responses, so the page must not describe one as the other.
func TestAPartialBoardIsNotCalledThePreviousList(t *testing.T) {
	now := time.Now()
	board := workFixture(now)

	partial := buildWork(board, "github graphql: Resource limits for this query exceeded.", true, now)
	if !partial.Partial {
		t.Error("a partial refresh did not reach the view as partial")
	}
	stale := buildWork(board, "github: 502", false, now)
	if stale.Partial {
		t.Error("a wholly failed refresh was reported as partial")
	}
	if partial.Err == "" || stale.Err == "" {
		t.Fatal("both cases should still carry their error")
	}
}
