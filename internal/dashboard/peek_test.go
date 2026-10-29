package dashboard

import (
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

func lines(p peek) map[string]string {
	out := map[string]string{}
	for _, l := range p.Lines {
		out[l.Label] = strings.Join(l.Items, " | ")
	}
	return out
}

func TestWorkPeekShowsWhatTheRowHasNoRoomFor(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	it := work.Item{PR: true, Repo: "o/r", Number: 7, State: "OPEN", Author: "me", CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-time.Hour),
		CheckList:  []work.Check{{Name: "lint", State: work.CheckFailed}, {Name: "build", State: work.CheckPending}, {Name: "a", State: work.CheckPassed}, {Name: "b", State: work.CheckPassed}},
		ApprovedBy: []string{"ann"}, Requested: []string{"bob"}, Head: "fix/x", Base: "main",
		Fixes:  []work.IssueRef{{Repo: "o/r", Number: 3}, {Repo: "o/docs", Number: 9}},
		Recent: []work.Activity{{Author: "ann", Body: "Looks **good**", At: now.Add(-2 * time.Hour)}, {Author: "bot", Bot: true, Body: "noise", At: now}},
	}
	p := workPeek(it, "me", now, map[string][]store.Overlap{"o/r#7": {{Hard: true, Summary: "Another pull request cites this issue"}}})
	got := lines(p)
	want := map[string]string{
		"Opened": "2026-10-19, Mon 12:00", "Updated": "11:00", "Checks": "Failed: lint · Running: build · 2 passed",
		"Reviews": "Approved by @ann | Asked: @bob", "Branch": "fix/x → main", "Fixes": "#3, o/docs#9",
		"Recent": "@ann: Looks good", "Someone else": "Another pull request cites this issue",
	}
	if p.Head != "Pull request · open" {
		t.Errorf("head %q", p.Head)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s: got %q want %q", k, got[k], v)
		}
	}
	if _, ok := got["Assigned"]; ok {
		t.Error("an unknown line is left out, not shown empty")
	}
	if p.Lines[2].Level != "caution" {
		t.Errorf("failed checks are amber: %+v", p.Lines[2])
	}
}

func TestRepoPeek(t *testing.T) {
	rw := row{Owner: "o", Name: "r", Health: "SLOW", AgeKnown: true, AgeDays: 40, Open: 9, GFI: 1, Unassigned: 5,
		InPipeline: true, Stage: "build", Label: "PASS",
		Denied: []store.DeniedPR{{Number: 12, Title: "Add thing", ClosingComment: "Closing since I believe #13 addressed the same problem."}}}
	got := lines(repoPeek(rw, time.Now(), []store.Overlap{{Repo: "O/R", Number: 4, Hard: true, Summary: "Assigned to @x"}, {Repo: "x/y", Number: 1}}))
	for k, v := range map[string]string{
		"Health": "Slowing, last commit 40 days ago", "Issues": "9 open · 1 good first · 5 unassigned", "Pipeline": "Stage build · PASS",
		"Last turned down": "#12 Add thing: “Closing since I believe #13 addressed the same problem.”", "Someone else": "#4: Assigned to @x",
	} {
		if got[k] != v {
			t.Errorf("%s: got %q want %q", k, got[k], v)
		}
	}
}

func TestPageCarriesTheGlossaryAndPeeks(t *testing.T) {
	now := time.Now()
	st := pipeFixture(t)
	st.Glossary = map[string]string{"PASS": "Gate passed: safe to contribute.", "GAT": "Gate stage."}
	src := fakeSource{pipe: st, reports: []store.RepoReport{{Repo: store.Repo{Owner: "acme", Name: "rocket", LastPoll: &now}}},
		board: &work.Board{Login: "me", Sent: []work.Item{{PR: true, Role: work.RoleAuthor, Repo: "acme/rocket", Number: 5, State: "OPEN",
			Title: "Fix it", Move: work.MoveThem, CreatedAt: now.Add(-time.Hour), Head: "fix/it", Base: "main"}}}}
	_, body := get(t, handler(src), "/")
	for _, want := range []string{
		`<script type="application/json" id="glossary">{`, `"p:PASS":{"label":"PASS","means":"Gate passed: safe to contribute."}`,
		`<span class="gate ok" data-term="p:PASS">PASS</span>`, `data-term="p:GAT" tabindex="0" data-extra="gate">GAT</span>`,
		`<template class="peek"><div class="pk"><b class="pk-h">Pull request · open</b>`, `<dt>Branch</dt><dd>fix/it → main</dd>`,
		`<b class="pk-h">acme/rocket</b>`, `data-rsort="denied" role="button" tabindex="0" data-term="col-denied">Turned down</span>`, `data-term="cell-your-move"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %s", want)
		}
	}
	if strings.Contains(body, `data-term="p:RCN"`) {
		t.Error("a word the pipeline doesn't explain is not marked")
	}
}

// Every panel is a module the layout script can show, hide, fold and move (ADR-002).
func TestPanelsAreModules(t *testing.T) {
	now := time.Now()
	src := fakeSource{pipe: pipeFixture(t), reports: []store.RepoReport{{Repo: store.Repo{Owner: "acme", Name: "rocket", LastPoll: &now}}},
		board: &work.Board{Login: "me"}}
	_, body := get(t, handler(src), "/")
	for _, id := range []string{"alerts", "your-work", "your-repos", "tracked", "watched", "pipeline", "checks", "work-them", "work-done"} {
		if !strings.Contains(body, `data-module="`+id+`"`) {
			t.Errorf("module %s missing", id)
		}
	}
	for _, want := range []string{`<button type="button" class="headbtn" id="layout-open" aria-haspopup="dialog">`,
		`<dialog id="layout" class="sheet" aria-labelledby="layout-h">`, `data-preset="focus"`} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %s", want)
		}
	}
}
