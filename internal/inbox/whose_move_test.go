package inbox

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/work"
)

// buildOne builds a one-PR board through inbox.Build and returns its entries. seen is a stable
// no-side-effects FirstSeen that keeps the test in control of OccurredAt.
func buildOne(t *testing.T, it work.Item) []Entry {
	t.Helper()
	b := &work.Board{Login: "me", Sent: []work.Item{it}}
	return Build(b, nil, func(id string) time.Time { return time.Time{} })
}

// findKind returns the first entry of the given kind, or fails.
func findKind(t *testing.T, entries []Entry, kind string) Entry {
	t.Helper()
	for _, e := range entries {
		if e.Kind == kind {
			return e
		}
	}
	t.Fatalf("no entry of kind %q among %d entries", kind, len(entries))
	return Entry{}
}

// pre1 is a reference moment so OccurredAt assertions stay stable.
var pre1 = time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)

// prItemWithThreadActivity builds an open PR whose latest activity is a review-thread comment.
// repliedLast is carried through work.recent() in the real refresh; here we skip that step and
// stamp the Activity directly, because the inbox package is the system under test and this test
// exercises Build, not recent(). recent()'s own correctness is proved by its package test.
func prItemWithThreadActivity(repliedLast bool) work.Item {
	return work.Item{
		PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 42, State: "OPEN",
		URL: "https://github.com/o/r/pull/42", Move: work.MoveThem,
		Recent: []work.Activity{{
			Author: "reviewer", Body: "nit here", Path: "src/a.go",
			URL: "https://github.com/o/r/pull/42#discussion_r1",
			At:  pre1, Replied: &repliedLast,
		}},
	}
}

// TestInboxEntry_RepliedTrueWhenWeAnsweredLast is case (a) from the brief: the entry built from
// a review-thread activity where we had the last word must carry replied = true.
func TestInboxEntry_RepliedTrueWhenWeAnsweredLast(t *testing.T) {
	entries := buildOne(t, prItemWithThreadActivity(true))
	e := findKind(t, entries, KindComment)
	if e.Replied == nil {
		t.Fatalf("Replied = nil, want non-nil pointer to true")
	}
	if *e.Replied != true {
		t.Errorf("*Replied = %v, want true", *e.Replied)
	}
}

// TestInboxEntry_RepliedFalseWhenMaintainerAnsweredLast is case (b): the maintainer has the last
// word. false is the one value a drain reader needs most, so the pointer must distinguish it
// from the "activity did not come from a review thread" case.
func TestInboxEntry_RepliedFalseWhenMaintainerAnsweredLast(t *testing.T) {
	entries := buildOne(t, prItemWithThreadActivity(false))
	e := findKind(t, entries, KindComment)
	if e.Replied == nil {
		t.Fatalf("Replied = nil, want non-nil pointer to false")
	}
	if *e.Replied != false {
		t.Errorf("*Replied = %v, want false", *e.Replied)
	}
}

// TestInboxEntry_RepliedAbsentForIssueComment is case (c): an activity with no Replied (an issue
// comment or review body) must marshal with the "replied" key completely absent. omitempty on a
// bool pointer gives us that; the assertion must be on the raw JSON bytes, not on the struct
// field, because a nil pointer and an omitted key look identical from inside Go.
func TestInboxEntry_RepliedAbsentForIssueComment(t *testing.T) {
	it := work.Item{
		PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 43, State: "OPEN",
		URL: "https://github.com/o/r/pull/43", Move: work.MoveThem,
		Recent: []work.Activity{{
			Author: "reviewer", Body: "general note", At: pre1,
			URL: "https://github.com/o/r/pull/43#issuecomment-1",
			// Replied intentionally nil: this activity did not come from a review thread.
		}},
	}
	entries := buildOne(t, it)
	e := findKind(t, entries, KindComment)
	if e.Replied != nil {
		t.Fatalf("Replied = %v, want nil", e.Replied)
	}
	raw, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"replied"`) {
		t.Errorf("marshalled JSON still carries \"replied\" key:\n %s", raw)
	}
	if strings.Contains(string(raw), `"thread_url"`) {
		t.Errorf("marshalled JSON carries \"thread_url\" without a \"replied\": one without the other is a half-answer\n %s", raw)
	}
}

// TestInboxEntry_MoveMatchesItemMove is case (d): the entry's move field copies the item's
// Move for each of the three states. One subtest per state so a sabotage check can be read.
func TestInboxEntry_MoveMatchesItemMove(t *testing.T) {
	cases := []struct {
		name string
		move string
	}{
		{"them", work.MoveThem},
		{"you", work.MoveYou},
		{"done", work.MoveDone},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			it := work.Item{
				PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 44, State: "OPEN",
				URL: "https://github.com/o/r/pull/44", Move: tc.move,
				Recent: []work.Activity{{
					Author: "reviewer", Body: "x", At: pre1,
					URL: "https://github.com/o/r/pull/44#issuecomment-1",
				}},
			}
			entries := buildOne(t, it)
			e := findKind(t, entries, KindComment)
			if e.Move != tc.move {
				t.Errorf("Move = %q, want %q", e.Move, tc.move)
			}
		})
	}
}

// TestInboxEntry_ThreadURLPairsWithReplied is case (e): thread_url is present exactly when
// replied is non-nil, and absent otherwise. Reading one without the other would be a half
// answer, so the test asserts both directions in one place.
func TestInboxEntry_ThreadURLPairsWithReplied(t *testing.T) {
	// From a thread activity: both present.
	entries := buildOne(t, prItemWithThreadActivity(false))
	e := findKind(t, entries, KindComment)
	if e.Replied == nil {
		t.Fatalf("thread case: Replied = nil, want non-nil")
	}
	if e.ThreadURL == "" {
		t.Errorf("thread case: ThreadURL empty, want the activity URL")
	}

	// From an issue-comment activity (nil Replied): both absent.
	it := work.Item{
		PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 43, State: "OPEN",
		URL: "https://github.com/o/r/pull/43", Move: work.MoveThem,
		Recent: []work.Activity{{
			Author: "reviewer", Body: "general note", At: pre1,
			URL: "https://github.com/o/r/pull/43#issuecomment-1",
		}},
	}
	entries = buildOne(t, it)
	e = findKind(t, entries, KindComment)
	if e.Replied != nil {
		t.Errorf("non-thread case: Replied = %v, want nil", e.Replied)
	}
	if e.ThreadURL != "" {
		t.Errorf("non-thread case: ThreadURL = %q, want empty", e.ThreadURL)
	}
}
