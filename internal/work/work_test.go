package work

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)

func ts(h int) *time.Time {
	t := now.Add(time.Duration(-h) * time.Hour)
	return &t
}

func tp(t time.Time) *time.Time { return &t }

func act(who string, h int) *Activity { return &Activity{Author: who, At: *ts(h), Body: "hi"} }

func TestMyPRWhoseMove(t *testing.T) {
	cases := []struct {
		name       string
		it         Item
		move, want string
	}{
		{"draft", Item{Draft: true}, MoveYou, "Draft"},
		{"changes requested", Item{ReviewDecision: "CHANGES_REQUESTED", ChangesBy: []string{"alice"}, ChangesAt: ts(5), LastCommitAt: ts(10)}, MoveYou, "Changes requested by @alice"},
		{"pushed after changes", Item{ReviewDecision: "CHANGES_REQUESTED", ChangesBy: []string{"alice"}, ChangesAt: ts(10), LastCommitAt: ts(5)}, MoveThem, "waiting for @alice to look again"},
		{"maintainer replied", Item{Last: act("bob", 2), LastCommitAt: ts(20), Requested: []string{"bob"}}, MoveYou, "@bob commented"},
		{"reply answered by a push", Item{Last: act("bob", 20), LastCommitAt: ts(2), Requested: []string{"bob"}}, MoveThem, "Review requested from @bob"},
		{"checks failing", Item{Checks: "FAILURE"}, MoveYou, "Checks are failing"},
		{"conflict", Item{Conflict: true}, MoveYou, "Merge conflict to resolve"},
		{"approved", Item{ReviewDecision: "APPROVED", ApprovedBy: []string{"carol"}, Last: &Activity{Author: "carol", At: *ts(1), Review: "APPROVED"}}, MoveThem, "Approved by @carol"},
		{"I replied last", Item{Last: act("me", 1)}, MoveThem, "You replied"},
		{"no review yet", Item{CreatedAt: *ts(48)}, MoveThem, "Waiting for a first review"},
		{"merged", Item{State: "MERGED", MergedBy: "dave", ClosedAt: ts(3)}, MoveDone, "Merged by @dave"},
		{"denied", Item{State: "CLOSED", ClosedAt: ts(3)}, MoveDone, "Closed without merging"},
	}
	for _, c := range cases {
		it := c.it
		it.PR = true
		if it.State == "" {
			it.State = "OPEN"
		}
		classifyMyPR(&it, "me")
		if it.Move != c.move || !strings.Contains(it.Status, c.want) {
			t.Errorf("%s: got %s %q, want %s containing %q", c.name, it.Move, it.Status, c.move, c.want)
		}
	}
}

func TestMyPRKeepsSecondaryFacts(t *testing.T) {
	it := Item{PR: true, State: "OPEN", ReviewDecision: "CHANGES_REQUESTED", ChangesBy: []string{"a"}, ChangesAt: ts(1), Checks: "FAILURE", Conflict: true}
	classifyMyPR(&it, "me")
	if strings.Join(it.Notes, ",") != "Checks failing,Merge conflict" {
		t.Errorf("notes %v", it.Notes)
	}
	it = Item{PR: true, State: "OPEN", Checks: "FAILURE"}
	classifyMyPR(&it, "me")
	if len(it.Notes) != 0 {
		t.Errorf("the status already says checks fail; notes should not repeat it: %v", it.Notes)
	}
}

func TestIssuesWhoseMove(t *testing.T) {
	cases := []struct {
		name       string
		it         Item
		incoming   bool
		move, want string
	}{
		{"reply on my issue", Item{Role: RoleAuthor, Comments: 2, Last: act("maint", 1)}, false, MoveYou, "@maint replied"},
		{"no replies", Item{Role: RoleAuthor, CreatedAt: *ts(30)}, false, MoveThem, "No replies yet"},
		{"assigned", Item{Role: RoleAssigned, Comments: 1, Last: act("me", 4)}, false, MoveYou, "Assigned to you"},
		{"thread moved on", Item{Role: RoleInvolved, Comments: 3, Last: act("x", 1)}, false, MoveThem, "commented after you; nothing asked of you"},
		{"joined thread mentions me", Item{Role: RoleInvolved, Comments: 3, Last: &Activity{Author: "x", Body: "thanks @Me, can you check?", At: *ts(1)}}, false, MoveYou, "@x mentioned you"},
		{"mention of someone else", Item{Role: RoleInvolved, Comments: 3, Last: &Activity{Author: "x", Body: "cc @meshery-bot @mel", At: *ts(1)}}, false, MoveThem, "nothing asked of you"},
		{"I spoke last", Item{Role: RoleInvolved, Comments: 3, Last: act("me", 1)}, false, MoveThem, "You replied"},
		{"closed completed", Item{State: "CLOSED", StateReason: "COMPLETED", ClosedAt: ts(1)}, false, MoveDone, "Closed as completed"},
		{"new in my repo", Item{Role: RoleMaintains, Author: "newbie", CreatedAt: *ts(5)}, true, MoveYou, "New from @newbie; no reply yet"},
		{"waiting on reporter", Item{Role: RoleMaintains, Author: "r", Comments: 1, Last: act("me", 5)}, true, MoveThem, "waiting on @r"},
	}
	for _, c := range cases {
		it := c.it
		if it.State == "" {
			it.State = "OPEN"
		}
		if c.incoming {
			classifyIncomingIssue(&it, "me")
		} else {
			classifyMyIssue(&it, "me")
		}
		if it.Move != c.move || !strings.Contains(it.Status, c.want) {
			t.Errorf("%s: got %s %q, want %s containing %q", c.name, it.Move, it.Status, c.move, c.want)
		}
	}
}

func TestIncomingPRWhoseMove(t *testing.T) {
	cases := []struct {
		name       string
		it         Item
		move, want string
	}{
		{"review requested", Item{Author: "c", Requested: []string{"me"}}, MoveYou, "@c asked for your review"},
		{"unreviewed", Item{Author: "c", CreatedAt: *ts(9)}, MoveYou, "not reviewed yet"},
		{"updated since my review", Item{Author: "c", ReviewedByMeAt: ts(10), LastCommitAt: ts(2)}, MoveYou, "Updated since your review"},
		{"waiting on author", Item{Author: "c", ReviewedByMeAt: ts(2), LastCommitAt: ts(10), Last: &Activity{Author: "me", At: *ts(2), Review: "CHANGES_REQUESTED"}}, MoveThem, "Waiting on @c"},
		{"draft", Item{Author: "c", Draft: true}, MoveThem, "Draft from @c"},
		{"approved by a co-maintainer", Item{Author: "c", ReviewDecision: "APPROVED", Last: &Activity{Author: "co", At: *ts(1), Review: "APPROVED"}}, MoveYou, "ready to merge"},
	}
	for _, c := range cases {
		it := c.it
		it.PR, it.State = true, "OPEN"
		classifyIncomingPR(&it, "me")
		if it.Move != c.move || !strings.Contains(it.Status, c.want) {
			t.Errorf("%s: got %s %q, want %s containing %q", c.name, it.Move, it.Status, c.move, c.want)
		}
	}
}

func TestSortYourMoveLongestWaitingFirst(t *testing.T) {
	b := &Board{Login: "me", Sent: []Item{
		{PR: true, State: "MERGED", Title: "done", ClosedAt: ts(1)},
		{PR: true, State: "OPEN", Title: "fresh", Checks: "FAILURE", UpdatedAt: *ts(1)},
		{PR: true, State: "OPEN", Title: "waiting", CreatedAt: *ts(5)},
		{PR: true, State: "OPEN", Title: "stale", Checks: "FAILURE", UpdatedAt: *ts(50)},
	}}
	Classify(b, now)
	var got []string
	for _, it := range b.Sent {
		got = append(got, it.Title)
	}
	if strings.Join(got, ",") != "stale,fresh,waiting,done" {
		t.Errorf("order %v", got)
	}
}

const fixture = `{
 "prsOpen": {"nodes": [{
   "__typename": "PullRequest", "number": 7, "title": "Fix it", "url": "https://github.com/up/proj/pull/7", "state": "OPEN",
   "createdAt": "2026-10-10T00:00:00Z", "updatedAt": "2026-10-18T00:00:00Z",
   "repository": {"nameWithOwner": "up/proj"}, "author": {"login": "me", "__typename": "User"},
   "reviewDecision": "CHANGES_REQUESTED", "mergeable": "CONFLICTING",
   "reviewRequests": {"nodes": [{"requestedReviewer": null}, {"requestedReviewer": {"login": "lead"}}]},
   "latestOpinionatedReviews": {"nodes": [{"author": {"login": "lead", "__typename": "User"}, "state": "CHANGES_REQUESTED", "submittedAt": "2026-10-17T00:00:00Z"}]},
   "reviews": {"nodes": [{"author": {"login": "lead", "__typename": "User"}, "state": "CHANGES_REQUESTED", "body": "Please add a test.", "submittedAt": "2026-10-17T00:00:00Z", "url": "https://r"}]},
   "comments": {"totalCount": 2, "nodes": [
     {"author": {"login": "lead", "__typename": "User"}, "body": "Thanks!", "createdAt": "2026-10-16T00:00:00Z", "url": "https://c1"},
     {"author": {"login": "ci-bot", "__typename": "Bot"}, "body": "<!-- coverage --> 90%", "createdAt": "2026-10-18T00:00:00Z", "url": "https://c2"}]},
   "commits": {"nodes": [{"commit": {"committedDate": "2026-10-12T00:00:00Z", "statusCheckRollup": {"state": "SUCCESS"}}}]}
 }]},
 "prsDone": {"nodes": []},
 "issues": {"nodes": [
   {"__typename": "Issue", "number": 3, "title": "Bug", "url": "https://github.com/up/proj/issues/3", "state": "OPEN",
    "repository": {"nameWithOwner": "up/proj"}, "author": {"login": "someone", "__typename": "User"},
    "assignees": {"nodes": [{"login": "me"}]}, "comments": {"totalCount": 0, "nodes": []}},
   {"__typename": "Issue", "number": 9, "title": "In my repo", "url": "https://github.com/me/tool/issues/9", "state": "OPEN",
    "repository": {"nameWithOwner": "me/tool"}, "author": {"login": "user", "__typename": "User"},
    "assignees": {"nodes": []}, "comments": {"totalCount": 0, "nodes": []}}]},
 "issuesDone": {"nodes": []},
 "requested": {"nodes": []},
 "reviewed": {"nodes": []},
 "incoming": {"nodes": []},
 "triage": {"nodes": [
   {"__typename": "Issue", "number": 9, "title": "In my repo", "url": "https://github.com/me/tool/issues/9", "state": "OPEN",
    "repository": {"nameWithOwner": "me/tool"}, "author": {"login": "user", "__typename": "User"},
    "assignees": {"nodes": []}, "comments": {"totalCount": 0, "nodes": []}}]}
}`

func TestAssembleFromGraphQL(t *testing.T) {
	var d boardData
	if err := json.Unmarshal([]byte(fixture), &d); err != nil {
		t.Fatal(err)
	}
	b := assemble(&d, "me", nil, "repos owned by me")
	if len(b.Sent) != 2 || len(b.Incoming) != 1 {
		t.Fatalf("sent %d incoming %d; an issue in your own repo belongs under incoming only", len(b.Sent), len(b.Incoming))
	}
	pr := b.Sent[0]
	if !pr.PR || !pr.Conflict || pr.Checks != "SUCCESS" || strings.Join(pr.Requested, ",") != "lead" {
		t.Errorf("pr fields %+v", pr)
	}
	if pr.Last == nil || pr.Last.Author != "lead" || pr.Last.Review != "CHANGES_REQUESTED" || pr.Last.Body != "Please add a test." {
		t.Errorf("latest human activity should be the review, skipping the newer bot comment: %+v", pr.Last)
	}
	var who []string
	for _, a := range pr.Recent {
		who = append(who, a.Author+":"+a.Review)
	}
	if strings.Join(who, ",") != "lead:,lead:CHANGES_REQUESTED" || pr.HeadOID != "" {
		t.Errorf("recent should hold the human comment and review, not the bot's: %v", who)
	}
	if b.Sent[1].Role != RoleAssigned {
		t.Errorf("issue assigned to me: role %q", b.Sent[1].Role)
	}
	Classify(b, now)
	for _, it := range b.Sent {
		if it.Number == 7 && (it.Status != "Changes requested by @lead" || strings.Join(it.Notes, ",") != "Checks passed,Merge conflict") {
			t.Errorf("classified pr: %q %v", it.Status, it.Notes)
		}
	}
	if b.Incoming[0].Move != MoveYou {
		t.Errorf("unanswered issue in my repo should be my move: %+v", b.Incoming[0])
	}
}

func TestScope(t *testing.T) {
	q, label := scope("me", []string{"org/repo", "someorg", " "})
	if q != "user:me repo:org/repo org:someorg" || label != "repos owned by me + org/repo + someorg" {
		t.Errorf("scope %q %q", q, label)
	}
}

// The cases from the task, as they looked on live pull requests.
func TestMyPRBlockersTheReviewDecisionMisses(t *testing.T) {
	passed := []Check{{Name: "Greptile Review", State: CheckPassed}, {Name: "Cursor Bugbot", State: CheckPassed}}
	cases := []struct {
		name             string
		it               Item
		move, want, pers string
	}{
		{"bot thread blocks despite green checks and no decision (impeccable#1084)",
			Item{CheckList: passed, MergeState: "BLOCKED", Requested: []string{"pbakaus"},
				Threads: []Thread{{Author: "greptile-apps", Bot: true, Body: "Yeh/Kaf search advice is reversed", At: *ts(3)}}},
			MoveYou, "1 unresolved review comment from @greptile-apps", ""},
		{"thread you already answered is the reviewer's to resolve",
			Item{CheckList: passed, Requested: []string{"r"}, Threads: []Thread{{Author: "coderabbitai", Bot: true, RepliedLast: true}}},
			MoveThem, "Review requested from @r", ""},
		{"branch behind its base (coraza#1785)", Item{MergeState: "BEHIND", Base: "main", Requested: []string{"r"}},
			MoveYou, "Branch is behind main; update it", ""},
		{"pending CLA check (opencti#19108)",
			Item{CheckList: []Check{{Name: "filigran/cla", State: CheckPending, Detail: "CLA signature required"}}},
			MoveYou, "Sign the CLA (filigran/cla: CLA signature required)", "Sign the CLA"},
		{"CLA label", Item{Labels: []string{"cla:pending"}}, MoveYou, "Sign the CLA", "Sign the CLA"},
		{"a signed CLA is not an action", Item{CheckList: []Check{{Name: "filigran/cla", State: CheckPassed, Detail: "CLA has been signed"}}},
			MoveThem, "Waiting for a first review", ""},
		{"human reviewer waits on your words",
			Item{Threads: []Thread{{Author: "maintainer", Body: "Why this approach?", At: *ts(2)}}},
			MoveYou, "@maintainer is waiting for your reply", "Reply to @maintainer"},
		{"workflow awaiting maintainer approval is their move, said plainly",
			Item{CheckList: passed, AwaitingApproval: []string{"CI"}, Requested: []string{"pbakaus"}},
			MoveThem, "Review requested from @pbakaus; CI is waiting for a maintainer to approve it", ""},
		{"named failing check", Item{CheckList: []Check{{Name: "lint", State: CheckFailed}, {Name: "test", State: CheckPassed}}},
			MoveYou, "Failing: lint", ""},
		{"waiting-on-author label", Item{Labels: []string{"status: waiting on author"}}, MoveYou, "the maintainers are waiting on you", ""},
	}
	for _, c := range cases {
		it := c.it
		it.PR, it.State = true, "OPEN"
		classifyMyPR(&it, "me")
		if it.Move != c.move || !strings.Contains(it.Status, c.want) || it.Personal != c.pers {
			t.Errorf("%s:\n got  %s %q personal=%q notes=%v\n want %s containing %q personal=%q", c.name, it.Move, it.Status, it.Personal, it.Notes, c.move, c.want, c.pers)
		}
	}
}

func TestChecksPassedNeverHidesUnrunCI(t *testing.T) {
	it := Item{PR: true, State: "OPEN", Checks: "SUCCESS", CheckList: []Check{{Name: "a", State: CheckPassed}}, AwaitingApproval: []string{"CI"}}
	prFacts(&it)
	for _, n := range it.Notes {
		if n == "Checks passed" {
			t.Errorf("CI that never ran must not read as passed: %v", it.Notes)
		}
	}
}

func TestPersonalActionsSortFirst(t *testing.T) {
	b := &Board{Login: "me", Sent: []Item{
		{PR: true, State: "OPEN", Title: "old failing", Checks: "FAILURE", UpdatedAt: *ts(100)},
		{PR: true, State: "OPEN", Title: "cla", Labels: []string{"cla: no"}, UpdatedAt: *ts(1)},
	}}
	Classify(b, now)
	if b.Sent[0].Title != "cla" {
		t.Errorf("a step only you can take should lead Your move: %v, %v", b.Sent[0].Title, b.Sent[1].Title)
	}
}

func TestDecodeDetail(t *testing.T) {
	var n node
	err := json.Unmarshal([]byte(`{"__typename":"PullRequest","number":1,"url":"u","state":"OPEN","repository":{"nameWithOwner":"o/r"},
	 "author":{"login":"me"},"mergeStateStatus":"BLOCKED","baseRefName":"main","labels":{"nodes":[{"name":"docs"}]},
	 "reviewThreads":{"nodes":[
	   {"isResolved":false,"isOutdated":true,"path":"a.go","comments":{"nodes":[{"author":{"login":"coderabbitai","__typename":"Bot"},"body":"Fix the reason","url":"t1","createdAt":"2026-10-19T01:00:00Z"}]},"latest":{"nodes":[{"author":{"login":"me"}}]}},
	   {"isResolved":true,"comments":{"nodes":[{"author":{"login":"x"},"body":"done"}]}}]},
	 "checks":{"nodes":[{"commit":{"checkSuites":{"nodes":[{"app":{"name":"GitHub Actions"},"conclusion":"ACTION_REQUIRED","workflowRun":{"workflow":{"name":"CI"}}},{"app":{"name":"Greptile"},"conclusion":"SUCCESS"}]},
	   "statusCheckRollup":{"contexts":{"nodes":[{"__typename":"StatusContext","context":"filigran/cla","state":"PENDING","description":"CLA signature required"},{"__typename":"CheckRun","name":"Impeccable","status":"COMPLETED","conclusion":"SKIPPED"}]}}}}]}}`), &n)
	if err != nil {
		t.Fatal(err)
	}
	it := toItem(n, RoleAuthor, "me")
	if it.MergeState != "BLOCKED" || it.Base != "main" || strings.Join(it.Labels, ",") != "docs" {
		t.Errorf("fields %+v", it)
	}
	if len(it.Threads) != 1 || !it.Threads[0].Bot || !it.Threads[0].RepliedLast || !it.Threads[0].Outdated {
		t.Errorf("threads %+v", it.Threads)
	}
	if strings.Join(it.AwaitingApproval, ",") != "CI" {
		t.Errorf("awaiting approval %v", it.AwaitingApproval)
	}
	if len(it.CheckList) != 2 || it.CheckList[0].State != CheckPending || it.CheckList[0].Detail != "CLA signature required" || it.CheckList[1].State != CheckPassed {
		t.Errorf("checks %+v", it.CheckList)
	}
}

func TestAutomatedCommentsAreNotReplies(t *testing.T) {
	at := time.Date(2026, 10, 20, 3, 2, 20, 0, time.UTC)
	n := node{}
	n.Comments.Nodes = []comment{
		{Author: &actor{Login: "me"}, Body: "Here is the fix.", CreatedAt: tp(at.Add(-time.Hour))},
		// pbakaus/impeccable#1084: a policy check posting from the maintainer's own account.
		{Author: &actor{Login: "pbakaus", Typename: "User"}, Body: "<!-- impeccable-pr-policy:v1:needs-decision -->\nThe automated policy check found...", CreatedAt: tp(at)},
		// golang/go: Gerrit import notices come from gopherbot, a User account.
		{Author: &actor{Login: "gopherbot", Typename: "User"}, Body: "This PR has been imported to Gerrit for code review.", CreatedAt: tp(at.Add(time.Hour))},
	}
	if l := latest(n); l == nil || l.Author != "me" {
		t.Errorf("the newest human comment is mine: %+v", l)
	}
	if r := recent(n, nil, "me"); len(r) != 0 {
		t.Errorf("automated comments are not activity to answer: %+v", r)
	}
}
