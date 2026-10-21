package feed

import (
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/inbox"
	"github.com/FawwazLawal/hellogitty/internal/notify"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

var now = time.Date(2026, 10, 21, 21, 0, 0, 0, time.UTC)

func at(h float64) time.Time { return now.Add(-time.Duration(h * float64(time.Hour))) }

// The owner's two misses on 2026-10-21: impeccable#1101 filed at 17:07Z, and the first merge,
// impeccable#1084 at 19:20Z.
func TestFeedMergesEverythingNewestFirst(t *testing.T) {
	in := Input{Now: now,
		Entries: []inbox.Entry{
			{ID: "hg-pbakaus-impeccable-1084-merged", Kind: inbox.KindState, Repo: "pbakaus/impeccable", Number: 1084, Summary: "Merged by @pbakaus",
				URL: "https://github.com/pbakaus/impeccable/pull/1084", Actor: "pbakaus", OccurredAt: at(1.67)},
			{ID: "hg-golang-go-81807-overlap-pr-81940", Kind: inbox.KindOverlap, Repo: "golang/go", Number: 81807, Summary: "Another pull request cites this issue", OccurredAt: at(30)},
			{ID: "hg-pbakaus-impeccable-1101-new-issue", Kind: inbox.KindNewIssue, Repo: "pbakaus/impeccable", Number: 1101, OccurredAt: at(3.9)},
			{ID: "old", Kind: inbox.KindComment, Repo: "o/r", Number: 1, OccurredAt: at(24 * 8)},
		},
		Issues: []store.RecentIssue{{Repo: "pbakaus/impeccable", Number: 1101, Title: "Live mode misses DESIGN.md edits", CreatedAt: at(3.9)}},
		Health: []HealthChange{{Repo: "BurntSushi/ripgrep", State: "SLOW", At: at(2)}},
		Notes: []notify.Item{
			{ID: "100", Repo: "pbakaus/impeccable", Number: 1084, Reason: "state_change", Unread: false, UpdatedAt: at(1.6)},
			{ID: "101", Repo: "pbakaus/impeccable", Number: 1084, Reason: "comment", Unread: true, UpdatedAt: at(1.5)},
			{ID: "200", Repo: "x/y", Number: 5, Reason: "mention", Unread: true, UpdatedAt: at(0.5), Title: "Ping"},
			{ID: "300", Repo: "x/y", Number: 6, Reason: "subscribed", Unread: false, UpdatedAt: at(0.2), Title: "Read already"},
		},
		Acked: map[string]time.Time{"e:hg-golang-go-81807-overlap-pr-81940": at(1)},
	}
	rows := Build(in)
	var ids []string
	byID := map[string]Row{}
	for _, r := range rows {
		ids = append(ids, r.ID)
		byID[r.ID] = r
	}
	want := []string{"n:300", "n:200", "e:hg-pbakaus-impeccable-1084-merged", "h:burntsushi/ripgrep-slow", "i:pbakaus/impeccable#1101", "e:hg-golang-go-81807-overlap-pr-81940"}
	if len(ids) != len(want) {
		t.Fatalf("rows %v, want %v", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("order %v, want %v", ids, want)
		}
	}
	m := byID["e:hg-pbakaus-impeccable-1084-merged"]
	if m.Label != "Your PR" || m.Thread != "101" || m.Acked || m.Key != "pbakaus/impeccable#1084" {
		t.Errorf("the merge carries the newest notification about the same PR, still unread: %+v", m)
	}
	if n := byID["i:pbakaus/impeccable#1101"]; n.Label != "New issue" || n.Text != "Live mode misses DESIGN.md edits" || n.URL != "https://github.com/pbakaus/impeccable/issues/1101" {
		t.Errorf("new issue %+v", n)
	}
	if !byID["e:hg-golang-go-81807-overlap-pr-81940"].Acked || byID["e:hg-golang-go-81807-overlap-pr-81940"].Thread != "" {
		t.Error("acknowledged here, with no GitHub thread behind it")
	}
	if !byID["n:300"].Acked || byID["n:200"].Acked {
		t.Error("a notification read on GitHub is acknowledged; an unread one isn't")
	}
	if _, ok := byID["n:100"]; ok {
		t.Error("an older thread about the same PR is not a row of its own")
	}
}
