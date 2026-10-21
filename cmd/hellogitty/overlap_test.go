package main

import (
	"strconv"
	"testing"

	"github.com/FawwazLawal/hellogitty/internal/pipeline"
	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

func TestOverlapTargetsMergeAllThreeSources(t *testing.T) {
	ps, err := pipeline.Parse([]byte(`{"stages": ["a"], "watch": [{"repo": "o/r", "number": 1, "title": "Board"}, {"repo": "O/R", "number": 2}]}`))
	if err != nil {
		t.Fatal(err)
	}
	reports := []store.RepoReport{{Repo: store.Repo{Owner: "o", Name: "r"}, Watch: []store.WatchReport{
		{Number: 2, Status: "open"}, {Number: 3, Status: "open"}, {Number: 4, Status: "claimed"}}}}
	b := &work.Board{Sent: []work.Item{
		{PR: true, Role: work.RoleAuthor, State: "OPEN", Number: 50, Fixes: []work.IssueRef{{Repo: "o/r", Number: 1}, {Repo: "x/y", Number: 9}}},
		{PR: true, Role: work.RoleAuthor, State: "CLOSED", Number: 51, Fixes: []work.IssueRef{{Repo: "x/y", Number: 10}}},
		{PR: true, Role: work.RoleInvolved, State: "OPEN", Number: 52, Fixes: []work.IssueRef{{Repo: "x/y", Number: 11}}},
	}}
	got := overlapTargets(ps, reports, b)
	var keys []string
	for _, t := range got {
		keys = append(keys, t.Repo+"#"+strconv.Itoa(t.Number))
	}
	want := []string{"o/r#1", "O/R#2", "o/r#3", "x/y#9"}
	if len(keys) != len(want) {
		t.Fatalf("targets %v, want %v", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Errorf("targets %v, want %v", keys, want)
		}
	}
	if len(got[0].OurPRs) != 1 || got[0].OurPRs[0] != 50 || got[0].Title != "Board" || len(got[3].OurPRs) != 1 {
		t.Errorf("our PR is attached to the issue it fixes: %+v", got)
	}
}
