package dashboard

import (
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/feed"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

// A tracked repository's tabs: what's new in it, its newest issues, its pull requests, and the
// lessons from what it turned down.

type repoIssue struct {
	Number        int
	Title, URL    string
	Ago, AgoTitle string
	New           bool   // in the live feed and not acknowledged yet
	AckID         string // the feed row to acknowledge when you look at it here; "" when a GitHub notification is behind it
	Labels        []string
	Taken         string // "assigned" or "claimed", when someone has it
}

type repoPR struct {
	Number        int
	Title, URL    string
	Author        string
	Ago, AgoTitle string
	State         string // "open", "draft", "merged" or "closed"
	Outside       bool   // from an outside contributor (closed ones only; open ones don't say)
}

// repoNews is what the live feed holds about one repository.
type repoNews struct {
	open     int              // rows not acknowledged
	openIDs  []string         // and their ids
	issues   map[int]feed.Row // new-issue rows by number
	activity []feed.Row       // everything else, newest first
}

// newsByRepo indexes the feed by repository (lower case).
func newsByRepo(rows []feed.Row) map[string]*repoNews {
	out := map[string]*repoNews{}
	for _, r := range rows {
		k := strings.ToLower(r.Repo)
		if k == "" {
			continue
		}
		n := out[k]
		if n == nil {
			n = &repoNews{issues: map[int]feed.Row{}}
			out[k] = n
		}
		if !r.Acked {
			n.open++
			n.openIDs = append(n.openIDs, r.ID)
		}
		if r.Kind == "new-issue" {
			n.issues[r.Number] = r
		} else {
			n.activity = append(n.activity, r)
		}
	}
	return out
}

// activityShown and closedShown cap the Activity and closed pull request lists.
const (
	activityShown = 8
	closedShown   = 6
)

// fillRepoDetail adds a repository's tabs and its "new" count to its row.
func fillRepoDetail(rw *row, r store.RepoReport, news *repoNews, open []OpenPR, now time.Time) {
	full := r.Owner + "/" + r.Name
	if news != nil {
		rw.NewCount, rw.NewIDs = news.open, strings.Join(news.openIDs, " ")
		for _, a := range news.activity {
			if len(rw.Activity) == activityShown {
				break
			}
			rw.Activity = append(rw.Activity, feedRow{Row: a, Ago: ago(now, a.At), AgoTitle: a.At.UTC().Format("2006-01-02 15:04Z")})
		}
	}
	for _, i := range r.NewestIssues {
		ri := repoIssue{Number: i.Number, Title: i.Title, URL: "https://github.com/" + full + "/issues/" + strconv.Itoa(i.Number),
			Ago: ago(now, i.CreatedAt), AgoTitle: i.CreatedAt.UTC().Format("2006-01-02 15:04Z"), Labels: i.Labels}
		switch {
		case len(i.Assignees) > 0:
			ri.Taken = "assigned"
		case i.ClaimSignal != "":
			ri.Taken = "claimed"
		}
		if news != nil {
			if f, ok := news.issues[i.Number]; ok && !f.Acked {
				ri.New = true
				rw.NewIssues++
				if f.Thread == "" {
					ri.AckID = f.ID
				}
			}
		}
		rw.Issues = append(rw.Issues, ri)
	}
	for _, p := range open {
		state := "open"
		if p.Draft {
			state = "draft"
		}
		if p.Bot {
			continue // dependency bumps and the like say nothing about who is working here
		}
		rw.OpenPRs = append(rw.OpenPRs, repoPR{Number: p.Number, Title: p.Title, URL: p.URL, Author: p.Author,
			Ago: ago(now, p.CreatedAt), AgoTitle: p.CreatedAt.UTC().Format("2006-01-02 15:04Z"), State: state})
	}
	for _, c := range r.LatestClosed {
		if len(rw.ClosedPRs) == closedShown {
			break
		}
		state := "closed"
		if c.Merged {
			state = "merged"
		}
		outside := c.AuthorAssociation == "NONE" || c.AuthorAssociation == "FIRST_TIME_CONTRIBUTOR" || c.AuthorAssociation == "FIRST_TIMER" || c.AuthorAssociation == "CONTRIBUTOR"
		rw.ClosedPRs = append(rw.ClosedPRs, repoPR{Number: c.Number, Title: c.Title, URL: "https://github.com/" + full + "/pull/" + strconv.Itoa(c.Number),
			Ago: ago(now, c.At), AgoTitle: c.At.UTC().Format("2006-01-02 15:04Z"), State: state, Outside: outside})
	}
	// Open on what is new, else on the lessons.
	switch {
	case rw.NewIssues > 0:
		rw.Tab = "issues"
	case rw.NewCount > 0 && len(rw.Activity) > 0:
		rw.Tab = "activity"
	case len(rw.Denied) > 0:
		rw.Tab = "lessons"
	default:
		rw.Tab = "issues"
	}
}
