package work

import (
	"testing"
	"time"
)

// TestRecentCarriesRepliedFromThreadsOnly feeds recent() a node with all three sources at once
// — an issue comment, a review, and two threads — and asserts that Replied is set only on the
// thread-derived activities. This is the load-bearing sentence of the whose-move change: the
// thread branch must carry t.RepliedLast and the other two branches must leave Replied nil,
// because inbox.go keys its "did this come from a review thread" check on non-nil-ness.
//
// Without this test, three different sabotages pass silently: setting Replied in the comment
// branch, setting it in the review branch, and dropping it from the thread branch. inbox.Build
// tests cannot catch any of them, because they construct Activity directly and never call
// recent().
func TestRecentCarriesRepliedFromThreadsOnly(t *testing.T) {
	at := time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)
	tp := func(d time.Duration) *time.Time { u := at.Add(d); return &u }

	// The node carries one issue comment and one review, both from someone else so recent() does
	// not drop them for being ours.
	var n node
	n.Comments.Nodes = []comment{
		{Author: &actor{Login: "maintainer"}, Body: "general note on the issue",
			URL: "https://example.invalid/pr/42#issuecomment-1", CreatedAt: tp(0)},
	}
	n.Reviews.Nodes = []comment{
		{Author: &actor{Login: "maintainer"}, Body: "please address", State: "CHANGES_REQUESTED",
			URL: "https://example.invalid/pr/42#pullrequestreview-9", CreatedAt: tp(time.Minute), Submitted: tp(time.Minute)},
	}

	// Two threads with the SAME author (so neither is filtered out of the thread branch by the
	// t.Author == login check), each distinguished only by RepliedLast. One is where we answered
	// last; the other is where the maintainer has the last word.
	threads := []Thread{
		{Author: "maintainer", Body: "nit 1", Path: "a.go",
			URL: "https://example.invalid/pr/42#discussion_r11", At: at.Add(2 * time.Minute),
			RepliedLast: true},
		{Author: "maintainer", Body: "nit 2", Path: "b.go",
			URL: "https://example.invalid/pr/42#discussion_r22", At: at.Add(3 * time.Minute),
			RepliedLast: false},
	}

	got := recent(n, threads, "me")

	byURL := map[string]Activity{}
	for _, a := range got {
		byURL[a.URL] = a
	}

	// (c) issue-comment branch — Replied must be nil, not pointer-to-false.
	if a, ok := byURL["https://example.invalid/pr/42#issuecomment-1"]; !ok {
		t.Fatal("issue comment missing from recent()")
	} else if a.Replied != nil {
		t.Errorf("issue comment: Replied = %v, want nil (it did not come from a thread)", a.Replied)
	}

	// (d) review branch — Replied must be nil for the same reason.
	if a, ok := byURL["https://example.invalid/pr/42#pullrequestreview-9"]; !ok {
		t.Fatal("review missing from recent()")
	} else if a.Replied != nil {
		t.Errorf("review: Replied = %v, want nil (it did not come from a thread)", a.Replied)
	}

	// (a) thread, we answered last — Replied non-nil, true.
	if a, ok := byURL["https://example.invalid/pr/42#discussion_r11"]; !ok {
		t.Fatal("replied-last thread missing from recent()")
	} else if a.Replied == nil {
		t.Errorf("replied-last thread: Replied = nil, want non-nil pointer to true")
	} else if *a.Replied != true {
		t.Errorf("replied-last thread: *Replied = %v, want true", *a.Replied)
	}

	// (b) thread, maintainer answered last — Replied non-nil, false. This is the drain's
	// move-signalling case and `omitempty` on a plain bool would eat it; that is why Replied is
	// a pointer.
	if a, ok := byURL["https://example.invalid/pr/42#discussion_r22"]; !ok {
		t.Fatal("maintainer-last thread missing from recent()")
	} else if a.Replied == nil {
		t.Errorf("maintainer-last thread: Replied = nil, want non-nil pointer to false")
	} else if *a.Replied != false {
		t.Errorf("maintainer-last thread: *Replied = %v, want false", *a.Replied)
	}
}
