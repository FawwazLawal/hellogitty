package inbox

import "testing"

import "github.com/FawwazLawal/hellogitty/internal/work"

// The inbox line is what leaves the machine, so it is the one that must not lie. A pull request
// of ours with a cancelled build arrived on the board as "CI failing".
func TestCISummaryNamesStoppedChecksAsStopped(t *testing.T) {
	cases := []struct {
		name   string
		checks []work.Check
		want   string
	}{
		{"all stopped", []work.Check{{Name: "build", State: work.CheckFailed, Stopped: true}},
			"CI stopped before finishing: build"},
		{"all failed", []work.Check{{Name: "lint", State: work.CheckFailed}},
			"CI failing: lint"},
		{"both kinds", []work.Check{{Name: "lint", State: work.CheckFailed}, {Name: "build", State: work.CheckFailed, Stopped: true}},
			"CI failing: lint; stopped: build"},
		{"no per-check detail", nil, "CI failing"},
	}
	for _, c := range cases {
		failing, stopped := failed(c.checks)
		if got := ciSummary(failing, stopped); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// A pull request whose only blocking check was cancelled still earns an entry: it cannot merge.
func TestStoppedOnlyStillRaisesAnEntry(t *testing.T) {
	failing, stopped := failed([]work.Check{
		{Name: "build", State: work.CheckFailed, Stopped: true},
		{Name: "test", State: work.CheckPassed},
	})
	if len(failing) != 0 {
		t.Errorf("a cancelled check counted as a failure: %v", failing)
	}
	if len(failing)+len(stopped) == 0 {
		t.Error("a cancelled check must still raise an entry: it blocks the merge")
	}
}
