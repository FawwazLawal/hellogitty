package help

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/work"
)

// Peek is the card shown when you hover or focus a row: what the row has no room for. Only facts
// HelloGitty already holds; a line it doesn't know is left out, never guessed.
type Peek struct {
	Head  string     `json:"head"`
	Lines []PeekLine `json:"lines"`
}

// PeekLine is one labelled line of a peek.
type PeekLine struct {
	Label string   `json:"label"`
	Items []string `json:"items"`
	Level string   `json:"level,omitempty"` // "caution", "warn", "ok" or ""
}

// Add appends a line, leaving it out when it has nothing to say.
func (p *Peek) Add(label, level string, items ...string) {
	var kept []string
	for _, it := range items {
		if strings.TrimSpace(it) != "" {
			kept = append(kept, it)
		}
	}
	if len(kept) > 0 {
		p.Lines = append(p.Lines, PeekLine{Label: label, Items: kept, Level: level})
	}
}

// WorkPeek is the peek for a pull request or issue on the work board.
func WorkPeek(it work.Item, login string, now time.Time) Peek {
	p := Peek{Head: kindState(it)}
	p.Add("Opened", "", when(it.CreatedAt, now)+byWhom(it, login))
	if !it.UpdatedAt.IsZero() {
		p.Add("Updated", "", Ago(now, it.UpdatedAt))
	}

	var failed, running []string
	passed := 0
	for _, c := range it.CheckList {
		switch c.State {
		case work.CheckFailed:
			failed = append(failed, c.Name)
		case work.CheckPending:
			running = append(running, c.Name)
		default:
			passed++
		}
	}
	var checks []string
	level := ""
	if len(failed) > 0 {
		checks, level = append(checks, "Failed: "+list(failed, 4)), "caution"
	}
	if len(running) > 0 {
		checks = append(checks, "Running: "+list(running, 3))
	}
	if passed > 0 {
		checks = append(checks, strconv.Itoa(passed)+" passed")
	}
	if len(it.CheckList) == 0 && it.Checks != "" {
		checks = append(checks, strings.ToLower(it.Checks[:1])+strings.ToLower(it.Checks[1:]))
	}
	p.Add("Checks", level, strings.Join(checks, " · "))

	var reviews []string
	if len(it.ApprovedBy) > 0 {
		reviews = append(reviews, "Approved by "+ats(it.ApprovedBy))
	}
	if len(it.ChangesBy) > 0 {
		reviews = append(reviews, "Changes requested by "+ats(it.ChangesBy))
	}
	if len(it.Requested) > 0 {
		reviews = append(reviews, "Asked: "+ats(it.Requested))
	}
	p.Add("Reviews", "", reviews...)
	if len(it.Assignees) > 0 {
		p.Add("Assigned", "", ats(it.Assignees))
	}
	if it.PR && it.Head != "" {
		p.Add("Branch", "", it.Head+" → "+branchOr(it.Base))
	}
	var fixes []string
	for _, f := range it.Fixes {
		if strings.EqualFold(f.Repo, it.Repo) {
			fixes = append(fixes, "#"+strconv.Itoa(f.Number))
		} else {
			fixes = append(fixes, f.Repo+"#"+strconv.Itoa(f.Number))
		}
	}
	p.Add("Fixes", "", strings.Join(fixes, ", "))

	recent := append([]work.Activity(nil), it.Recent...)
	sort.SliceStable(recent, func(i, j int) bool { return recent[i].At.After(recent[j].At) })
	var lines []string
	for _, a := range recent {
		if a.Bot || len(lines) == 3 {
			continue
		}
		if t := Excerpt(a.Body, 90); t != "" {
			lines = append(lines, "@"+a.Author+": "+t)
		}
	}
	p.Add("Recent", "", lines...)
	if it.Comments > 0 {
		p.Add("Comments", "", strconv.Itoa(it.Comments))
	}
	return p
}

func kindState(it work.Item) string {
	kind := "Issue"
	if it.PR {
		kind = "Pull request"
	}
	state := map[string]string{"OPEN": "open", "CLOSED": "closed", "MERGED": "merged"}[it.State]
	if it.Draft {
		state = "draft"
	}
	if state == "" {
		return kind
	}
	return kind + " · " + state
}

func byWhom(it work.Item, login string) string {
	if it.Author == "" || strings.EqualFold(it.Author, login) {
		return ""
	}
	return " by @" + it.Author
}

func when(t, now time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("2006-01-02") + ", " + Ago(now, t)
}

func ats(names []string) string {
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = "@" + n
	}
	return strings.Join(out, ", ")
}

func list(xs []string, n int) string {
	if len(xs) <= n {
		return strings.Join(xs, ", ")
	}
	return strings.Join(xs[:n], ", ") + " +" + strconv.Itoa(len(xs)-n)
}

func branchOr(b string) string {
	if b == "" {
		return "its base"
	}
	return b
}
