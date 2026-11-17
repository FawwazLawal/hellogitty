package inbox

import (
	"reflect"
	"testing"
	"time"
)

// MergeEntries preserves the last-good set and overlays fresh data from a partial cycle. The
// partial cycle may drop entries it would normally have included (the fetch that produced them
// errored), so we keep them from prev; where ids collide, next wins because its data is fresher.
func TestMergeEntries_LastGoodMergedWithNextWins(t *testing.T) {
	prev := []Entry{
		{ID: "a", Kind: KindComment, Repo: "o/x", OccurredAt: time.Date(2026, 11, 16, 1, 0, 0, 0, time.UTC), Summary: "prev-a"},
		{ID: "b", Kind: KindComment, Repo: "o/x", OccurredAt: time.Date(2026, 11, 16, 2, 0, 0, 0, time.UTC), Summary: "prev-b"},
		{ID: "c", Kind: KindComment, Repo: "o/x", OccurredAt: time.Date(2026, 11, 16, 3, 0, 0, 0, time.UTC), Summary: "prev-c"},
	}
	// next is what a partial cycle managed to produce: fewer entries, one of which (b) now carries
	// a Priority we did not have before.
	next := []Entry{
		{ID: "b", Kind: KindComment, Repo: "o/x", OccurredAt: time.Date(2026, 11, 16, 2, 0, 0, 0, time.UTC), Summary: "next-b", Priority: "high"},
		{ID: "d", Kind: KindComment, Repo: "o/x", OccurredAt: time.Date(2026, 11, 16, 4, 0, 0, 0, time.UTC), Summary: "next-d"},
	}
	got := MergeEntries(prev, next)
	ids := make([]string, len(got))
	for i, e := range got {
		ids[i] = e.ID
	}
	// Sorted returns entries oldest first (see inbox.go Sorted doc); every id from prev and next
	// must survive, and b's Summary must be next-b with Priority high.
	if want := []string{"a", "b", "c", "d"}; !reflect.DeepEqual(ids, want) {
		t.Errorf("ids: got %v, want %v", ids, want)
	}
	for _, e := range got {
		if e.ID == "b" && (e.Summary != "next-b" || e.Priority != "high") {
			t.Errorf("entry b: got summary=%q priority=%q, want next-b/high", e.Summary, e.Priority)
		}
		if e.ID == "a" && e.Summary != "prev-a" {
			t.Errorf("entry a dropped or overwritten: %+v", e)
		}
	}
}

func TestMergeEntries_NilPrev(t *testing.T) {
	next := []Entry{{ID: "x"}}
	got := MergeEntries(nil, next)
	if len(got) != 1 || got[0].ID != "x" {
		t.Errorf("nil prev: got %+v, want [{x}]", got)
	}
}

func TestMergeEntries_EmptyNext(t *testing.T) {
	prev := []Entry{{ID: "x", OccurredAt: time.Unix(1, 0).UTC()}}
	got := MergeEntries(prev, nil)
	if len(got) != 1 || got[0].ID != "x" {
		t.Errorf("empty next: got %+v, want [{x}]", got)
	}
}
