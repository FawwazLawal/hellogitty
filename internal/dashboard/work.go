package dashboard

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/work"
)

const (
	finishedShown = 10
	quoteChars    = 220
)

type workRow struct {
	Key      string
	Kind     string // "PR" or "Issue"
	Repo     string
	Number   int
	Title    string
	URL      string
	Why      string // why it is on the board: "You opened it", "Assigned to you"
	Status   string
	Notes    []note
	Level    string // "caution", "ok" or ""
	Personal string // a step only you can take, e.g. "Sign the CLA"
	Labels   []string
	Ago      string // "3 days"
	AgoTitle string // exact UTC time
	Value    string // what the change marker compares between reloads
	Move     string // work.MoveYou, MoveThem or MoveDone, for grouping and filtering in the page
	Search   string // lowercase text the page's search box matches against
	Quote    string
	QuoteBy  string
	QuoteURL string
}

type note struct{ Text, Level string }

type workView struct {
	Known      bool
	Err        string
	Login      string
	Scope      string
	FetchedAgo string
	Cost       int
	Remaining  int
	You        []workRow
	Them       []workRow
	Done       []workRow
	DoneMore   int
	InYou      []workRow
	InThem     []workRow
}

// YourMove counts everything waiting on you, sent and incoming.
func (w workView) YourMove() int { return len(w.You) + len(w.InYou) }

func buildWork(b *work.Board, errText string, now time.Time) workView {
	v := workView{Err: errText}
	if b == nil {
		return v
	}
	v.Known, v.Login, v.Scope = true, b.Login, b.Scope
	v.FetchedAgo = ago(now, b.FetchedAt)
	v.Cost, v.Remaining = b.Cost, b.Remaining
	for _, it := range b.Sent {
		r := toRow(it, b.Login, now)
		switch it.Move {
		case work.MoveYou:
			v.You = append(v.You, r)
		case work.MoveThem:
			v.Them = append(v.Them, r)
		default:
			v.Done = append(v.Done, r)
		}
	}
	if len(v.Done) > finishedShown {
		v.DoneMore = len(v.Done) - finishedShown
		v.Done = v.Done[:finishedShown]
	}
	for _, it := range b.Incoming {
		r := toRow(it, b.Login, now)
		switch it.Move {
		case work.MoveYou:
			v.InYou = append(v.InYou, r)
		case work.MoveThem:
			v.InThem = append(v.InThem, r)
		}
	}
	return v
}

func toRow(it work.Item, login string, now time.Time) workRow {
	r := workRow{
		Key:  strings.ToLower(it.Repo) + "-" + strconv.Itoa(it.Number),
		Kind: "Issue", Repo: it.Repo, Number: it.Number, Title: it.Title, URL: it.URL,
		Why: why(it), Status: it.Status, Level: it.Level, Personal: it.Personal, Labels: it.Labels,
		Ago: ago(now, it.Since), AgoTitle: it.Since.UTC().Format("2006-01-02 15:04Z"),
		Value: it.Move + "|" + it.Status + "|" + it.Personal,
	}
	if it.PR {
		r.Kind = "PR"
	}
	r.Move = it.Move
	for _, n := range it.Notes {
		r.Notes = append(r.Notes, note{Text: n, Level: noteLevel(n)})
	}
	// Quote the comment most worth reading before acting: the one the status points at (an
	// unresolved review comment, say), else the latest word from someone else.
	l := it.Quote
	if l == nil {
		l = it.Last
	}
	if l != nil && !strings.EqualFold(l.Author, login) {
		if q := excerpt(l.Body); q != "" {
			r.Quote, r.QuoteBy, r.QuoteURL = q, "@"+l.Author, l.URL
		}
	}
	words := []string{r.Title, r.Repo, "#" + strconv.Itoa(r.Number), r.Kind, r.Status, r.Why, r.Personal, r.QuoteBy, r.Quote, "@" + it.Author}
	words = append(words, r.Labels...)
	for _, n := range r.Notes {
		words = append(words, n.Text)
	}
	r.Search = strings.ToLower(strings.Join(words, " "))
	return r
}

func why(it work.Item) string {
	switch it.Role {
	case work.RoleAuthor:
		return "You opened it"
	case work.RoleAssigned:
		return "Assigned to you"
	case work.RoleInvolved:
		return "You joined the thread"
	case work.RoleReviewer:
		return "From @" + it.Author + ", you're a reviewer"
	case work.RoleMaintains:
		return "From @" + it.Author
	}
	return ""
}

func noteLevel(n string) string {
	switch {
	case n == "Checks failing", n == "Merge conflict", strings.HasPrefix(n, "Failing: "),
		strings.HasPrefix(n, "Behind "), strings.Contains(n, "unresolved thread"):
		return "caution"
	case n == "Checks passed":
		return "ok"
	}
	return ""
}

var (
	htmlComment = regexp.MustCompile(`(?s)<!--.*?-->`)
	htmlTag     = regexp.MustCompile(`(?s)<[^>]*>`)
	mdImage     = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	mdLink      = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	quoted      = regexp.MustCompile(`(?m)^>.*$`)
	codeFence   = regexp.MustCompile("(?s)```.*?```")
	spaces      = regexp.MustCompile(`\s+`)
)

// excerpt turns a GitHub comment into one readable line: no HTML, quoted replies, code blocks or
// image markup, cut at a word boundary.
func excerpt(body string) string {
	s := htmlComment.ReplaceAllString(body, " ")
	s = codeFence.ReplaceAllString(s, " [code] ")
	s = quoted.ReplaceAllString(s, " ")
	s = mdImage.ReplaceAllString(s, " ")
	s = mdLink.ReplaceAllString(s, "$1")
	s = htmlTag.ReplaceAllString(s, " ")
	s = strings.NewReplacer("**", "", "__", "", "`", "", "&nbsp;", " ", "&amp;", "&").Replace(s)
	s = strings.TrimSpace(spaces.ReplaceAllString(s, " "))
	if len([]rune(s)) <= quoteChars {
		return s
	}
	cut := string([]rune(s)[:quoteChars])
	if i := strings.LastIndexByte(cut, ' '); i > quoteChars/2 {
		cut = cut[:i]
	}
	return strings.TrimRight(cut, " ,.;:") + "…"
}

// ago says how long ago t was in words a person reads at a glance: "3 days ago".
func ago(now, t time.Time) string {
	if t.IsZero() {
		return "—"
	}
	d := now.Sub(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return plural(int(d/time.Minute), "min") + " ago"
	case d < 24*time.Hour:
		return plural(int(d/time.Hour), "hour") + " ago"
	case d < 14*24*time.Hour:
		return plural(int(d/(24*time.Hour)), "day") + " ago"
	case d < 60*24*time.Hour:
		return plural(int(d/(7*24*time.Hour)), "week") + " ago"
	case d < 365*24*time.Hour:
		return plural(int(d/(30*24*time.Hour)), "month") + " ago"
	}
	return plural(int(d/(365*24*time.Hour)), "year") + " ago"
}

func plural(n int, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	if unit == "min" {
		return fmt.Sprintf("%d min", n)
	}
	return fmt.Sprintf("%d %ss", n, unit)
}
