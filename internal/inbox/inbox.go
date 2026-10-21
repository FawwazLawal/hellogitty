// Package inbox writes a small JSON file of recent events on your own open pull requests, on
// watched issues, and on issues where someone else may be doing the work you planned, so a script can pick them up without calling GitHub. The file is rewritten in full
// after every refresh with everything currently pertinent; a reader tells new entries from seen ones
// by their ids, which stay the same for the same real-world event across rewrites.
package inbox

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
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
	KindComment = "pr_comment"
	KindReview  = "pr_review"
	KindState   = "pr_state"
	KindWatched = "watched_issue"
	KindOverlap = "issue_overlap" // someone else is on an issue you plan to take: a PR, an assignee, a claim, a close
	KindSimilar = "issue_similar" // another PR's title shares the subject; only worth a look
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
}

type File struct {
	GeneratedAt         time.Time `json:"generated_at"`
	PollIntervalMinutes int       `json:"poll_interval_minutes"`
	Entries             []Entry   `json:"entries"`
}

// FirstSeen returns a stable time for an event GitHub does not timestamp (the first time it was
// seen); see store.FirstSeen.
type FirstSeen func(id string) time.Time

var fragment = regexp.MustCompile(`#(issuecomment|pullrequestreview|discussion_r)-?(\d+)$`)

// Build lists what is pertinent now: comments, reviews and state changes on pull requests you
// opened, and watched issues someone claimed or closed. Nothing else: no new issues, repo health or
// other people's pull requests.
func Build(b *work.Board, reports []store.RepoReport, seen FirstSeen) []Entry {
	var out []Entry
	if b != nil {
		for _, it := range b.Sent {
			if it.PR && it.Role == work.RoleAuthor {
				out = append(out, prEntries(it, seen)...)
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

func prEntries(it work.Item, seen FirstSeen) []Entry {
	base := "hg-" + slug(it.Repo) + "-" + strconv.Itoa(it.Number) + "-"
	entry := func(id, kind, url, actor string, at time.Time, summary string) Entry {
		if url == "" {
			url = it.URL
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
		summary := "Closed without merging"
		if it.Last != nil && it.Last.Body != "" {
			summary += ": @" + it.Last.Author + ": " + oneLine(it.Last.Body, 120)
		}
		return append(out, entry("closed", KindState, "", "", at, summary))
	}

	for _, a := range it.Recent {
		kind, summary := KindComment, oneLine(a.Body, 160)
		if a.Review != "" {
			kind = KindReview
			summary = a.Review
			if threads := len(it.Threads); threads > 0 && a.Review == "CHANGES_REQUESTED" {
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
		out = append(out, entry(eventID(a.URL), kind, a.URL, a.Author, a.At, summary))
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
