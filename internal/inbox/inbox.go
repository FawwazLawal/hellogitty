// Package inbox writes a small JSON file of recent events on your own open pull requests, on
// watched issues, and on issues where someone else may be doing the work you planned, so a script can pick them up without calling GitHub. The file is rewritten in full
// after every refresh with everything currently pertinent; a reader tells new entries from seen ones
// by their ids, which stay the same for the same real-world event across rewrites.
package inbox

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

// Entry kinds.
const (
	KindComment  = "pr_comment"
	KindReview   = "pr_review"
	KindState    = "pr_state"
	KindWatched  = "watched_issue"
	KindLabel    = "pr_label"      // a label someone added to a pull request you opened, unless it is a known-benign one
	KindBot      = "pr_bot"        // a bot's open findings on a pull request you opened: one entry per pull request
	KindNewIssue = "new_issue"     // a new issue plausibly yours to take, in a repository where you plan work
	KindIssue    = "issue_comment" // a reply on an issue that is your move: one you opened or were assigned, or one that mentions you
	KindOverlap      = "issue_overlap"       // someone else is on an issue you plan to take: a PR, an assignee, a claim, a close
	KindSimilar      = "issue_similar"       // another PR's title shares the subject; only worth a look
	KindCrossRef     = "pr_cross_reference"
	KindCommentReply = "issue_comment_reply" // someone replied to our comment on an issue
)

type Entry struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	Repo       string    `json:"repo"`
	Number     int       `json:"number"`
	URL        string    `json:"url"`
	Actor      string    `json:"actor"`
	OccurredAt time.Time `json:"occurred_at"`
	Summary    string    `json:"summary"`
	// Priority is "high" for what must never wait: your pull request closed without merging, or a
	// label nobody has said is harmless. Absent otherwise.
	Priority string `json:"priority,omitempty"`

	Body              string     `json:"body,omitempty"`
	ReviewState       string     `json:"review_state,omitempty"`
	Path              string     `json:"path,omitempty"`
	AuthorAssociation string     `json:"author_association,omitempty"`
	FirstSeenAt       *time.Time `json:"first_seen_at,omitempty"`
	AgeHours          float64    `json:"age_hours,omitempty"`
}

const SchemaVersion = 2

type File struct {
	SchemaVersion       int       `json:"schema_version"`
	GeneratedAt         time.Time `json:"generated_at"`
	PollIntervalMinutes int       `json:"poll_interval_minutes"`
	Entries             []Entry   `json:"entries"`
}

// FirstSeen returns a stable time for an event GitHub does not timestamp (the first time it was
// seen); see store.FirstSeen.
type FirstSeen func(id string) time.Time

var fragment = regexp.MustCompile(`#(issuecomment|pullrequestreview|discussion_r)-?(\d+)$`)

// Build lists what is pertinent now: comments, reviews and state changes on pull requests you
// opened, replies that made an issue your move, and watched issues someone claimed or closed.
// Nothing else: no new issues, repo health or other people's pull requests.
func Build(b *work.Board, reports []store.RepoReport, seen FirstSeen) []Entry {
	var out []Entry
	if b != nil {
		for _, it := range b.Sent {
			if it.PR && it.Role == work.RoleAuthor {
				out = append(out, prEntries(it, b.Login, seen)...)
				out = append(out, labelEntries(it, seen)...)
				if e, ok := botEntry(it); ok {
					out = append(out, e)
				}
			}
			if e, ok := issueEntry(it, b.Login, seen); ok {
				out = append(out, e)
			}
		}
	}
	for _, r := range reports {
		for _, w := range r.Watch {
			if e, ok := watchEntry(r, w, seen); ok {
				out = append(out, e)
			}
		}
	}
	sortEntries(out)
	return out
}

// WithOverlaps adds what the overlap watcher reported, for the issues it is still watching: one
// entry per issue, the report of something that happened if there is one, else the "worth a look".
// An issue that leaves the watch list takes its entry with it. A watched-issue entry for the same
// issue is dropped, so each issue says one thing.
func WithOverlaps(entries []Entry, rows []store.Overlap, watching map[string]bool) []Entry {
	pick := map[string]store.Overlap{}
	var order []string
	for _, o := range rows {
		k := strings.ToLower(o.Repo) + "#" + strconv.Itoa(o.Number)
		if !watching[k] {
			continue
		}
		prev, ok := pick[k]
		if !ok {
			order = append(order, k)
		}
		if !ok || (o.Hard && !prev.Hard) {
			pick[k] = o
		}
	}
	if len(pick) == 0 {
		return entries
	}
	out := make([]Entry, 0, len(entries)+len(pick))
	for _, e := range entries {
		if _, dup := pick[strings.ToLower(e.Repo)+"#"+strconv.Itoa(e.Number)]; dup && e.Kind == KindWatched {
			continue
		}
		out = append(out, e)
	}
	for _, k := range order {
		o := pick[k]
		id, kind := "hg-"+slug(o.Repo)+"-"+strconv.Itoa(o.Number)+"-", KindSimilar
		if o.Hard {
			id, kind = id+"overlap-"+o.Signal, KindOverlap
		} else {
			id += o.Signal
		}
		at := o.OccurredAt
		if at.IsZero() {
			at = o.ReportedAt
		}
		out = append(out, Entry{ID: id, Kind: kind, Repo: o.Repo, Number: o.Number, URL: o.URL, Actor: o.Actor,
			OccurredAt: at.UTC(), Summary: o.Summary})
	}
	sortEntries(out)
	return out
}

func sortEntries(out []Entry) {
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].OccurredAt.Equal(out[j].OccurredAt) {
			return out[i].OccurredAt.Before(out[j].OccurredAt)
		}
		return out[i].ID < out[j].ID
	})
}

func prEntries(it work.Item, login string, seen FirstSeen) []Entry {
	base := "hg-" + slug(it.Repo) + "-" + strconv.Itoa(it.Number) + "-"
	entry := func(id, kind, url, actor string, at time.Time, summary string) Entry {
		if url == "" {
			url = it.URL
		}
		if at.IsZero() {
			at = seen(base + id)
		}
		return Entry{ID: base + id, Kind: kind, Repo: it.Repo, Number: it.Number, URL: url, Actor: actor, OccurredAt: at.UTC(), Summary: summary}
	}
	var out []Entry
	switch it.State {
	case "MERGED":
		at := it.UpdatedAt
		if it.ClosedAt != nil {
			at = *it.ClosedAt
		}
		summary := "Merged"
		if it.MergedBy != "" {
			summary = "Merged by @" + it.MergedBy
		}
		return append(out, entry("merged", KindState, "", it.MergedBy, at, summary))
	case "CLOSED":
		at := it.UpdatedAt
		if it.ClosedAt != nil {
			at = *it.ClosedAt
		}
		if it.ClosedBy != "" && strings.EqualFold(it.ClosedBy, login) {
			return append(out, entry("closed", KindState, "", it.ClosedBy, at, "You closed it without merging"))
		}
		e := entry("closed", KindState, "", it.ClosedBy, at, closedSummary(it))
		e.Priority = "high"
		return append(out, e)
	}

	for _, a := range it.Recent {
		if a.Bot {
			continue // a bot's findings are one pr_bot entry for the whole pull request, not one per comment
		}
		kind, summary := KindComment, oneLine(a.Body, 160)
		if a.Review != "" {
			kind = KindReview
			summary = a.Review
			if threads := humanThreads(it.Threads); threads > 0 && a.Review == "CHANGES_REQUESTED" {
				summary += ", " + plural(threads, "unresolved inline comment")
			}
			if a.Body != "" {
				summary += ": " + oneLine(a.Body, 140)
			}
		} else if a.Path != "" {
			summary = "Inline on " + filepath.Base(a.Path) + ": " + oneLine(a.Body, 140)
		}
		if summary == "" {
			summary = "Commented"
		}
		e := entry(eventID(a.URL), kind, a.URL, a.Author, a.At, summary)
		e.Body = a.Body
		e.ReviewState = a.Review
		e.Path = a.Path
		e.AuthorAssociation = a.AuthorAssociation
		out = append(out, e)
	}

	reviewed := false
	for _, a := range it.Recent {
		if a.Review == "CHANGES_REQUESTED" && it.ChangesAt != nil && a.At.Equal(*it.ChangesAt) {
			reviewed = true // the review entry already says it
		}
	}
	if it.ReviewDecision == "CHANGES_REQUESTED" && it.ChangesAt != nil && !reviewed {
		out = append(out, entry("changes-requested-"+strconv.FormatInt(it.ChangesAt.Unix(), 10), KindState, "",
			strings.Join(it.ChangesBy, ","), *it.ChangesAt, "Changes requested by "+at(it.ChangesBy)))
	}
	if failing := failed(it.CheckList); len(failing) > 0 || (len(it.CheckList) == 0 && (it.Checks == "FAILURE" || it.Checks == "ERROR")) {
		id := "ci-red-" + short(it.HeadOID)
		when := latestTime(it.CheckList)
		if when.IsZero() {
			when = seen(base + id)
		}
		summary := "CI failing"
		if len(failing) > 0 {
			summary += ": " + strings.Join(failing, ", ")
		}
		out = append(out, entry(id, KindState, "", "", when, summary))
	}
	if it.Conflict || it.MergeState == "DIRTY" {
		id := "conflict-" + short(it.HeadOID)
		out = append(out, entry(id, KindState, "", "", seen(base+id), "Merge conflict with "+branch(it.Base)))
	}
	return out
}

var (
	actionableCount = regexp.MustCompile(`(?i)actionable comments posted:\s*(\d+)`)
	badgeLine       = regexp.MustCompile(`^\s*\*\*[^\n]*\|[^\n]*\n+`) // "**🎯 Correctness** | **🟡 Minor**"
)

// finding is one thing a bot asks to be fixed.
type finding struct {
	bot, id, what string
	at            time.Time
}

// botEntry reports what bots still ask to be fixed on an open pull request you opened, as one entry
// for the whole pull request. Only findings count, never chatter:
//   - a bot's review comment on the code that is still unresolved and on current code;
//   - a bot's standing "changes requested" review;
//   - a bot review saying "Actionable comments posted: N" with N above zero, when no commit has
//     come since (after a push the review threads above are the truth: bots resolve their own
//     threads when a commit addresses them).
//
// Summaries, coverage reports, "LGTM" and canned prompts never match any of these. Failing checks,
// including a CLA check, already have their own ci-red entry. The id carries the newest finding, so
// a re-review replaces the entry instead of adding one, and the entry goes when nothing is left.
func botEntry(it work.Item) (Entry, bool) {
	if !it.PR || it.Role != work.RoleAuthor || it.State != "OPEN" {
		return Entry{}, false
	}
	var fs []finding
	threads := map[string]int{}
	for _, t := range it.Threads {
		if !t.Bot || t.Outdated {
			continue
		}
		threads[t.Author]++
		what := oneLine(badgeLine.ReplaceAllString(t.Body, ""), 120)
		if t.Path != "" {
			what = "Inline on " + filepath.Base(t.Path) + ": " + what
		}
		fs = append(fs, finding{t.Author, eventID(t.URL), what, t.At})
	}
	for _, b := range it.BotChanges {
		fs = append(fs, finding{b, "changes-" + strings.ToLower(b), "@" + b + " requested changes", time.Time{}})
	}
	latest := map[string]work.Activity{}
	for _, r := range it.BotReviews {
		latest[r.Author] = r // oldest first, so the last one wins
	}
	for bot, r := range latest {
		m := actionableCount.FindStringSubmatch(r.Body)
		if m == nil || m[1] == "0" || threads[bot] > 0 || (it.LastCommitAt != nil && it.LastCommitAt.After(r.At)) {
			continue
		}
		fs = append(fs, finding{bot, eventID(r.URL), "@" + bot + ": " + m[1] + " actionable comments posted", r.At})
	}
	if len(fs) == 0 {
		return Entry{}, false
	}
	sort.SliceStable(fs, func(i, j int) bool { return fs[i].at.After(fs[j].at) })
	newest := fs[0]
	bots := map[string]bool{}
	for _, f := range fs {
		bots[f.bot] = true
	}
	summary := plural(len(fs), "open finding") + " from " + at(sortedKeys(bots)) + ". Newest: " + newest.what
	when := newest.at
	if when.IsZero() {
		when = it.UpdatedAt
	}
	return Entry{ID: "hg-" + slug(it.Repo) + "-" + strconv.Itoa(it.Number) + "-bot-" + newest.id, Kind: KindBot, Repo: it.Repo,
		Number: it.Number, URL: it.URL, Actor: newest.bot, OccurredAt: when.UTC(), Summary: summary}, true
}

func humanThreads(ts []work.Thread) int {
	n := 0
	for _, t := range ts {
		if !t.Bot {
			n++
		}
	}
	return n
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// closedSummary says who closed a pull request of yours without merging it and what they said.
// A close with no comment says so in words: a silent close is a stronger signal, not a weaker one.
func closedSummary(it work.Item) string {
	s := "Closed without merging"
	if it.ClosedBy != "" {
		s += " by @" + it.ClosedBy
	}
	said := it.Last != nil && it.Last.Body != "" && (it.ClosedBy == "" || strings.EqualFold(it.Last.Author, it.ClosedBy))
	switch {
	case said && it.ClosedBy != "":
		s += ": \u201c" + oneLine(it.Last.Body, 120) + "\u201d"
	case said:
		s += ": @" + it.Last.Author + ": " + oneLine(it.Last.Body, 120)
	case it.ClosedBy != "":
		s += ", with no comment"
	}
	var odd []string
	for _, l := range it.Labels {
		if !benign(l) {
			odd = append(odd, "\u201c"+l+"\u201d")
		}
	}
	if len(odd) > 0 {
		s += "; labelled " + strings.Join(odd, ", ")
	}
	return s
}

// benignNames are labels known to say nothing about how a pull request is received. Anything else,
// above all a label never seen before, is reported: a keyword list would have missed
// "suspicious automation".
var nonWord = regexp.MustCompile(`[^a-z0-9]+`)

var benignNames = map[string]bool{"community": true, "documentation": true, "docs": true, "enhancement": true,
	"bug": true, "feature": true, "dependencies": true, "tests": true}

// benign reports whether a label is known to be harmless: a named one, or a size or area tag.
func benign(label string) bool {
	l := strings.ToLower(strings.TrimSpace(label))
	for _, p := range []string{"size/", "size:", "area/", "area:"} {
		if strings.HasPrefix(l, p) {
			return true
		}
	}
	return benignNames[l]
}

// labelEntries reports each label on a pull request of yours that isn't known to be benign, one
// entry per label, for as long as the label stays.
func labelEntries(it work.Item, seen FirstSeen) []Entry {
	var out []Entry
	base := "hg-" + slug(it.Repo) + "-" + strconv.Itoa(it.Number) + "-label-"
	for _, l := range it.Labels {
		if benign(l) {
			continue
		}
		id := base + strings.Trim(nonWord.ReplaceAllString(strings.ToLower(l), "-"), "-")
		ev, known := it.LabeledBy[l]
		when := ev.At
		if !known || when.IsZero() {
			when = seen(id)
		}
		summary := "Labelled \u201c" + l + "\u201d"
		if ev.Actor != "" {
			summary += " by @" + ev.Actor
		}
		if it.State == "CLOSED" {
			summary += " (now closed without merging)"
		}
		out = append(out, Entry{ID: id, Kind: KindLabel, Repo: it.Repo, Number: it.Number, URL: it.URL, Actor: ev.Actor,
			OccurredAt: when.UTC(), Summary: summary, Priority: "high"})
	}
	return out
}

// NewIssueWindow is how long a new issue stays news.
const NewIssueWindow = 24 * time.Hour

// notTasks are labels that mark an issue as something other than work to pick up.
var notTasks = map[string]bool{"duplicate": true, "invalid": true, "question": true, "wontfix": true, "won't fix": true,
	"spam": true, "discussion": true}

// NewIssues reports new issues that are plausibly yours to take, as ONE entry per repository: in a
// repository where you are planning work (planning holds "owner/name" in lower case), opened in the
// last day, nobody assigned, nobody claiming it in a comment, and not labelled as a non-task. Busy
// projects open dozens a day (golang/go opened 59 in two days), so one entry per issue would bury
// everything else; the activity feed lists each one. The entry names the newest few and how many
// there are. Its id carries the newest issue, so a new arrival replaces the entry rather than adding
// one, and it goes when none are left.
func NewIssues(issues []store.RecentIssue, planning map[string]bool, now time.Time) []Entry {
	byRepo := map[string][]store.RecentIssue{}
	var order []string
	for _, i := range issues {
		if !planning[strings.ToLower(i.Repo)] || len(i.Assignees) > 0 || i.ClaimSignal != "" || now.Sub(i.CreatedAt) > NewIssueWindow {
			continue
		}
		skip := false
		for _, l := range i.Labels {
			if notTasks[strings.ToLower(l)] {
				skip = true
			}
		}
		if skip {
			continue
		}
		if _, ok := byRepo[i.Repo]; !ok {
			order = append(order, i.Repo)
		}
		byRepo[i.Repo] = append(byRepo[i.Repo], i)
	}
	var out []Entry
	for _, repo := range order {
		list := byRepo[repo]
		sort.SliceStable(list, func(a, b int) bool { return list[a].CreatedAt.After(list[b].CreatedAt) })
		newest := list[0]
		var names []string
		for _, i := range list[:min(3, len(list))] {
			names = append(names, "#"+strconv.Itoa(i.Number)+" "+oneLine(i.Title, 70))
		}
		summary := plural(len(list), "new unassigned issue") + " in the last day: " + strings.Join(names, "; ")
		if len(list) > 3 {
			summary += "; and " + strconv.Itoa(len(list)-3) + " more"
		}
		out = append(out, Entry{ID: "hg-" + slug(repo) + "-new-issues-" + strconv.Itoa(newest.Number), Kind: KindNewIssue,
			Repo: repo, Number: newest.Number, URL: "https://github.com/" + repo + "/issues?q=is%3Aissue+is%3Aopen+no%3Aassignee+sort%3Acreated-desc",
			OccurredAt: newest.CreatedAt.UTC(), Summary: summary})
	}
	return out
}

func CrossRefEntries(refs []store.CrossReference) []Entry {
	var out []Entry
	for _, cr := range refs {
		summary := "Referenced by " + cr.RefRepo + "#" + strconv.Itoa(cr.RefNumber)
		if cr.RefAuthor != "" {
			summary += " from @" + cr.RefAuthor
		}
		if cr.RefTitle != "" {
			summary += ": " + oneLine(cr.RefTitle, 120)
		}
		if cr.RefState != "" && cr.RefState != "OPEN" {
			summary += " (" + strings.ToLower(cr.RefState) + ")"
		}
		id := "hg-" + slug(cr.OurRepo) + "-" + strconv.Itoa(cr.OurNumber) + "-xref-" + slug(cr.RefRepo) + "-" + strconv.Itoa(cr.RefNumber)
		url := cr.RefURL
		if url == "" {
			url = "https://github.com/" + cr.OurRepo + "/pull/" + strconv.Itoa(cr.OurNumber)
		}
		out = append(out, Entry{
			ID:         id,
			Kind:       KindCrossRef,
			Repo:       cr.OurRepo,
			Number:     cr.OurNumber,
			URL:        url,
			Actor:      cr.RefAuthor,
			OccurredAt: cr.RefAt.UTC(),
			Summary:    summary,
		})
	}
	return out
}

// CommentReplies converts replies to our issue comments into inbox entries.
func CommentReplies(replies []store.CommentReply) []Entry {
	var out []Entry
	for _, r := range replies {
		summary := oneLine(r.Body, 160)
		if summary == "" {
			summary = "Replied to your comment"
		}
		priority := ""
		if maintainerAssoc[r.AuthorAssociation] {
			priority = "high"
		}
		out = append(out, Entry{
			ID:         "hg-" + slug(r.Repo) + "-" + strconv.Itoa(r.IssueNumber) + "-reply-" + strconv.FormatInt(r.CommentID, 10),
			Kind:       KindCommentReply,
			Repo:       r.Repo,
			Number:     r.IssueNumber,
			URL:        r.URL,
			Actor:      r.Author,
			OccurredAt: r.At.UTC(),
			Summary:    summary,
			Priority:   priority,
		})
	}
	return out
}

var maintainerAssoc = map[string]bool{"OWNER": true, "MEMBER": true, "COLLABORATOR": true}
// Sorted returns entries oldest first, the order the file keeps.
func Sorted(entries []Entry) []Entry {
	sortEntries(entries)
	return entries
}

// Enrich sets staleness fields on every entry: FirstSeenAt is the first time HelloGitty noticed
// the entry (stable across rewrites), and AgeHours is how old it is now.
func Enrich(entries []Entry, seen FirstSeen, now time.Time) {
	for i := range entries {
		fs := seen(entries[i].ID)
		entries[i].FirstSeenAt = &fs
		entries[i].AgeHours = math.Round(now.Sub(fs).Hours()*10) / 10
	}
}

// issueEntry reports the reply that made an issue your move. It goes when you answer, because the
// issue stops being your move.
func issueEntry(it work.Item, login string, seen FirstSeen) (Entry, bool) {
	if it.PR || it.Move != work.MoveYou || it.Last == nil || strings.EqualFold(it.Last.Author, login) {
		return Entry{}, false
	}
	summary := it.Status
	if body := oneLine(it.Last.Body, 140); body != "" {
		summary += ": " + body
	}
	url := it.Last.URL
	if url == "" {
		url = it.URL
	}
	id := "hg-" + slug(it.Repo) + "-" + strconv.Itoa(it.Number) + "-" + eventID(it.Last.URL)
	at := it.Last.At
	if at.IsZero() {
		at = seen(id)
	}
	e := Entry{ID: id, Kind: KindIssue, Repo: it.Repo, Number: it.Number, URL: url, Actor: it.Last.Author,
		OccurredAt: at.UTC(), Summary: summary}
	e.Body = it.Last.Body
	e.AuthorAssociation = it.Last.AuthorAssociation
	return e, true
}

func watchEntry(r store.RepoReport, w store.WatchReport, seen FirstSeen) (Entry, bool) {
	repo := r.Owner + "/" + r.Name
	label := store.WatchLabel(w.Status)
	var summary string
	switch label {
	case "CLAIMED":
		summary = "Claimed"
		if w.ClaimDetail != "" && !strings.HasPrefix(w.ClaimDetail, "https://") {
			summary += " by " + w.ClaimDetail
		}
	case "CLOSED_FIXED":
		summary = "Closed as fixed"
	case "CLOSED_WONT":
		summary = "Closed without a fix"
	default:
		return Entry{}, false
	}
	id := "hg-" + slug(repo) + "-" + strconv.Itoa(w.Number) + "-watch-" + strings.ToLower(label)
	url := "https://github.com/" + repo + "/issues/" + strconv.Itoa(w.Number)
	actor := ""
	if strings.HasPrefix(w.ClaimDetail, "https://") {
		url = w.ClaimDetail
	} else if label == "CLAIMED" {
		actor = w.ClaimDetail
	}
	// The watch list records when HelloGitty noticed the change, which is the best time it has.
	var when time.Time
	if w.StatusChangedAt != nil {
		when = *w.StatusChangedAt
	} else {
		when = seen(id)
	}
	if w.Title != "" {
		summary += ": " + oneLine(w.Title, 100)
	}
	return Entry{ID: id, Kind: KindWatched, Repo: repo, Number: w.Number, URL: url, Actor: actor, OccurredAt: when.UTC(), Summary: summary}, true
}

// eventID derives the id from GitHub's own comment, review or inline-comment id in the URL, so the
// same event always gets the same id. A URL without one falls back to a hash of the URL.
func eventID(url string) string {
	if m := fragment.FindStringSubmatch(url); m != nil {
		switch m[1] {
		case "issuecomment":
			return "comment-" + m[2]
		case "pullrequestreview":
			return "review-" + m[2]
		default:
			return "inline-" + m[2]
		}
	}
	h := fnv.New64a()
	h.Write([]byte(url))
	return "event-" + strconv.FormatUint(h.Sum64(), 36)
}

func slug(repo string) string {
	return strings.ToLower(strings.NewReplacer("/", "-", ".", "-", "_", "-").Replace(repo))
}

func short(oid string) string {
	if len(oid) > 7 {
		return oid[:7]
	}
	if oid == "" {
		return "head"
	}
	return oid
}

func branch(b string) string {
	if b == "" {
		return "its base branch"
	}
	return b
}

func at(names []string) string {
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = "@" + n
	}
	return strings.Join(out, ", ")
}

func plural(n int, s string) string {
	if n == 1 {
		return "1 " + s
	}
	return strconv.Itoa(n) + " " + s + "s"
}

func failed(checks []work.Check) []string {
	var out []string
	for _, c := range checks {
		if c.State == work.CheckFailed {
			out = append(out, c.Name)
		}
	}
	return out
}

func latestTime(checks []work.Check) time.Time {
	var t time.Time
	for _, c := range checks {
		if c.State == work.CheckFailed && c.At != nil && c.At.After(t) {
			t = *c.At
		}
	}
	return t
}

var (
	htmlComment = regexp.MustCompile(`(?s)<!--.*?-->`)
	htmlTag     = regexp.MustCompile(`(?s)<[^>]*>`)
	quotedLine  = regexp.MustCompile(`(?m)^>.*$`)
	codeFence   = regexp.MustCompile("(?s)```.*?```")
	spaces      = regexp.MustCompile(`\s+`)
)

// oneLine turns a comment into one readable line: no HTML, quoted replies or code blocks.
func oneLine(body string, max int) string {
	s := htmlComment.ReplaceAllString(body, " ")
	s = codeFence.ReplaceAllString(s, " [code] ")
	s = quotedLine.ReplaceAllString(s, " ")
	s = htmlTag.ReplaceAllString(s, " ")
	s = strings.TrimSpace(spaces.ReplaceAllString(strings.NewReplacer("**", "", "`", "").Replace(s), " "))
	if r := []rune(s); len(r) > max {
		s = strings.TrimRight(string(r[:max]), " ,.;:") + "…"
	}
	return s
}

// Write replaces path with f atomically: it writes a temporary file in the same directory and
// renames it over the old one, so a reader sees either the previous file or the new one, never half.
func Write(path string, f File) error {
	f.SchemaVersion = SchemaVersion
	if f.Entries == nil {
		f.Entries = []Entry{}
	}
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("inbox: %w", err)
	}
	name := tmp.Name()
	defer os.Remove(name) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("inbox: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("inbox: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("inbox: %w", err)
	}
	if err := os.Chmod(name, 0o644); err != nil {
		return fmt.Errorf("inbox: %w", err)
	}
	if err := os.Rename(name, path); err != nil {
		return fmt.Errorf("inbox: %w", err)
	}
	return nil
}
