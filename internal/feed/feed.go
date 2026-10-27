// Package feed builds the live activity feed: one newest-first stream of what just happened across
// your work and the repositories you track. It collects nothing itself; it merges what HelloGitty
// already has: the inbox events about your pull requests and watched issues, new issues in tracked
// repositories, repositories going quiet, and your GitHub notifications.
package feed

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/inbox"
	"github.com/FawwazLawal/hellogitty/internal/notify"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

// Window is how far back the feed goes, IssueWindow how long a new issue in a tracked repository
// stays in it (busy projects open dozens a day, and they must not push your own work out), and Max
// how many rows it keeps.
const (
	Window      = 7 * 24 * time.Hour
	IssueWindow = 48 * time.Hour
	Max         = 150
)

// Row is one line of the feed.
type Row struct {
	ID     string    `json:"id"`
	Kind   string    `json:"kind"`  // "pr", "issue", "watch", "overlap", "new-issue", "health", "github"
	Label  string    `json:"label"` // the short tag shown before the text
	Repo   string    `json:"repo"`
	Number int       `json:"number,omitempty"`
	Text   string    `json:"text"`
	URL    string    `json:"url"`
	Actor  string    `json:"actor,omitempty"`
	At     time.Time `json:"at"`
	// Key is the dashboard row this is about ("owner/name#123"), for clicking through.
	Key string `json:"key,omitempty"`
	// Thread is the GitHub notification behind the row, if there is one. Acknowledging the row marks
	// it read on GitHub, and reading it on GitHub acknowledges the row. Without one, acknowledging
	// is kept here only.
	Thread string `json:"thread,omitempty"`
	Acked  bool   `json:"acked"`
	// Watched says the issue is on your watch list, for the eye. Set by whoever has the list.
	Watched bool `json:"watched,omitempty"`
}

// HealthChange is a tracked repository reaching a quieter state, and when HelloGitty first saw it.
type HealthChange struct {
	Repo, State string
	At          time.Time
}

// Input is everything the feed is built from.
type Input struct {
	Entries []inbox.Entry // the inbox's current events, overlap reports included
	Issues  []store.RecentIssue
	Health  []HealthChange
	Notes   []notify.Item
	Acked   map[string]time.Time
	Now     time.Time
}

var entryKinds = map[string][2]string{
	inbox.KindComment: {"pr", "Your PR"}, inbox.KindReview: {"pr", "Your PR"}, inbox.KindState: {"pr", "Your PR"},
	inbox.KindLabel: {"pr", "Your PR"}, inbox.KindBot: {"pr", "Your PR"}, inbox.KindIssue: {"issue", "Your issue"},
	inbox.KindWatched: {"watch", "Watched"}, inbox.KindOverlap: {"overlap", "Someone else"}, inbox.KindSimilar: {"overlap", "Worth a look"},
	inbox.KindCrossRef: {"pr", "Cross-ref"},
}

// Build merges the sources into the feed, newest first. Each GitHub notification attaches to the
// row about the same pull request or issue; only notifications about something else get a row of
// their own.
func Build(in Input) []Row {
	since := in.Now.Add(-Window)
	threads := map[string]notify.Item{} // newest thread per pull request or issue
	for _, n := range in.Notes {
		if k := n.Key(); k != "" {
			if t, ok := threads[k]; !ok || n.UpdatedAt.After(t.UpdatedAt) {
				threads[k] = n
			}
		}
	}
	var rows []Row
	used := map[string]bool{}
	add := func(r Row) {
		if r.At.Before(since) {
			return
		}
		if r.Key != "" {
			if t, ok := threads[r.Key]; ok {
				r.Thread = t.ID
				used[t.ID] = true
				if !t.Unread {
					r.Acked = true // read on GitHub
				}
			}
		}
		if _, ok := in.Acked[r.ID]; ok {
			r.Acked = true
		}
		rows = append(rows, r)
	}

	for _, e := range in.Entries {
		k, ok := entryKinds[e.Kind]
		if !ok {
			continue // new_issue entries are covered below, with every new issue
		}
		add(Row{ID: "e:" + e.ID, Kind: k[0], Label: k[1], Repo: e.Repo, Number: e.Number, Text: e.Summary, URL: e.URL,
			Actor: e.Actor, At: e.OccurredAt, Key: key(e.Repo, e.Number)})
	}
	for _, i := range in.Issues {
		if in.Now.Sub(i.CreatedAt) > IssueWindow {
			continue
		}
		add(Row{ID: "i:" + key(i.Repo, i.Number), Kind: "new-issue", Label: "New issue", Repo: i.Repo, Number: i.Number,
			Text: i.Title, URL: "https://github.com/" + i.Repo + "/issues/" + strconv.Itoa(i.Number), At: i.CreatedAt,
			Key: key(i.Repo, i.Number)})
	}
	for _, h := range in.Health {
		text := map[string]string{"SLOW": "Slowing: no commit for 31 to 90 days", "DORMANT": "Dormant: no commit for over 90 days"}[h.State]
		add(Row{ID: "h:" + strings.ToLower(h.Repo) + "-" + strings.ToLower(h.State), Kind: "health", Label: "Health", Repo: h.Repo,
			Text: text, URL: "https://github.com/" + h.Repo, At: h.At})
	}
	for _, n := range in.Notes {
		if used[n.ID] || n.UpdatedAt.Before(since) {
			continue
		}
		if k := n.Key(); k != "" {
			if t := threads[k]; t.ID != n.ID {
				continue // an older thread about the same thing
			}
		}
		r := Row{ID: "n:" + n.ID, Kind: "github", Label: "GitHub", Repo: n.Repo, Number: n.Number, Text: n.Words() + ": " + n.Title,
			URL: n.URL, At: n.UpdatedAt, Key: n.Key(), Thread: n.ID, Acked: !n.Unread}
		if _, ok := in.Acked[r.ID]; ok {
			r.Acked = true
		}
		if r.At.Before(since) {
			continue
		}
		rows = append(rows, r)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if !rows[i].At.Equal(rows[j].At) {
			return rows[i].At.After(rows[j].At)
		}
		return rows[i].ID < rows[j].ID
	})
	if len(rows) > Max {
		rows = rows[:Max]
	}
	return rows
}

func key(repo string, n int) string {
	if n == 0 {
		return ""
	}
	return strings.ToLower(repo) + "#" + strconv.Itoa(n)
}
