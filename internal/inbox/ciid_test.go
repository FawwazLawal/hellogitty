package inbox

import (
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/work"
)

func redPR(checks []work.Check) work.Item {
	return work.Item{
		PR: true, State: "OPEN", Repo: "Xahau/xahaud", Number: 927,
		HeadOID: "b139dda0123456789", Base: "dev", UpdatedAt: t0,
		CheckList: checks,
	}
}

func ciRedID(t *testing.T, it work.Item) string {
	t.Helper()
	for _, e := range prEntries(it, "me", seenAt(map[string]time.Time{}, t0)) {
		if strings.Contains(e.ID, "ci-red-") {
			return e.ID
		}
	}
	t.Fatalf("no ci-red entry for %+v", it.CheckList)
	return ""
}

// The measured case. xahaud #927 was drained when its only red was a cancelled job; forty minutes
// later the same head carried five real failures, and because the id is keyed on the head sha and
// nothing else, a reader's watermark had no way to know the entry was not the one it had dismissed.
func TestCIRedIDChangesWhenTheChecksDo(t *testing.T) {
	cancelled := ciRedID(t, redPR([]work.Check{
		{Name: "XahauGenesis_test", State: work.CheckFailed, Stopped: true},
	}))
	failures := ciRedID(t, redPR([]work.Check{
		{Name: "XahauGenesis_test", State: work.CheckFailed},
		{Name: "build (clang)", State: work.CheckFailed},
	}))
	if cancelled == failures {
		t.Errorf("a cancelled-only red and five real failures share one id: %q", cancelled)
	}
	if !strings.Contains(cancelled, "ci-red-b139dda") {
		t.Errorf("the id no longer names the head it is about: %q", cancelled)
	}
}

// The id must not move when nothing has. GitHub does not promise an order for the rollup contexts,
// so a digest taken over the order it happened to send would churn on every refresh and make the
// first test's signal worthless.
func TestCIRedIDIsStableUnderReordering(t *testing.T) {
	a := ciRedID(t, redPR([]work.Check{
		{Name: "lint", State: work.CheckFailed},
		{Name: "build", State: work.CheckFailed, Stopped: true},
		{Name: "test", State: work.CheckPassed},
	}))
	b := ciRedID(t, redPR([]work.Check{
		{Name: "test", State: work.CheckPassed},
		{Name: "build", State: work.CheckFailed, Stopped: true},
		{Name: "lint", State: work.CheckFailed},
	}))
	if a != b {
		t.Errorf("the same checks in another order gave another id:\n  %q\n  %q", a, b)
	}
}

// A failure and a stop of the same name are different facts, so they must not digest alike.
func TestCIRedIDSeparatesFailedFromStopped(t *testing.T) {
	failed := ciRedID(t, redPR([]work.Check{{Name: "build", State: work.CheckFailed}}))
	stopped := ciRedID(t, redPR([]work.Check{{Name: "build", State: work.CheckFailed, Stopped: true}}))
	if failed == stopped {
		t.Errorf("build failing and build cancelled share one id: %q", failed)
	}
}

// A red with no per-check detail still needs one stable id rather than a new one every refresh.
func TestCIRedIDWithoutPerCheckDetailIsStable(t *testing.T) {
	it := work.Item{PR: true, State: "OPEN", Repo: "o/r", Number: 1, HeadOID: "abcdef0123", Checks: "FAILURE", UpdatedAt: t0}
	if a, b := ciRedID(t, it), ciRedID(t, it); a != b {
		t.Errorf("unstable id with no check list: %q vs %q", a, b)
	}
}
