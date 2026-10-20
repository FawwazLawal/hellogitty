package work

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Classify decides, for every item, whose move it is and says why in one sentence, then sorts
// each list: your move first (longest waiting first), then waiting on others, then finished.
func Classify(b *Board, now time.Time) {
	for i := range b.Sent {
		it := &b.Sent[i]
		if it.PR {
			classifyMyPR(it, b.Login)
		} else {
			classifyMyIssue(it, b.Login)
		}
	}
	for i := range b.Incoming {
		it := &b.Incoming[i]
		if it.PR {
			classifyIncomingPR(it, b.Login)
		} else {
			classifyIncomingIssue(it, b.Login)
		}
	}
	sortItems(b.Sent)
	sortItems(b.Incoming)
}

func at(name string) string { return "@" + name }

func names(list []string) string {
	out := make([]string, len(list))
	for i, n := range list {
		out[i] = at(n)
	}
	switch len(out) {
	case 0:
		return ""
	case 1:
		return out[0]
	case 2:
		return out[0] + " and " + out[1]
	default:
		return out[0] + ", " + out[1] + " and " + strconv.Itoa(len(out)-2) + " more"
	}
}

func same(a, b string) bool { return strings.EqualFold(a, b) }

// otherSpoke reports whether someone other than login wrote the newest activity, after t.
func otherSpoke(it *Item, login string, after *time.Time) bool {
	if it.Last == nil || same(it.Last.Author, login) {
		return false
	}
	return after == nil || it.Last.At.After(*after)
}

func since(it *Item) time.Time {
	if it.Last != nil {
		return it.Last.At
	}
	return it.UpdatedAt
}

// failingChecks and pendingChecks name the checks by state; with no per-check detail (pull requests
// that are not yours) they fall back to the combined state.
func failingChecks(it *Item) []string { return checkNames(it, CheckFailed) }
func pendingChecks(it *Item) []string { return checkNames(it, CheckPending) }

func checkNames(it *Item, state string) []string {
	var out []string
	for _, c := range it.CheckList {
		if c.State == state {
			out = append(out, c.Name)
		}
	}
	return out
}

func checksFailing(it *Item) bool {
	if len(it.CheckList) > 0 {
		return len(failingChecks(it)) > 0
	}
	return it.Checks == "FAILURE" || it.Checks == "ERROR"
}

func list(names []string, max int) string {
	if len(names) > max {
		return strings.Join(names[:max], ", ") + " and " + strconv.Itoa(len(names)-max) + " more"
	}
	return strings.Join(names, ", ")
}

func prFacts(it *Item) {
	failing, pending := failingChecks(it), pendingChecks(it)
	switch {
	case len(failing) > 0:
		it.Notes = append(it.Notes, "Failing: "+list(failing, 2))
	case len(it.CheckList) == 0 && checksFailing(it):
		it.Notes = append(it.Notes, "Checks failing")
	}
	if len(it.AwaitingApproval) > 0 {
		it.Notes = append(it.Notes, "CI awaiting maintainer approval")
	}
	switch {
	case len(pending) > 0:
		it.Notes = append(it.Notes, "Waiting on: "+list(pending, 2))
	case len(it.CheckList) == 0 && (it.Checks == "PENDING" || it.Checks == "EXPECTED"):
		it.Notes = append(it.Notes, "Checks running")
	case len(failing) == 0 && len(it.AwaitingApproval) == 0 && (it.Checks == "SUCCESS" || len(it.CheckList) > 0):
		it.Notes = append(it.Notes, "Checks passed")
	}
	if it.Conflict || it.MergeState == "DIRTY" {
		it.Notes = append(it.Notes, "Merge conflict")
	}
	if it.MergeState == "BEHIND" {
		it.Notes = append(it.Notes, "Behind "+base(it))
	}
	if n := len(openThreads(it)); n > 0 {
		it.Notes = append(it.Notes, plural(n, "unresolved thread"))
	}
}

func base(it *Item) string {
	if it.Base != "" {
		return it.Base
	}
	return "its base branch"
}

func plural(n int, s string) string {
	if n == 1 {
		return "1 " + s
	}
	return strconv.Itoa(n) + " " + s + "s"
}

// openThreads are unresolved review threads still waiting on you: ones you already answered are
// the reviewer's to resolve.
func openThreads(it *Item) []Thread {
	var out []Thread
	for _, t := range it.Threads {
		if !t.RepliedLast {
			out = append(out, t)
		}
	}
	return out
}

var (
	claPattern     = regexp.MustCompile(`(?i)(^|[^a-z])(cla|easycla|contributor license)([^a-z]|$)`)
	claLabel       = regexp.MustCompile(`(?i)cla[\s:_/-]*(pending|missing|required|needed|no|unsigned|not[\s_-]*signed)`)
	dcoPattern     = regexp.MustCompile(`(?i)(^|[^a-z])dco([^a-z]|$)`)
	waitingOnLabel = regexp.MustCompile(`(?i)(waiting|awaiting|needs?|pending)[\s:_/-]*(on[\s_-]*)?(author|response|feedback|info|information|reporter|changes|reply|contributor)`)
)

// personalAction names a step only you can take: signing a CLA or DCO, or answering a reviewer
// in your own words. Bot review comments are not personal; anyone with the branch can fix them.
func personalAction(it *Item) (short, status string) {
	for _, c := range it.CheckList {
		if c.State == CheckPassed {
			continue
		}
		label := c.Name
		if c.Detail != "" {
			label += ": " + c.Detail
		}
		if claPattern.MatchString(c.Name) || claPattern.MatchString(c.Detail) {
			return "Sign the CLA", "Sign the CLA (" + label + ")"
		}
		if dcoPattern.MatchString(c.Name) {
			return "Sign off your commits", "Sign off your commits for the DCO check (" + label + ")"
		}
	}
	for _, l := range it.Labels {
		if claLabel.MatchString(l) {
			return "Sign the CLA", "Sign the CLA (labelled " + quote(l) + ")"
		}
	}
	for _, t := range openThreads(it) {
		if !t.Bot {
			return "Reply to " + at(t.Author), at(t.Author) + " is waiting for your reply on a review comment"
		}
	}
	return "", ""
}

func quote(s string) string { return "\u201c" + s + "\u201d" }

func waitingOnYouLabel(it *Item) string {
	for _, l := range it.Labels {
		if waitingOnLabel.MatchString(l) {
			return l
		}
	}
	return ""
}

func threadQuote(t Thread) *Activity {
	return &Activity{Author: t.Author, Body: t.Body, URL: t.URL, At: t.At}
}

func finished(it *Item) bool {
	if it.State == "MERGED" {
		it.Move, it.Level, it.Status = MoveDone, "ok", "Merged"
		if it.MergedBy != "" {
			it.Status = "Merged by " + at(it.MergedBy)
		}
	} else if it.State == "CLOSED" {
		it.Move = MoveDone
		switch {
		case !it.PR && it.StateReason == "COMPLETED":
			it.Status = "Closed as completed"
		case !it.PR && it.StateReason == "NOT_PLANNED":
			it.Status = "Closed as not planned"
		case !it.PR && it.StateReason == "DUPLICATE":
			it.Status = "Closed as a duplicate"
		case it.PR:
			it.Status = "Closed without merging"
		default:
			it.Status = "Closed"
		}
	} else {
		return false
	}
	if it.ClosedAt != nil {
		it.Since = *it.ClosedAt
	} else {
		it.Since = it.UpdatedAt
	}
	return true
}

// classifyMyPR handles a pull request you opened. Anything that blocks the merge and is yours to
// fix makes it your move, whatever the review decision says: an unresolved review thread or a
// branch behind its base blocks a merge just as surely as a change request.
func classifyMyPR(it *Item, login string) {
	if finished(it) {
		return
	}
	prFacts(it)
	it.Since = since(it)
	pushedAfterChanges := it.ChangesAt != nil && it.LastCommitAt != nil && it.LastCommitAt.After(*it.ChangesAt)
	threads := openThreads(it)
	personal, personalStatus := personalAction(it)
	switch {
	case it.Draft:
		it.Move, it.Status = MoveYou, "Draft: mark it ready for review when it's done"
	case personal != "":
		it.Move, it.Level, it.Status, it.Personal = MoveYou, "caution", personalStatus, personal
		for _, t := range threads {
			if !t.Bot && "Reply to "+at(t.Author) == personal {
				it.Quote, it.Since = threadQuote(t), t.At
				break
			}
		}
	case it.ReviewDecision == "CHANGES_REQUESTED" && !pushedAfterChanges:
		it.Move, it.Level, it.Status = MoveYou, "caution", "Changes requested by "+names(it.ChangesBy)
		if it.ChangesAt != nil {
			it.Since = *it.ChangesAt
		}
	case len(threads) > 0:
		var who []string
		seen := map[string]bool{}
		for _, t := range threads {
			if !seen[t.Author] {
				seen[t.Author] = true
				who = append(who, t.Author)
			}
		}
		it.Move, it.Level = MoveYou, "caution"
		it.Status = plural(len(threads), "unresolved review comment") + " from " + names(who) + "; merging is blocked until they're resolved"
		it.Quote, it.Since = threadQuote(threads[0]), threads[0].At
		it.Notes = dropPrefix(it.Notes, "unresolved thread")
	case otherSpoke(it, login, it.LastCommitAt) && it.Last.Review != "APPROVED":
		it.Move, it.Level = MoveYou, "caution"
		it.Status = at(it.Last.Author) + " " + verb(it.Last)
	case checksFailing(it):
		it.Move, it.Level, it.Status = MoveYou, "caution", "Checks are failing"
		if f := failingChecks(it); len(f) > 0 {
			it.Status = "Failing: " + list(f, 3)
			it.Notes = dropPrefix(it.Notes, "Failing: ")
		}
		it.Notes = drop(it.Notes, "Checks failing")
	case it.Conflict || it.MergeState == "DIRTY":
		it.Move, it.Level, it.Status = MoveYou, "caution", "Merge conflict to resolve"
		it.Notes = drop(it.Notes, "Merge conflict")
	case it.MergeState == "BEHIND":
		it.Move, it.Level, it.Status = MoveYou, "caution", "Branch is behind "+base(it)+"; update it"
		it.Notes = drop(it.Notes, "Behind "+base(it))
	case waitingOnYouLabel(it) != "":
		it.Move, it.Level, it.Status = MoveYou, "caution", "Labelled "+quote(waitingOnYouLabel(it))+": the maintainers are waiting on you"
	case it.ReviewDecision == "CHANGES_REQUESTED":
		it.Move, it.Status = MoveThem, "You pushed changes; waiting for "+names(it.ChangesBy)+" to look again"
	case it.ReviewDecision == "APPROVED" || len(it.ApprovedBy) > 0:
		it.Move, it.Level, it.Status = MoveThem, "ok", "Approved by "+names(it.ApprovedBy)+"; waiting to be merged"
		if len(it.ApprovedBy) == 0 {
			it.Status = "Approved; waiting to be merged"
		}
	case len(it.Requested) > 0:
		it.Move, it.Status = MoveThem, "Review requested from "+names(it.Requested)
	case it.Last != nil:
		it.Move, it.Status = MoveThem, "You replied; waiting for a response"
	default:
		it.Move, it.Status = MoveThem, "Waiting for a first review"
		it.Since = it.CreatedAt
	}
	// CI that never ran because a maintainer has to approve it is their move, and the sentence
	// says so rather than leaving it to look like broken CI.
	if it.Move == MoveThem && len(it.AwaitingApproval) > 0 {
		it.Status += "; CI is waiting for a maintainer to approve it"
		it.Notes = drop(it.Notes, "CI awaiting maintainer approval")
	}
}

func dropPrefix(list []string, prefix string) []string {
	out := list[:0]
	for _, x := range list {
		if !strings.HasPrefix(x, prefix) && !strings.HasSuffix(x, prefix) && !strings.HasSuffix(x, prefix+"s") {
			out = append(out, x)
		}
	}
	return out
}

// classifyMyIssue handles an issue you opened, were assigned, commented on or were mentioned in.
func classifyMyIssue(it *Item, login string) {
	if finished(it) {
		return
	}
	it.Since = since(it)
	switch {
	case it.Role == RoleAuthor && waitingOnYouLabel(it) != "":
		it.Move, it.Level, it.Status = MoveYou, "caution", "Labelled "+quote(waitingOnYouLabel(it))+": the maintainers are waiting on you"
	case otherSpoke(it, login, nil) && it.Role != RoleInvolved:
		it.Move, it.Level, it.Status = MoveYou, "caution", at(it.Last.Author)+" replied"
	case otherSpoke(it, login, nil):
		it.Move, it.Level, it.Status = MoveYou, "caution", at(it.Last.Author)+" commented after you"
	case it.Role == RoleAssigned:
		it.Move, it.Status = MoveYou, "Assigned to you"
	case it.Comments == 0:
		it.Move, it.Status = MoveThem, "No replies yet"
		it.Since = it.CreatedAt
	default:
		it.Move, it.Status = MoveThem, "You replied; waiting for a response"
	}
	if it.Role == RoleAssigned && it.Move == MoveYou && it.Status != "Assigned to you" {
		it.Notes = append(it.Notes, "Assigned to you")
	}
}

// classifyIncomingPR handles a pull request waiting on you as reviewer or maintainer.
func classifyIncomingPR(it *Item, login string) {
	if finished(it) {
		return
	}
	prFacts(it)
	it.Since = since(it)
	requestedMe := false
	for _, r := range it.Requested {
		if same(r, login) {
			requestedMe = true
		}
	}
	updatedSinceReview := it.ReviewedByMeAt != nil &&
		((it.LastCommitAt != nil && it.LastCommitAt.After(*it.ReviewedByMeAt)) || otherSpoke(it, login, it.ReviewedByMeAt))
	switch {
	case it.Draft:
		it.Move, it.Status = MoveThem, "Draft from "+at(it.Author)
	case requestedMe:
		it.Move, it.Level, it.Status = MoveYou, "caution", at(it.Author)+" asked for your review"
	case updatedSinceReview:
		it.Move, it.Level, it.Status = MoveYou, "caution", "Updated since your review"
	case it.ReviewDecision == "APPROVED":
		it.Move, it.Level, it.Status = MoveYou, "ok", "Approved; ready to merge"
	case it.ReviewedByMeAt == nil && (it.Last == nil || !same(it.Last.Author, login)):
		if it.Last != nil && !same(it.Last.Author, it.Author) {
			it.Move, it.Status = MoveThem, at(it.Last.Author)+" is reviewing"
		} else {
			it.Move, it.Level, it.Status = MoveYou, "caution", "New from "+at(it.Author)+"; not reviewed yet"
			it.Since = it.CreatedAt
		}
	default:
		it.Move, it.Status = MoveThem, "Waiting on "+at(it.Author)
	}
}

// classifyIncomingIssue handles an issue in a repository you maintain.
func classifyIncomingIssue(it *Item, login string) {
	if finished(it) {
		return
	}
	it.Since = since(it)
	switch {
	case it.Comments == 0:
		it.Move, it.Level, it.Status = MoveYou, "caution", "New from "+at(it.Author)+"; no reply yet"
		it.Since = it.CreatedAt
	case otherSpoke(it, login, nil):
		it.Move, it.Level, it.Status = MoveYou, "caution", at(it.Last.Author)+" commented"
	default:
		it.Move, it.Status = MoveThem, "You replied; waiting on "+at(it.Author)
	}
}

func verb(a *Activity) string {
	switch a.Review {
	case "APPROVED":
		return "approved"
	case "CHANGES_REQUESTED":
		return "requested changes"
	case "COMMENTED":
		return "left a review"
	}
	return "commented"
}

func drop(list []string, s string) []string {
	out := list[:0]
	for _, x := range list {
		if x != s {
			out = append(out, x)
		}
	}
	return out
}

func moveRank(m string) int {
	switch m {
	case MoveYou:
		return 0
	case MoveThem:
		return 1
	default:
		return 2
	}
}

// sortItems orders your move by longest waiting, waiting-on-others by longest waiting, and
// finished work newest first.
func sortItems(items []Item) {
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if moveRank(a.Move) != moveRank(b.Move) {
			return moveRank(a.Move) < moveRank(b.Move)
		}
		if a.Move == MoveDone {
			return a.Since.After(b.Since)
		}
		if (a.Personal != "") != (b.Personal != "") {
			return a.Personal != ""
		}
		return a.Since.Before(b.Since)
	})
}
