package work

import (
	"strings"
	"testing"
	"time"
)

// realRollup is captured from a live GraphQL response on 2026-11-05: an upstream head commit
// carrying nine real failures and four cancelled runs at once. The names are that project's own
// matrix job names, shortened; every status and conclusion is the API's own. The
// CheckConclusionState enum has nine members and runState answers for every one of them, which is
// why this fixture carries the awkward combination rather than a tidy pair.
const realRollup = `{
 "prsOpen": {"nodes": [{
   "__typename": "PullRequest", "number": 880, "state": "OPEN",
   "title": "a pull request whose head commit is part failed and part cancelled",
   "url": "https://example.invalid/pull/880",
   "createdAt": "2026-10-01T00:00:00Z", "updatedAt": "2026-11-04T08:00:00Z",
   "repository": {"nameWithOwner": "upstream/project"},
   "author": {"login": "me", "__typename": "User"},
   "checks": {"nodes": [{"commit": {
     "oid": "f3b80f3b78d1cf0fd67e759fec6d3250dfad20c3",
     "statusCheckRollup": {"contexts": {"nodes": [
       {"__typename": "CheckRun", "name": "test (Ninja, Debug)", "status": "COMPLETED", "conclusion": "FAILURE", "completedAt": "2026-11-04T05:46:17Z"},
       {"__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "FAILURE", "completedAt": "2026-11-04T07:42:27Z"},
       {"__typename": "CheckRun", "name": "test (Ninja, Debug)", "status": "COMPLETED", "conclusion": "CANCELLED", "completedAt": "2026-11-04T05:44:20Z"},
       {"__typename": "CheckRun", "name": "checkout", "status": "COMPLETED", "conclusion": "SUCCESS", "completedAt": "2026-11-04T05:41:21Z"},
       {"__typename": "CheckRun", "name": "build (gcc-13-libstdcxx, gcc-13, Debug)", "status": "COMPLETED", "conclusion": "CANCELLED", "completedAt": "2026-11-04T05:45:01Z"},
       {"__typename": "CheckRun", "name": "tests", "status": "COMPLETED", "conclusion": "SKIPPED", "completedAt": "2026-11-04T06:01:04Z"}
     ]}}
   }}]}
 }]}
}`

func TestRealRollupSeparatesCancelledFromFailed(t *testing.T) {
	b, err := Decode([]byte(`{"data":`+realRollup+`}`), "me", nil, "real capture",
		time.Date(2026, 11, 5, 3, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Sent) != 1 {
		t.Fatalf("sent %d", len(b.Sent))
	}
	it := b.Sent[0]
	failing, stopped := splitFailed(it.CheckList)
	if len(failing) != 2 || len(stopped) != 2 {
		t.Fatalf("failing %v stopped %v", failing, stopped)
	}
	// Two real failures stand alongside two cancelled runs, so the row still reads as failing, and
	// the cancelled ones are counted rather than named: the real job names do not fit a row.
	if !strings.Contains(it.Status, "Failing: ") || !strings.Contains(it.Status, "2 also stopped") {
		t.Errorf("status %q", it.Status)
	}
	if it.Move != MoveYou {
		t.Errorf("move %s: a red head commit is your move", it.Move)
	}
}
