package work

import (
	"strings"
	"testing"
)

// A run that was stopped never produced a verdict. GitHub still refuses to merge over it, so it
// belongs with the failures for the purpose of blocking, and nowhere near them in the words we use.
func TestRunStateSeparatesStoppedFromFailed(t *testing.T) {
	cases := []struct {
		status, conclusion string
		state              string
		stopped            bool
	}{
		{"COMPLETED", "SUCCESS", CheckPassed, false},
		{"COMPLETED", "NEUTRAL", CheckPassed, false},
		{"COMPLETED", "SKIPPED", CheckPassed, false},
		{"COMPLETED", "ACTION_REQUIRED", CheckPending, false},
		{"IN_PROGRESS", "", CheckPending, false},
		{"COMPLETED", "FAILURE", CheckFailed, false},
		{"COMPLETED", "STARTUP_FAILURE", CheckFailed, false},
		// A run that spent its whole budget without a verdict did fail: there is something to fix.
		{"COMPLETED", "TIMED_OUT", CheckFailed, false},
		// These two were halted. Nothing failed; the next step is to run them again.
		{"COMPLETED", "CANCELLED", CheckFailed, true},
		{"COMPLETED", "STALE", CheckFailed, true},
	}
	for _, c := range cases {
		state, stopped := runState(c.status, c.conclusion)
		if state != c.state || stopped != c.stopped {
			t.Errorf("runState(%q, %q) = %q stopped=%v, want %q stopped=%v",
				c.status, c.conclusion, state, stopped, c.state, c.stopped)
		}
	}
}

// The headline a cancelled check earns is not "Failing". Reading it as a failure sends you to a log
// that holds no failure, which is the whole cost of the bug.
func TestStoppedChecksDoNotReadAsFailing(t *testing.T) {
	it := Item{PR: true, State: "OPEN",
		CheckList: []Check{{Name: "build", State: CheckFailed, Stopped: true}, {Name: "test", State: CheckPassed}}}
	classifyMyPR(&it, "me")
	if it.Move != MoveYou {
		t.Errorf("a stopped check still blocks the merge, so it is your move; got %s", it.Move)
	}
	if strings.Contains(it.Status, "Failing") {
		t.Errorf("status calls a stopped check a failure: %q", it.Status)
	}
	if !strings.Contains(it.Status, "build") {
		t.Errorf("status does not name the stopped check: %q", it.Status)
	}
}

// A list with both kinds must not hide either one behind the other: the failures by name, the
// stopped runs at least by count.
func TestFailedAndStoppedAreBothReported(t *testing.T) {
	it := Item{PR: true, State: "OPEN",
		CheckList: []Check{{Name: "lint", State: CheckFailed}, {Name: "build", State: CheckFailed, Stopped: true}}}
	classifyMyPR(&it, "me")
	if !strings.Contains(it.Status, "Failing: lint") {
		t.Errorf("a real failure alongside a stopped check must still read as failing: %q", it.Status)
	}
	// Named failures, counted stops: upstream matrix job names are too long for two named lists.
	if !strings.Contains(it.Status, "1 also stopped") {
		t.Errorf("status hides the stopped check entirely: %q", it.Status)
	}
}

func TestSplitFailed(t *testing.T) {
	failed, stopped := splitFailed([]Check{
		{Name: "lint", State: CheckFailed},
		{Name: "build", State: CheckFailed, Stopped: true},
		{Name: "test", State: CheckPassed},
		{Name: "e2e", State: CheckPending},
	})
	if strings.Join(failed, ",") != "lint" || strings.Join(stopped, ",") != "build" {
		t.Errorf("splitFailed = %v / %v", failed, stopped)
	}
}
