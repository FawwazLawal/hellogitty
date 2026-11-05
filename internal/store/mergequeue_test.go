package store

import (
	"testing"
	"time"
)

// Comments captured from pytorch/pytorch, where 274 of 1106 closed-and-unmerged outside pull
// requests carry one of these. Every one of them landed on main: the project's bot rebases and
// pushes, so GitHub never sets merged, and the row read as a rejection.
const (
	mqOnceChecksPass = "### Merge started\n\nYour change will be merged once all checks pass (ETA 0-4 Hours).\n\nLearn more about merging in the wiki."
	mqForced         = "### Merge started\n\nYour change will be merged immediately since you used the force (-f) flag, **bypassing any CI checks** (ETA: 1-5 minutes)."
	mqIgnoringChecks = "### Merge started\n\nYour change will be merged while ignoring the following 1 checks: [trunk / test]"
	mqFailedCommand  = "## Merge failed\n\n**Reason**: Command `git -C /home/runner/work/pytorch/pytorch merge --squash` returned non-zero exit code"
	mqFailedChecks   = "## Merge failed\n\n**Reason**: 10 mandatory check(s) failed.  The first few are:\n- [pull / linux-jammy-py3.10-gcc11 / build]"
)

func TestAutomatedMergeIsNotADenial(t *testing.T) {
	merged := []struct{ name, comment string }{
		{"queued, waiting on checks", mqOnceChecksPass},
		{"forced past the checks", mqForced},
		{"merged ignoring some checks", mqIgnoringChecks},
	}
	for _, c := range merged {
		if !MergedElsewhere(c.comment) {
			t.Errorf("%s: read as a denial, but the change landed", c.name)
		}
	}
	// The same bot, the opposite outcome. These are still open questions or real closures and must
	// never be swallowed: the merge did not happen.
	notMerged := []struct{ name, comment string }{
		{"merge failed on a git error", mqFailedCommand},
		{"merge failed on mandatory checks", mqFailedChecks},
		{"a plain rejection", "Thanks, but we are not taking this direction."},
		{"a rejection that mentions merging something else", "Closing as a duplicate of #1742, which we are going to merge instead."},
		{"the word in prose", "Once the merge started failing we reverted; please rebase and reopen."},
	}
	for _, c := range notMerged {
		if MergedElsewhere(c.comment) {
			t.Errorf("%s: hidden from the denied list, but nothing was merged", c.name)
		}
	}
}

// The denied list and its total must both drop the automated merges, since the total is what the
// lessons are drawn from.
func TestAutomatedMergeLeavesTheDeniedListAndTheTotal(t *testing.T) {
	s := openTemp(t)
	id, _ := s.UpsertRepo("o", "r", "https://github.com/o/r")
	closed := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	for n, comment := range map[int]string{
		1: mqOnceChecksPass,
		2: mqForced,
		3: mqFailedChecks,
		4: "Closing: out of scope.",
	} {
		s.UpsertPR(PullRequest{RepoID: id, Number: n, Title: "pr", State: "closed", ClosedAt: &closed, AuthorAssociation: "NONE"})
		s.SetPRDetail(id, n, comment, "")
	}
	rep, err := s.Report(10)
	if err != nil {
		t.Fatal(err)
	}
	got := map[int]bool{}
	for _, d := range rep[0].DeniedPRs {
		got[d.Number] = true
	}
	if got[1] || got[2] {
		t.Errorf("an automated merge counted as denied: %v", got)
	}
	if !got[3] || !got[4] {
		t.Errorf("a failed merge and a plain closure must stay: %v", got)
	}
	if rep[0].DeniedPRsTotal != 2 {
		t.Errorf("denied total %d, want 2", rep[0].DeniedPRsTotal)
	}
}
