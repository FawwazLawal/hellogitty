package work

import (
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

func checksFailing(it *Item) bool { return it.Checks == "FAILURE" || it.Checks == "ERROR" }

func prFacts(it *Item) {
	if checksFailing(it) {
		it.Notes = append(it.Notes, "Checks failing")
	} else if it.Checks == "PENDING" || it.Checks == "EXPECTED" {
		it.Notes = append(it.Notes, "Checks running")
	} else if it.Checks == "SUCCESS" {
		it.Notes = append(it.Notes, "Checks passed")
	}
	if it.Conflict {
		it.Notes = append(it.Notes, "Merge conflict")
	}
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

// classifyMyPR handles a pull request you opened.
func classifyMyPR(it *Item, login string) {
	if finished(it) {
		return
	}
	prFacts(it)
	it.Since = since(it)
	pushedAfterChanges := it.ChangesAt != nil && it.LastCommitAt != nil && it.LastCommitAt.After(*it.ChangesAt)
	switch {
	case it.Draft:
		it.Move, it.Status = MoveYou, "Draft: mark it ready for review when it's done"
	case it.ReviewDecision == "CHANGES_REQUESTED" && !pushedAfterChanges:
		it.Move, it.Level, it.Status = MoveYou, "caution", "Changes requested by "+names(it.ChangesBy)
		if it.ChangesAt != nil {
			it.Since = *it.ChangesAt
		}
	case otherSpoke(it, login, it.LastCommitAt) && it.Last.Review != "APPROVED":
		it.Move, it.Level = MoveYou, "caution"
		it.Status = at(it.Last.Author) + " " + verb(it.Last)
	case checksFailing(it):
		it.Move, it.Level, it.Status = MoveYou, "caution", "Checks are failing"
		it.Notes = drop(it.Notes, "Checks failing")
	case it.Conflict:
		it.Move, it.Level, it.Status = MoveYou, "caution", "Merge conflict to resolve"
		it.Notes = drop(it.Notes, "Merge conflict")
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
}

// classifyMyIssue handles an issue you opened, were assigned, commented on or were mentioned in.
func classifyMyIssue(it *Item, login string) {
	if finished(it) {
		return
	}
	it.Since = since(it)
	switch {
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
		return a.Since.Before(b.Since)
	})
}
