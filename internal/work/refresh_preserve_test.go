package work

import (
	"context"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

// TestRefreshPreservesLastKnownBoardOnFailure pins the invariant that got raised during the
// investigation of #283 (Dashboard: Needs-you KPI figure intermittently renders blank). The
// dashboard reads Work.Known from `b != nil`, so if a failed Refresh ever nilled `t.board`
// after a success, the "Needs you" tile would blank on the next build and the viewer would
// read "nothing needs you" about a figure the server had and lost.
//
// This test was written to CONFIRM a suspected fault; it instead DISPROVED it. The current
// `Refresh` only assigns to `t.board` under `replaced := b != nil && (err == nil || …)`, and
// there is no other write, so the preservation holds. The suspected-but-not-real mechanism
// in #283 is retracted on the issue. Keeping the test anyway: the guarantee is currently
// incidental, nothing stops someone adding an `else { t.board = nil }` tomorrow, and a test
// that documents an invariant is worth having regardless of what prompted it.
//
// If this ever goes red, #283's symptom is real and the fix sits in `Refresh`.
func TestRefreshPreservesLastKnownBoardOnFailure(t *testing.T) {
	primed := &Board{
		Login:     "alice",
		Sent:      []Item{{Repo: "owner/name", Number: 1, Title: "example", Move: MoveYou}},
		FetchedAt: time.Date(2026, 11, 7, 10, 0, 0, 0, time.UTC),
	}

	// A client pointed at a loopback port nothing listens on. The HTTP request will fail
	// quickly with a connection refused rather than wait for a real network timeout.
	gh := github.New("fake-token")
	gh.BaseURL = "http://127.0.0.1:1" // IANA-reserved port, guaranteed closed

	tr := &Tracker{GH: gh}
	tr.mu.Lock()
	tr.board = primed
	tr.login = "alice"
	tr.mu.Unlock()

	// Short-deadline context so the test cannot hang if the fetch finds a route anyway.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Expect Refresh to return an error — the whole point is that fetch fails.
	if err := tr.Refresh(ctx); err == nil {
		t.Fatalf("expected Refresh to fail with unreachable GH, got nil")
	}

	// And now the invariant: the primed board must still be there, and Snapshot must
	// report it. If this fails, Work.Known will flip false on the next dashboard.json
	// build and Needs-you will render em-dash — the exact shape #283 was filed for.
	b, errText, partial := tr.Snapshot()
	if b == nil {
		t.Fatalf("Snapshot returned nil board after failed Refresh; the primed board was discarded")
	}
	if b != primed {
		t.Errorf("Snapshot returned a different board instance; want the primed one preserved")
	}
	if b.Login != "alice" {
		t.Errorf("preserved board login = %q, want %q", b.Login, "alice")
	}
	if errText == "" {
		t.Errorf("expected Snapshot to carry the failure error; got empty string")
	}
	// Partial is only set true when a NEW (non-nil) board replaced the old one despite
	// an error. A failed fetch that returned nothing is "old but whole", not partial.
	if partial {
		t.Errorf("Partial should be false when no new board arrived; got true")
	}
}
