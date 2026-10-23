package help

import "strings"

// Term is one entry of the hover help: what a word or mark on the page means, and what to do
// about it. docs/GUIDE.md uses the same words; a test fails when a term is missing from it.
type Term struct {
	Label string `json:"label"`
	Means string `json:"means"`
	Do    string `json:"do,omitempty"`
}

// Glossary returns HelloGitty's own terms, a copy the caller may change.
func Glossary() map[string]Term {
	out := make(map[string]Term, len(glossary))
	for k, v := range glossary {
		out[k] = v
	}
	return out
}

// glossary holds HelloGitty's own terms. A pipeline command adds its own words (its stages and
// verdicts) through its "glossary" field, under ids starting "p:".
var glossary = map[string]Term{
	// Your work
	"group-you":       {"Your move", "Pull requests and issues waiting on you: changes requested, a maintainer replied, checks failing, a merge conflict, a mention.", "Work down the list from the top; the longest waiting is first."},
	"group-them":      {"Waiting on others", "Out for review, waiting on a reply, or approved and waiting to be merged. Nothing for you to do yet.", ""},
	"group-other":     {"Other notifications", "Threads in your GitHub inbox that match no row here: CI on a branch with no open pull request, a review request elsewhere, a release.", "Shown while unread, then only if they still ask something of you."},
	"group-done":      {"Finished", "Merged or closed in the last 30 days.", "Folded away; open it to read how things ended."},
	"conversations":   {"Conversations", "Issues and pull requests you joined but didn't open: you commented, or someone mentioned you. Kept apart from Your work so that only what you opened counts as yours.", "Answer the ones that ask something of you; the quiet ones need nothing."},
	"group-convyou":   {"Asks something of you", "A thread you joined where someone mentioned you or replied to you since you last spoke.", "Read it and answer if it needs you."},
	"group-convthem":  {"Quiet", "Threads you joined where nobody is waiting on you.", "Nothing to do; they leave once closed."},
	"group-repoother": {"Notifications", "GitHub notifications about your own repositories that match no pull request or issue above: a failed workflow run, a release, a security alert.", "Open it on GitHub; reading it there clears the dot."},
	"group-inyou":     {"Needs you", "Pull requests and issues from others in repositories you maintain that wait on you.", "Review, answer, or merge."},
	"group-inthem":    {"Waiting on contributors", "You spoke last, or the pull request is a draft.", ""},
	"dot":             {"Dot", "Green: something new you haven't read. Amber: read, and it's your move. Hollow: read, and nothing is asked of you.", "Opening it on GitHub or from here marks it read."},
	"new":             {"New", "Activity you haven't read in your GitHub notifications; the tag says what happened.", "Open the title to read it; the dot changes within a minute."},
	"only-you":        {"Only you", "A step nobody else with the branch can take: signing a CLA, signing off commits, or answering a reviewer in your own words.", "Do these first; they sort to the top of Your move."},
	"live":            {"Live", "A running list of what just happened, newest first: new issues in tracked repositories, comments, reviews and state changes on your work, someone else's work on issues you plan to take, repositories going quiet, and GitHub notifications.", "Click a line to jump to it on the dashboard. Ack marks it seen; when a GitHub notification is behind it, that is marked read on GitHub too."},
	"watched":         {"Watched issue", "An issue you plan to take: one your pipeline command lists, or one you added with hellogitty watch owner/name 123. HelloGitty checks it every cycle for someone else being assigned or saying they're taking it, and for it closing.", "Click the eye on any issue to watch it; click a filled eye to stop."},
	"pill":            {"Repository pill", "Which repository and number this row is.", ""},

	// Note chips on a row
	"checks-failing": {"Checks failing", "One or more CI checks failed on the latest commit.", "Open the checks on GitHub, fix and push."},
	"checks-running": {"Checks running", "CI hasn't finished on the latest commit.", "Wait; the row updates when it ends."},
	"checks-passed":  {"Checks passed", "Every CI check passed on the latest commit.", ""},
	"ci-approval":    {"CI awaiting maintainer approval", "GitHub won't run this project's workflows for a first-time contributor until a maintainer approves them.", "Nothing to do but wait, or ask politely after a few days."},
	"merge-conflict": {"Merge conflict", "Your branch conflicts with the branch it merges into.", "Rebase or merge the base branch and resolve the conflict."},
	"behind":         {"Behind", "The base branch has moved on, and this project requires branches to be up to date before merging.", "Update the branch (GitHub's Update branch button, or rebase)."},
	"threads":        {"Unresolved threads", "Review comments nobody has answered or resolved. GitHub can block the merge on them even when checks pass.", "Answer or resolve each one."},
	"assigned":       {"Assigned to you", "A maintainer assigned this to you.", ""},

	// Alert cells
	"cell-watch-claimed": {"Watched issue claimed", "Someone was assigned to, or claimed in a comment, an issue you are watching: one your pipeline plans to take, or one you added with hellogitty watch.", "Check before you spend more time on it. Clear it once you've seen it; it lights again only for a new claim."},
	"cell-your-move":     {"Your move", "How many pull requests and issues wait on you, in Your work and Your repositories.", ""},
	"cell-poll-fail":     {"Check failed", "The last check of GitHub failed for the repositories or searches named.", "Usually a network or rate-limit blip; it retries on the next check."},
	"cell-data-stale":    {"Data is stale", "The last successful check of GitHub is more than 2 hours old.", "Make sure HelloGitty is still running."},
	"cell-watch-closed":  {"Watched issue closed", "An issue you are watching was closed, fixed or not.", "Unwatch it, or look at how it was fixed."},
	"cell-repo-dormant":  {"Repo dormant", "No commit for over 90 days.", "Contributions here may never be reviewed."},
	"cell-repo-slow":     {"Repo slowing", "No commit for 31 to 90 days.", ""},
	"cell-repo-flagged":  {"Repo flagged", "Your pipeline command marked these repositories for caution.", ""},
	"cell-stage-failed":  {"Stage failed", "Your pipeline command reported a failed stage.", ""},
	"cell-api-low":       {"API running low", "Under 10% of the hourly GitHub API quota remains.", "Checks slow down until the quota resets."},

	// Tracked repositories
	"health-ACTIVE":  {"Active", "A commit in the last 30 days.", ""},
	"health-SLOW":    {"Slowing", "No commit for 31 to 90 days.", ""},
	"health-DORMANT": {"Dormant", "No commit for over 90 days.", "Think twice before contributing."},
	"health-UNKNOWN": {"Not checked", "Not checked successfully yet.", ""},
	"stage-done":     {"Done", "A stage of your pipeline that is finished.", ""},
	"stage-current":  {"Current", "The stage the repository is in now.", ""},
	"stage-failed":   {"Failed", "A stage that failed.", ""},
	"col-open":       {"Open", "Open issues. Pull requests aren't counted.", ""},
	"col-gfi":        {"Good first", "Open issues labelled good first issue.", ""},
	"col-unassigned": {"Unassigned", "Open issues nobody is assigned to.", ""},
	"col-commit":     {"Last commit", "Days since the last commit to the default branch; the bar turns amber when it's old.", ""},
	"col-watching":   {"Watching", "Issues you watch here with hellogitty watch.", ""},
	"col-denied":     {"Turned down", "Outside contributors' pull requests closed without merging, among the latest 100 closed.", "Open the row to read why; it's the cheapest lesson on what a project won't take."},

	// Watched issues
	"watch-STILL_OPEN":   {"Open", "Still open and unclaimed.", ""},
	"watch-CLAIMED":      {"Claimed", "Someone was assigned or said they're working on it.", "Pick something else, or ask first."},
	"watch-CLOSED_FIXED": {"Fixed", "Closed as completed.", ""},
	"watch-CLOSED_WONT":  {"Closed", "Closed without a fix (not planned or a duplicate).", ""},

	// Header and rail
	"api":     {"GitHub API", "Calls used of GitHub's hourly REST quota of 5,000.", ""},
	"graphql": {"Your work refresh", "What the Your work request cost of GitHub's separate 5,000-point GraphQL hour.", ""},
	"rate":    {"Rate", "Merged ÷ (merged + closed) for your pull requests in tracked repositories. Open ones don't count yet.", ""},
}

// NoteTerm picks the glossary entry for a note chip by its wording.
func NoteTerm(text string) string {
	switch {
	case text == "Checks failing", strings.HasPrefix(text, "Failing: "):
		return "checks-failing"
	case text == "Checks running", strings.HasPrefix(text, "Waiting on: "):
		return "checks-running"
	case text == "Checks passed":
		return "checks-passed"
	case text == "CI awaiting maintainer approval":
		return "ci-approval"
	case text == "Merge conflict":
		return "merge-conflict"
	case strings.HasPrefix(text, "Behind "):
		return "behind"
	case strings.HasSuffix(text, "unresolved thread"), strings.HasSuffix(text, "unresolved threads"):
		return "threads"
	case text == "Assigned to you":
		return "assigned"
	}
	return ""
}
