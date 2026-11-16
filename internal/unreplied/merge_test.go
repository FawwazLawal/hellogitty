package unreplied

import (
	"reflect"
	"testing"
)

// MergePRs preserves PRs the last-good cycle knew about even when the partial cycle dropped them,
// and lets next win for PRs that appear in both (fresher thread counts, state).
func TestMergePRs_LastGoodMergedWithNextWins(t *testing.T) {
	prev := []PR{
		{Repo: "o/x", Number: 1, Title: "prev-one"},
		{Repo: "o/x", Number: 2, Title: "prev-two", UnrepliedThreads: []Thread{{Author: "a"}}},
		{Repo: "o/y", Number: 3, Title: "prev-three"},
	}
	next := []PR{
		// A partial cycle that only kept one PR; it has an updated title and a fresh thread count.
		{Repo: "o/x", Number: 2, Title: "next-two", UnrepliedThreads: []Thread{{Author: "a"}, {Author: "b"}}},
		{Repo: "o/z", Number: 9, Title: "next-nine"},
	}
	got := MergePRs(prev, next)
	var keys []string
	for _, p := range got {
		keys = append(keys, p.Repo)
	}
	// Order: prev first, then PRs new to next. #2 keeps its slot but carries next's data.
	if want := []string{"o/x", "o/x", "o/y", "o/z"}; !reflect.DeepEqual(keys, want) {
		t.Errorf("order: got %v, want %v", keys, want)
	}
	for _, p := range got {
		if p.Number == 2 && (p.Title != "next-two" || len(p.UnrepliedThreads) != 2) {
			t.Errorf("PR #2 not replaced by next: %+v", p)
		}
		if p.Number == 1 && p.Title != "prev-one" {
			t.Errorf("PR #1 lost from last-good: %+v", p)
		}
	}
}

func TestMergePRs_NilPrev(t *testing.T) {
	next := []PR{{Repo: "o/x", Number: 1}}
	got := MergePRs(nil, next)
	if len(got) != 1 || got[0].Number != 1 {
		t.Errorf("nil prev: got %+v", got)
	}
}
