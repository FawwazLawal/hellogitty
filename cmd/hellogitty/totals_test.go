package main

import (
	"testing"

	"github.com/FawwazLawal/hellogitty/internal/poller"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

func TestApplyTotalsReplacesCappedCounts(t *testing.T) {
	reports := []store.RepoReport{
		{Repo: store.Repo{Owner: "Big", Name: "Repo"}, OpenIssuesTotal: 808, OpenIssuesGFI: 0, OpenIssuesUnassigned: 700},
		{Repo: store.Repo{Owner: "small", Name: "one"}, OpenIssuesTotal: 12},
	}
	applyTotals(reports, map[string]poller.IssueTotals{"big/repo": {Open: 9400, GFI: 40, Unassigned: 8100}})
	if r := reports[0]; r.OpenIssuesTotal != 9400 || r.OpenIssuesGFI != 40 || r.OpenIssuesUnassigned != 8100 {
		t.Errorf("capped repo not corrected: %+v", r)
	}
	if reports[1].OpenIssuesTotal != 12 {
		t.Error("uncapped repo must keep its own count")
	}
}
