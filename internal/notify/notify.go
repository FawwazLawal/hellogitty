// Package notify keeps the latest copy of the user's GitHub notifications, so the dashboard can mark
// what is new since they last looked. GitHub's own read state is the source of truth: reading a
// thread on GitHub (opening the pull request, say) marks it read, and the dashboard follows on the
// next poll. HelloGitty only reads; it never marks anything read.
package notify

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

// Window is how far back threads are kept.
const Window = 7 * 24 * time.Hour

// Item is one notification thread.
type Item struct {
	ID        string
	Repo      string
	Number    int    // the issue or pull request, 0 for anything else
	Kind      string // Issue, PullRequest, CheckSuite, Release, Discussion, ...
	Title     string
	Reason    string
	Unread    bool
	UpdatedAt time.Time
	URL       string // a page on github.com
	Branch    string // a CI run's branch
	Failed    bool   // a CI run that failed
}

// Key matches an issue or pull request row: "owner/name#123", lower case.
func (i Item) Key() string {
	if i.Number == 0 {
		return ""
	}
	return strings.ToLower(i.Repo) + "#" + strconv.Itoa(i.Number)
}

// Words says what happened, in a few words.
func (i Item) Words() string {
	if i.Kind == "CheckSuite" {
		if i.Failed {
			return "CI failed: " + workflow(i.Title)
		}
		return "CI ran: " + workflow(i.Title)
	}
	switch i.Reason {
	case "comment":
		return "New comment"
	case "mention", "team_mention":
		return "Mentioned you"
	case "review_requested":
		return "Review requested"
	case "assign":
		return "Assigned to you"
	case "state_change":
		return "Opened, closed or merged"
	case "security_alert":
		return "Security alert"
	case "approval_requested":
		return "Approval requested"
	case "ci_activity":
		return "CI activity"
	}
	return "New activity"
}

// Action reports whether the thread still asks something of you once read, for threads that match
// no row on the board (a row's own status decides for the rest). A mention is news until read; after
// that you have seen it.
func (i Item) Action() bool {
	switch i.Reason {
	case "review_requested", "assign", "security_alert", "approval_requested":
		return true
	}
	return i.Kind == "CheckSuite" && i.Failed
}

// View is the latest state of the feed.
type View struct {
	State string // "ok"; "off" when the token cannot read notifications; "" before the first fetch
	Note  string // why it is off
	Items []Item
	At    time.Time
}

// Feed polls GitHub's notifications.
type Feed struct {
	GH  *github.Client
	Now func() time.Time

	mu      sync.Mutex
	view    View
	lastMod string
	since   time.Time
	poll    time.Duration
}

// Interval is how long to wait before the next Refresh: GitHub's X-Poll-Interval, at least a minute.
func (f *Feed) Interval() time.Duration {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.poll < time.Minute {
		return time.Minute
	}
	return f.poll
}

// Snapshot returns the latest view.
func (f *Feed) Snapshot() View {
	f.mu.Lock()
	defer f.mu.Unlock()
	v := f.view
	v.Items = append([]Item(nil), f.view.Items...)
	return v
}

// Refresh fetches what changed. An unchanged inbox costs nothing.
func (f *Feed) Refresh(ctx context.Context) error {
	now := time.Now()
	if f.Now != nil {
		now = f.Now()
	}
	// A since that moves once a day keeps the request the same, so If-Modified-Since can answer 304.
	since := now.Add(-Window).UTC().Truncate(24 * time.Hour)
	f.mu.Lock()
	lastMod := f.lastMod
	if !since.Equal(f.since) {
		lastMod = ""
	}
	f.mu.Unlock()

	page, err := f.GH.Notifications(ctx, since, lastMod)
	f.mu.Lock()
	defer f.mu.Unlock()
	var se *github.StatusError
	if errors.As(err, &se) && (se.Code == 401 || se.Code == 403 || se.Code == 404) {
		f.view = View{State: "off", At: now,
			Note: "this GitHub token can't read notifications. Fine-grained tokens never can; a classic token with the notifications or repo scope can"}
		return nil
	}
	if err != nil {
		return err
	}
	f.poll = time.Duration(page.PollSeconds) * time.Second
	f.lastMod, f.since = page.LastModified, since
	f.view.State, f.view.Note, f.view.At = "ok", "", now
	if !page.NotModified {
		f.view.Items = f.view.Items[:0]
		for _, n := range page.Threads {
			f.view.Items = append(f.view.Items, convert(n))
		}
	}
	return nil
}

var (
	subjectURL = regexp.MustCompile(`/repos/([^/]+/[^/]+)/(issues|pulls|discussions)/(\d+)$`)
	ciTitle    = regexp.MustCompile(`^(.+?) workflow run (\w+) for (.+?) branch$`)
)

func convert(n github.Notification) Item {
	it := Item{ID: n.ID, Repo: n.Repository.FullName, Kind: n.Subject.Type, Title: n.Subject.Title, Reason: n.Reason,
		Unread: n.Unread, UpdatedAt: n.UpdatedAt, URL: n.Repository.HTMLURL}
	if m := subjectURL.FindStringSubmatch(n.Subject.URL); m != nil {
		it.Number, _ = strconv.Atoi(m[3])
		page := map[string]string{"issues": "issues", "pulls": "pull", "discussions": "discussions"}[m[2]]
		it.URL = "https://github.com/" + m[1] + "/" + page + "/" + m[3]
		if m[2] == "discussions" {
			it.Number = 0 // discussions are not rows on the board
		}
	}
	switch n.Subject.Type {
	case "CheckSuite":
		if m := ciTitle.FindStringSubmatch(n.Subject.Title); m != nil {
			it.Branch, it.Failed = m[3], m[2] == "failed"
		}
		it.URL = n.Repository.HTMLURL + "/actions"
	case "Release":
		it.URL = n.Repository.HTMLURL + "/releases"
	}
	return it
}

func workflow(title string) string {
	if m := ciTitle.FindStringSubmatch(title); m != nil {
		return m[1]
	}
	return title
}
