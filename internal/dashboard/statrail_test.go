package dashboard

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

// The stat rail is a compact row of four figures ABOVE the panel grid: Needs you, Open PRs,
// Repos, API headroom. Issue 232: the four numbers that answer "where do I stand right now"
// were split across three panel headings and the footer, none of them where you look first.
// The rail promotes those numbers — no new polling, no new GitHub calls — and lives as a TOP
// module so the show/hide toggle and the full-width placement come from the layout machinery
// that already carries `alerts`.

// statrailFixture builds a board with a known count waiting on the user across every
// source the rail reads: Work.You (1), Work.ConvYou (1), Work.InYou (1) — total 3 for
// "Needs you". Sent also carries one OPEN PR, one MERGED PR and one draft, so the "Open PRs"
// count (OPEN non-draft) comes out to 1. The non-rail work is kept distinct so a wrong
// column in the handler fails this fixture rather than coincidentally passing.
func statrailFixture(now time.Time) *work.Board {
	mk := func(repo string, n int, role, move, state string, pr, draft bool) work.Item {
		return work.Item{
			PR: pr, Draft: draft, Repo: repo, Number: n, Title: "x", State: state,
			Role: role, Move: move,
			CreatedAt: now.Add(-72 * time.Hour), UpdatedAt: now.Add(-3 * time.Hour),
		}
	}
	return &work.Board{
		Login: "alice", Scope: "repos owned by alice", FetchedAt: now.Add(-time.Minute),
		Sent: []work.Item{
			mk("acme/rocket", 1, "", work.MoveYou, "OPEN", true, false),   // needs-you + open PR
			mk("acme/rocket", 2, "", work.MoveThem, "OPEN", true, false),  // open PR
			mk("acme/rocket", 3, "", work.MoveThem, "MERGED", true, false), // merged PR (not open)
			mk("acme/rocket", 4, "", work.MoveThem, "OPEN", true, true),   // open draft (excluded)
			mk("other/repo", 5, work.RoleInvolved, work.MoveYou, "OPEN", false, false), // ConvYou issue
		},
		Incoming: []work.Item{
			mk("acme/rocket", 6, "", work.MoveYou, "OPEN", true, false), // InYou (another needs-you)
		},
	}
}

// statrailSource wraps fakeSource with a controllable Telemetry so APIKnown can be forced.
func statrailSource(board *work.Board, tel Telemetry, repos []store.RepoReport) fakeSource {
	return fakeSource{board: board, tel: tel, reports: repos}
}

// The rail is a layout module that lives above the grid. It carries a data-module attribute
// so the Layout dialog can show/hide it and so normalize() in web/index.html keeps it out of
// the main/rail columns via the TOP list.
func TestStatRailIsATopLayoutModuleAboveTheGrid(t *testing.T) {
	now := time.Now()
	tel := Telemetry{RateLimit: 5000, RateRemaining: 4200, LastPoll: now.Add(-time.Minute)}
	_, body := get(t, handler(statrailSource(statrailFixture(now), tel, nil)), "/")

	if !strings.Contains(body, `data-module="statrail"`) {
		t.Fatal(`no element with data-module="statrail" in the dashboard; the rail module is missing`)
	}
	// TOP is the mechanism in the page JS for a full-width module above the panel grid.
	// The rail has to be in that list, or normalize() will try to place it in main/rail
	// and the Layout dialog will not give it a row.
	topRe := regexp.MustCompile(`var TOP = \[([^\]]+)\]`)
	m := topRe.FindStringSubmatch(body)
	if m == nil {
		t.Fatal(`cannot find var TOP = [...] in the dashboard; the layout TOP mechanism moved`)
	}
	if !strings.Contains(m[1], `"statrail"`) {
		t.Errorf(`TOP list does not contain "statrail": got %q`, m[1])
	}
	// The rail must sit before the grid (that is the "above the panel grid" shape the issue
	// describes). Compare byte positions.
	rail := strings.Index(body, `data-module="statrail"`)
	grid := strings.Index(body, `<main class="grid"`)
	if rail < 0 || grid < 0 {
		t.Fatal(`cannot locate rail or grid in body`)
	}
	if rail > grid {
		t.Error(`stat rail renders after the grid starts; it must sit above it`)
	}
}

// Four tiles, in reading order, carrying the number the issue names. Each tile has the figure
// and the short label beside it, so a reader skimming left-to-right gets a count and knows what
// it counts. Tile 1 (Needs you) is the SUM of Work.You + Work.InYou + Work.ConvYou.
func TestStatRailShowsTheFourNumbersInReadingOrder(t *testing.T) {
	now := time.Now()
	tel := Telemetry{RateLimit: 5000, RateRemaining: 4200, LastPoll: now.Add(-time.Minute)}
	reports := []store.RepoReport{
		{Repo: store.Repo{Owner: "acme", Name: "rocket", Status: "active"}},
		{Repo: store.Repo{Owner: "other", Name: "repo", Status: "active"}},
		{Repo: store.Repo{Owner: "third", Name: "repo", Status: "active"}},
	}
	_, body := get(t, handler(statrailSource(statrailFixture(now), tel, reports)), "/")

	// Isolate the rail block so neighbouring numbers in the page cannot satisfy these checks.
	re := regexp.MustCompile(`(?s)<[^>]+data-module="statrail"[^>]*>(.*?)</(?:section|aside|div)>`)
	m := re.FindStringSubmatch(body)
	if m == nil {
		t.Fatal(`cannot isolate the stat-rail element from the body`)
	}
	rail := m[1]

	// Labels, in reading order.
	labels := []string{"Needs you", "Open PRs", "Repos", "API"}
	pos := -1
	for _, l := range labels {
		p := strings.Index(rail, l)
		if p < 0 {
			t.Errorf(`stat rail missing tile label %q`, l)
			continue
		}
		if p <= pos {
			t.Errorf(`stat rail tile %q is out of reading order (position %d, previous %d)`, l, p, pos)
		}
		pos = p
	}

	// The numbers each tile has to carry, with the fixture above:
	//   Needs you  = Work.You(1) + Work.InYou(1) + Work.ConvYou(1) = 3
	//   Open PRs   = Sent where PR && State==OPEN && !Draft        = 2 (ids 1, 2)
	//   Repos      = len(reports)                                   = 3
	//   API left   = RateRemaining                                  = 4200
	// Each tile declares its identity via data-rail=<key>, so we can assert the figure
	// inside the exact tile and not confuse it with another tile.
	wantFig := map[string]string{"needs": "3", "prs": "2", "repos": "3", "api": "4200"}
	for key, fig := range wantFig {
		tm := isolateTile(rail, key)
		if tm == "" {
			t.Errorf(`stat rail missing tile data-rail=%q`, key)
			continue
		}
		if !regexp.MustCompile(`\b` + fig + `\b`).MatchString(tm) {
			t.Errorf(`tile %q does not carry the expected figure %q: body=%q`, key, fig, tm)
		}
	}
}

// isolateTile returns the inner HTML of the tile element identified by data-rail=key,
// matching nested tags correctly rather than stopping at the first closing tag. The
// template renders each tile as either <a class="stat" data-rail=…> or
// <span class="stat" data-rail=…>; both have the same depth-one structure, so we walk
// characters tracking tag depth from the first "<" after data-rail=key.
func isolateTile(body, key string) string {
	anchor := `data-rail="` + key + `"`
	idx := strings.Index(body, anchor)
	if idx < 0 {
		return ""
	}
	// Find the end of the opening tag.
	gt := strings.Index(body[idx:], ">")
	if gt < 0 {
		return ""
	}
	start := idx + gt + 1
	// Walk, counting opens and closes, until depth returns to zero.
	depth := 1
	i := start
	for i < len(body) {
		lt := strings.Index(body[i:], "<")
		if lt < 0 {
			return ""
		}
		i += lt
		if i+1 < len(body) && body[i+1] == '/' {
			depth--
			if depth == 0 {
				return body[start:i]
			}
		} else if i+1 < len(body) && body[i+1] != '!' {
			depth++
		}
		i++
	}
	return ""
}

// APIKnown is false until the first poll completes. Issue 221 was about rendering a confident
// zero before the first poll; the rail must not reintroduce that failure mode in a new place.
// The API tile shows a sentinel ("—" or similar) and a label saying the quota has not been
// checked yet, NOT a "0" that reads as "quota exhausted".
func TestStatRailAPITileIsHonestWhenNotYetPolled(t *testing.T) {
	now := time.Now()
	tel := Telemetry{} // zero: no poll yet, no rate limit known
	_, body := get(t, handler(statrailSource(statrailFixture(now), tel, nil)), "/")

	api := isolateTile(body, "api")
	if api == "" {
		t.Fatal(`API tile not found; the rail must render it even when the quota is unknown`)
	}
	// A fresh process must not render a confident zero.
	if regexp.MustCompile(`>\s*0\s*<`).MatchString(api) {
		t.Error(`API tile renders a bare 0 before the first poll; that is issue 221's failure mode reintroduced in the rail`)
	}
	// It must carry some marker saying the figure is not yet known. The exact wording can
	// change; the presence of an "unknown" signal cannot.
	if !strings.Contains(api, "not checked yet") && !strings.Contains(api, "no data yet") && !strings.Contains(api, "—") {
		t.Errorf(`API tile has no "unknown" marker when the quota has not been polled; got %q`, api)
	}
}

// The rail must render a useful first paint when the work board has not come back yet
// (Work.Known is false). The Needs-you and Open-PRs tiles cannot claim a confident 0 in
// that case either — the same logic that catches the API tile.
func TestStatRailIsHonestBeforeTheFirstWorkFetch(t *testing.T) {
	now := time.Now()
	tel := Telemetry{RateLimit: 5000, RateRemaining: 4000, LastPoll: now.Add(-time.Minute)}
	// No board — Work.Known will be false.
	_, body := get(t, handler(statrailSource(nil, tel, nil)), "/")

	re := regexp.MustCompile(`(?s)<[^>]+data-module="statrail"[^>]*>(.*?)</(?:section|aside|div)>`)
	m := re.FindStringSubmatch(body)
	if m == nil {
		t.Fatal(`stat rail not rendered before the first work fetch; the rail must appear on first paint`)
	}
	rail := m[1]
	for _, key := range []string{"needs", "prs"} {
		tm := isolateTile(rail, key)
		if tm == "" {
			t.Errorf(`tile %q missing before the first work fetch`, key)
			continue
		}
		if regexp.MustCompile(`>\s*0\s*<`).MatchString(tm) {
			t.Errorf(`tile %q renders a confident 0 before the work board arrives`, key)
		}
	}
	// Saying "not fetched yet" in small type is not enough. The placeholder dash is set in
	// the same size and weight as a real figure, so a reader scanning the rail for numbers
	// reads it as one and only discovers otherwise by stopping to read the label. The tile
	// has to be marked so the figure can be dimmed, the way the API tile already is.
	for _, key := range []string{"needs", "prs"} {
		open := regexp.MustCompile(`<[^>]*data-rail="` + key + `"[^>]*>`).FindString(rail)
		if open == "" {
			t.Errorf(`tile %q missing before the first work fetch`, key)
			continue
		}
		if !strings.Contains(open, "unknown") {
			t.Errorf("tile %q has no figure yet but is not marked unknown, so its dash renders at full figure weight: %s", key, open)
		}
	}
}
