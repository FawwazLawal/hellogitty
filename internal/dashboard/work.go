package dashboard

import (
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/help"
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
	Ago       string // "3 days"
	AgoTitle  string // exact UTC time
	SinceUnix int64  // for client-side sorting by time
	Value    string // what the change marker compares between reloads
	Move     string // work.MoveYou, MoveThem or MoveDone, for grouping and filtering in the page
	Search   string // lowercase text the page's search box matches against
	Quote    string
	QuoteBy  string
	QuoteURL string
	K        string // "owner/name#123", matching notifications and the page's read marks
	Attn     string // the dot: "new" (unread activity), "caution" (your move) or ""
	New      int64  // when the newest unread notification on it arrived, unix seconds
	NewWhat  string // what it says: "New comment", "CI failed: lint"
	Peek     peek   // the hover card
	Watched  bool   // on your watch list (the eye)
	Eye      bool   // show the eye: an issue, on a page that can watch
}

type note struct{ Text, Level, Term string }

type workView struct {
	Known      bool
	Err        string
	ErrF       FriendlyErr
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
	// Conversations: issues and pull requests you only joined (commented on or were mentioned in),
	// kept apart from what you opened. ConvYou asks something of you; ConvThem is quiet.
	ConvYou  []workRow
	ConvThem []workRow

	NotifyState string // "ok", "off" or "" (not configured or not fetched yet)
	NotifyNote  string
	Other       []otherRow
	// RepoOther are notifications about your own repositories (a failed workflow run, a release),
	// shown under Your repositories rather than with your work elsewhere.
	RepoOther []otherRow
}

// YourMove counts everything waiting on you, sent and incoming.
func (w workView) YourMove() int { return len(w.You) + len(w.InYou) + len(w.ConvYou) }

func buildWork(b *work.Board, errText string, now time.Time) workView {
	v := workView{Err: errText, ErrF: friendlyError(errText)}
	if b == nil {
		return v
	}
	v.Known, v.Login, v.Scope = true, b.Login, b.Scope
	v.FetchedAgo = ago(now, b.FetchedAt)
	v.Cost, v.Remaining = b.Cost, b.Remaining
	for _, it := range b.Sent {
		r := toRow(it, b.Login, now)
		if it.Role == work.RoleInvolved {
			// A thread you joined isn't yours to finish; once it closes it leaves the page.
			switch it.Move {
			case work.MoveYou:
				v.ConvYou = append(v.ConvYou, r)
			case work.MoveThem:
				v.ConvThem = append(v.ConvThem, r)
			}
			continue
		}
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
		Ago: ago(now, it.Since), AgoTitle: it.Since.UTC().Format("2006-01-02 15:04Z"), SinceUnix: it.Since.Unix(),
		Value: it.Move + "|" + it.Status + "|" + it.Personal,
	}
	if it.PR {
		r.Kind = "PR"
	}
	r.Move = it.Move
	r.K = rowKey(it.Repo, it.Number)
	r.Peek = workPeek(it, login, now, nil)
	if it.Move == work.MoveYou {
		r.Attn = "caution"
	}
	for _, n := range it.Notes {
		r.Notes = append(r.Notes, note{Text: n, Level: noteLevel(n), Term: noteTerm(n)})
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

// excerpt, ago and plural live in internal/help, shared with the extension.
func excerpt(body string) string           { return help.Excerpt(body, quoteChars) }
func excerptN(body string, max int) string { return help.Excerpt(body, max) }
func ago(now, t time.Time) string          { return help.Ago(now, t) }
func plural(n int, unit string) string     { return help.Plural(n, unit) }
