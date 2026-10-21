package github

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Notification is one thread in the user's GitHub notifications inbox.
type Notification struct {
	ID         string     `json:"id"`
	Unread     bool       `json:"unread"`
	Reason     string     `json:"reason"` // comment, mention, review_requested, ci_activity, author, ...
	UpdatedAt  time.Time  `json:"updated_at"`
	LastReadAt *time.Time `json:"last_read_at"`
	Subject    struct {
		Title string `json:"title"`
		URL   string `json:"url"`  // API URL of the issue or pull request; empty for CI runs
		Type  string `json:"type"` // Issue, PullRequest, CheckSuite, Release, Discussion, ...
	} `json:"subject"`
	Repository struct {
		FullName string `json:"full_name"`
		HTMLURL  string `json:"html_url"`
	} `json:"repository"`
}

// NotificationPage is the result of one notifications fetch.
type NotificationPage struct {
	Threads      []Notification
	NotModified  bool   // nothing changed since lastModified; Threads is empty
	LastModified string // pass back on the next call
	PollSeconds  int    // how long GitHub asks clients to wait before the next call
}

// Notifications lists notification threads updated since the given time, read and unread. With
// lastModified from the previous call, an unchanged inbox answers 304 at no cost to the quota.
// It only reads: HelloGitty never marks a notification read.
func (c *Client) Notifications(ctx context.Context, since time.Time, lastModified string) (NotificationPage, error) {
	q := url.Values{"all": {"true"}, "per_page": {"50"}, "since": {since.UTC().Format(time.RFC3339)}}
	var page NotificationPage
	extra := map[string]string{}
	if lastModified != "" {
		extra["If-Modified-Since"] = lastModified
	}
	next := c.url("/notifications", q)
	for first := true; next != "" && len(page.Threads) < 500; first = false {
		var batch []Notification
		n, h, notModified, err := c.send(ctx, http.MethodGet, next, nil, extra, &batch)
		if err != nil {
			return page, err
		}
		if first {
			page.LastModified, page.PollSeconds = lastModified, 60
			if h != nil {
				if lm := h.Get("Last-Modified"); lm != "" {
					page.LastModified = lm
				}
				if p, err := strconv.Atoi(h.Get("X-Poll-Interval")); err == nil && p > 0 {
					page.PollSeconds = p
				}
			}
			if notModified {
				page.NotModified = true
				return page, nil
			}
		}
		page.Threads = append(page.Threads, batch...)
		next, extra = n, nil
	}
	return page, nil
}
