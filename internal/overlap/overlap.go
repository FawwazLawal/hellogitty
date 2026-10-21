// Package overlap watches issues you plan to work on, and issues your open pull requests fix, for
// signs that someone else got there first: another pull request citing the issue, an assignee, a
// claim in a comment, the issue closing, or another pull request whose title covers the same
// subject.
//
// It is built to stay quiet. Each issue gets at most one report of something that happened (the
// first one seen) and at most one "worth a look" report for a pull request with a similar title,
// and the same pull request is never reported twice against the same issue. Reports are recorded,
// so a restart does not repeat them.
package overlap

import (
	"hash/fnv"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Target is an issue to watch.
type Target struct {
	Repo   string
	Number int
	Title  string
	OurPRs []int // your open pull requests that fix it
}

// Key identifies an issue without regard to case.
func Key(repo string, number int) string {
	return strings.ToLower(repo) + "#" + strconv.Itoa(number)
}

// Signal is one sign of someone else's work on an issue.
type Signal struct {
	ID      string // "pr-8521", "assigned-octocat", "claim-123", "closed", "similar-pr-8521"
	Hard    bool   // false for shared title words, which only says what to look at
	Actor   string
	URL     string
	At      time.Time
	Summary string
}

// PR is another pull request found near an issue.
type PR struct {
	Repo      string
	Number    int
	Title     string
	URL       string
	State     string // OPEN, CLOSED, MERGED
	Author    string
	Bot       bool
	CreatedAt time.Time
	MergedAt  *time.Time
	Cites     bool // links or mentions the issue, as opposed to only sharing title words
}

// Comment is a comment on the issue.
type Comment struct {
	Author string
	Bot    bool
	Body   string
	URL    string
	At     time.Time
}

// Facts is what GitHub says about one issue and the pull requests around it.
type Facts struct {
	Repo        string
	Number      int
	Title       string
	State       string // OPEN or CLOSED
	StateReason string // COMPLETED, NOT_PLANNED, DUPLICATE
	ClosedAt    *time.Time
	ClosedBy    string // who closed it
	Closer      *PR    // the pull request that closed it, if one did
	Assignees   []string
	AssignedAt  map[string]time.Time // latest assignment per login, lower case
	Comments    []Comment
	PRs         []PR
}

// Recent is how far back a closed or merged pull request still counts. An open pull request
// counts at any age: somebody is still building it.
const Recent = 90 * 24 * time.Hour

// ClaimWindow is how far back a claim in a comment counts.
const ClaimWindow = 30 * 24 * time.Hour

// claim matches "I'll take this" and its usual variants.
var claim = regexp.MustCompile(`(?i)i.?ll take|i will take|taking this|working on (this|it)|i.?m on (this|it)|picking this up|assign (this )?to me|can i (take|work)|let me (take|try)`)

// Signals lists every current sign of someone else's work on the issue. login is you: your own
// pull requests, comments and assignment are never a conflict.
func Signals(f Facts, t Target, login string, now time.Time) []Signal {
	me := func(who string) bool { return strings.EqualFold(who, login) }
	var out []Signal

	if f.State == "CLOSED" && !(f.Closer != nil && me(f.Closer.Author)) {
		at := now
		if f.ClosedAt != nil {
			at = *f.ClosedAt
		}
		s := Signal{ID: "closed", Hard: true, Actor: f.ClosedBy, URL: issueURL(f), At: at}
		switch {
		case f.Closer != nil:
			s.URL, s.Actor = f.Closer.URL, f.Closer.Author
			s.Summary = "Closed by " + ref(f, *f.Closer) + " from @" + f.Closer.Author + ": " + clip(f.Closer.Title, 100)
		case f.StateReason == "NOT_PLANNED":
			s.Summary = "Closed as not planned"
		case f.StateReason == "DUPLICATE":
			s.Summary = "Closed as a duplicate"
		default:
			s.Summary = "Closed as completed"
		}
		if f.ClosedBy != "" && f.Closer == nil {
			s.Summary += " by @" + f.ClosedBy
		}
		out = append(out, s)
	}

	for _, a := range f.Assignees {
		if me(a) {
			continue
		}
		at, ok := f.AssignedAt[strings.ToLower(a)]
		if !ok {
			at = now
		}
		out = append(out, Signal{ID: "assigned-" + strings.ToLower(a), Hard: true, Actor: a, URL: issueURL(f), At: at,
			Summary: "Assigned to @" + a})
	}

	for _, c := range f.Comments {
		if me(c.Author) || c.Bot || now.Sub(c.At) > ClaimWindow || !claim.MatchString(c.Body) {
			continue
		}
		out = append(out, Signal{ID: "claim-" + commentID(c.URL), Hard: true, Actor: c.Author, URL: c.URL, At: c.At,
			Summary: "@" + c.Author + " claimed it in a comment: \"" + clip(c.Body, 120) + "\""})
	}

	words := Keywords(f.Title)
	for _, p := range f.PRs {
		if me(p.Author) || p.Bot || !counts(p, now) || !sameOwner(f.Repo, p.Repo) {
			continue
		}
		if p.Cites && p.State == "CLOSED" {
			// An attempt that was closed is a lesson, not a race.
			out = append(out, Signal{ID: "similar-pr-" + strconv.Itoa(p.Number), Actor: p.Author, URL: p.URL, At: p.CreatedAt,
				Summary: "Worth a look: " + ref(f, p) + " by @" + p.Author + " cited this issue and was closed without merging (opened " +
					p.CreatedAt.Format("2006-01-02") + "): " + clip(p.Title, 100)})
			continue
		}
		if p.Cites {
			out = append(out, Signal{ID: "pr-" + strconv.Itoa(p.Number), Hard: true, Actor: p.Author, URL: p.URL,
				At: p.CreatedAt, Summary: citeSummary(f, p)})
			continue
		}
		if p.State != "OPEN" || now.Sub(p.CreatedAt) > Recent {
			continue // a subject match only matters while someone is building it
		}
		if shared := Shared(words, titleWords(p.Title, 0)); len(shared) >= SubjectWords(len(words)) {
			out = append(out, Signal{ID: "similar-pr-" + strconv.Itoa(p.Number), Actor: p.Author, URL: p.URL, At: p.CreatedAt,
				Summary: "Worth a look: " + ref(f, p) + " by @" + p.Author + " (" + state(p) + ") shares the title words " +
					strings.Join(shared, ", ") + ": " + clip(p.Title, 100)})
		}
	}
	if len(t.OurPRs) > 0 {
		suffix := " (your " + prList(t.OurPRs) + " is open on this issue)"
		for i := range out {
			out[i].Summary += suffix
		}
	}
	return out
}

// Prior is what has already been reported for an issue.
type Prior struct {
	Hard []string // signal ids
	Soft []string
}

// Choose decides what, if anything, to report now. An issue gets one report of something that
// happened, the earliest seen, and before that at most one "worth a look"; nothing is reported
// about a pull request that was already reported against the same issue.
func Choose(current []Signal, prior Prior) *Signal {
	if len(prior.Hard) > 0 {
		return nil
	}
	reported := map[string]bool{}
	for _, id := range prior.Soft {
		reported[strings.TrimPrefix(id, "similar-")] = true
	}
	var hard, soft []Signal
	for _, s := range current {
		switch {
		case s.Hard && !reported[s.ID]:
			hard = append(hard, s)
		case !s.Hard:
			soft = append(soft, s)
		}
	}
	first := func(xs []Signal) *Signal {
		sort.SliceStable(xs, func(i, j int) bool {
			if !xs[i].At.Equal(xs[j].At) {
				return xs[i].At.Before(xs[j].At)
			}
			return xs[i].ID < xs[j].ID
		})
		return &xs[0]
	}
	if len(hard) > 0 {
		return first(hard)
	}
	if len(soft) > 0 && len(prior.Soft) == 0 {
		return first(soft)
	}
	return nil
}

func counts(p PR, now time.Time) bool {
	if p.State == "OPEN" {
		return true
	}
	if p.MergedAt != nil && now.Sub(*p.MergedAt) <= Recent {
		return true
	}
	return now.Sub(p.CreatedAt) <= Recent
}

// SubjectWords is how many title words another pull request must share with an issue of n
// keywords to count as the same subject: two, or half the issue's words when it has more than four.
// Two shared words out of six turned out to be noise on real boards ("correct, size").
func SubjectWords(n int) int {
	return max(2, (n+1)/2)
}

// sameOwner keeps pull requests in the issue's own organisation (golang/website for golang/go, say)
// and drops mentions from unrelated repositories, such as someone's portfolio linking the issue.
func sameOwner(issueRepo, prRepo string) bool {
	if prRepo == "" {
		return true
	}
	a, _, _ := strings.Cut(issueRepo, "/")
	b, _, _ := strings.Cut(prRepo, "/")
	return strings.EqualFold(a, b)
}

func citeSummary(f Facts, p PR) string {
	if p.State == "MERGED" {
		return "A pull request citing this issue was merged: " + ref(f, p) + " by @" + p.Author + ", merged " + day(p.MergedAt) + ": " + clip(p.Title, 100)
	}
	return "Another pull request cites this issue: " + ref(f, p) + " by @" + p.Author + ", opened " + p.CreatedAt.Format("2006-01-02") +
		": " + clip(p.Title, 100)
}

func state(p PR) string {
	return "open since " + p.CreatedAt.Format("2006-01-02")
}

func day(t *time.Time) string {
	if t == nil {
		return "recently"
	}
	return t.Format("2006-01-02")
}

// ref names a pull request as #N in the issue's own repository, owner/name#N elsewhere.
func ref(f Facts, p PR) string {
	if p.Repo == "" || strings.EqualFold(p.Repo, f.Repo) {
		return "#" + strconv.Itoa(p.Number)
	}
	return p.Repo + "#" + strconv.Itoa(p.Number)
}

func prList(ns []int) string {
	parts := make([]string, len(ns))
	for i, n := range ns {
		parts[i] = "#" + strconv.Itoa(n)
	}
	if len(parts) == 1 {
		return "PR " + parts[0]
	}
	return "PRs " + strings.Join(parts, ", ")
}

func issueURL(f Facts) string {
	return "https://github.com/" + f.Repo + "/issues/" + strconv.Itoa(f.Number)
}

var commentFragment = regexp.MustCompile(`#issuecomment-(\d+)$`)

func commentID(url string) string {
	if m := commentFragment.FindStringSubmatch(url); m != nil {
		return m[1]
	}
	h := fnv.New64a()
	h.Write([]byte(url))
	return strconv.FormatUint(h.Sum64(), 36)
}

var spaces = regexp.MustCompile(`\s+`)

func clip(s string, max int) string {
	s = strings.TrimSpace(spaces.ReplaceAllString(s, " "))
	if r := []rune(s); len(r) > max {
		s = strings.TrimRight(string(r[:max]), " ,.;:") + "…"
	}
	return s
}

var (
	// "[Feature] ", "[UI] " and similar tags at the start of a title.
	tagPrefix = regexp.MustCompile(`^\s*(\[[^\]]*\]\s*)+`)
	// "fix(ui): ", "cmd/go,testing: ", "crypto/x509: ": a lower-case scope every title in the area
	// shares. "Accept-Encoding: ..." is a subject, not a scope, and stays.
	scopePrefix = regexp.MustCompile(`^\s*[a-z0-9_./,+-]+(\([^)]*\))?!?:\s+`)
	nonWord     = regexp.MustCompile(`[^a-z0-9]+`)
	stop        = map[string]bool{}
)

func init() {
	for _, w := range strings.Split("the a an and or of to in on for with when does not is are be it its that this use using "+
		"should would from by at as add fix support issue bug", " ") {
		stop[w] = true
	}
}

// Keywords returns up to six words that carry a title's subject: lower case, longer than three
// letters, with stop words and the leading tag or scope removed, so "[Feature]" or "cmd/go:" does
// not make every title in a repository look alike.
func Keywords(title string) []string {
	return titleWords(title, 6)
}

// titleWords is Keywords with a limit; 0 means every word.
func titleWords(title string, limit int) []string {
	t := tagPrefix.ReplaceAllString(title, "")
	t = scopePrefix.ReplaceAllString(t, "")
	var out []string
	seen := map[string]bool{}
	for _, w := range nonWord.Split(strings.ToLower(t), -1) {
		if len(w) <= 3 || stop[w] || seen[w] {
			continue
		}
		seen[w] = true
		out = append(out, w)
		if len(out) == limit {
			break
		}
	}
	return out
}

// Shared lists the words of a that are also in b, in a's order.
func Shared(a, b []string) []string {
	in := map[string]bool{}
	for _, w := range b {
		in[w] = true
	}
	var out []string
	for _, w := range a {
		if in[w] {
			out = append(out, w)
		}
	}
	return out
}
