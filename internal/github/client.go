package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultBaseURL = "https://api.github.com"
	maxAttempts    = 4
	// A wait longer than this would stall the whole poll, so the request fails instead and the
	// repo is retried on the next cycle.
	maxRateWait = 15 * time.Minute
)

var ErrRateLimited = errors.New("github: rate limited beyond max wait")

type Client struct {
	BaseURL string
	HTTP    *http.Client
	token   string
	sleep   func(context.Context, time.Duration) error
	now     func() time.Time

	requests atomic.Int64

	mu        sync.Mutex
	remaining int
	limit     int
	reset     time.Time
}

func New(token string) *Client {
	return &Client{
		BaseURL:   defaultBaseURL,
		HTTP:      &http.Client{Timeout: 30 * time.Second},
		token:     token,
		sleep:     sleepCtx,
		now:       time.Now,
		remaining: -1,
	}
}

// Requests counts every HTTP attempt made, retries included.
func (c *Client) Requests() int64 { return c.requests.Load() }

func (c *Client) RateLimit() (remaining, limit int, reset time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.remaining, c.limit, c.reset
}

type User struct {
	Login string `json:"login"`
	Type  string `json:"type"`
}

func (u User) IsBot() bool {
	return u.Type == "Bot" || strings.HasSuffix(u.Login, "[bot]")
}

type Label struct {
	Name string `json:"name"`
}

type Issue struct {
	Number      int        `json:"number"`
	Title       string     `json:"title"`
	State       string     `json:"state"`
	StateReason string     `json:"state_reason"`
	Body        string     `json:"body"`
	Labels      []Label    `json:"labels"`
	Assignees   []User     `json:"assignees"`
	CreatedAt   *time.Time `json:"created_at"`
	UpdatedAt   *time.Time `json:"updated_at"`
	ClosedAt    *time.Time `json:"closed_at"`
	HTMLURL     string     `json:"html_url"`
	PullRequest *struct{}  `json:"pull_request"`
}

type PullRequest struct {
	Number            int        `json:"number"`
	Title             string     `json:"title"`
	State             string     `json:"state"`
	Body              string     `json:"body"`
	MergedAt          *time.Time `json:"merged_at"`
	ClosedAt          *time.Time `json:"closed_at"`
	AuthorAssociation string     `json:"author_association"`
	User              User       `json:"user"`
}

type Review struct {
	State       string     `json:"state"`
	SubmittedAt *time.Time `json:"submitted_at"`
}

type Comment struct {
	Body              string     `json:"body"`
	HTMLURL           string     `json:"html_url"`
	CreatedAt         *time.Time `json:"created_at"`
	AuthorAssociation string     `json:"author_association"`
	User              User       `json:"user"`
}

type TimelineEvent struct {
	Event    string `json:"event"`
	CommitID string `json:"commit_id"`
	Source   *struct {
		Issue *struct {
			Number      int    `json:"number"`
			HTMLURL     string `json:"html_url"`
			PullRequest *struct {
				MergedAt *time.Time `json:"merged_at"`
				HTMLURL  string     `json:"html_url"`
			} `json:"pull_request"`
		} `json:"issue"`
	} `json:"source"`
}

type commit struct {
	Commit struct {
		Committer struct {
			Date *time.Time `json:"date"`
		} `json:"committer"`
	} `json:"commit"`
}

// OpenIssues returns open issues (pull requests filtered out). complete is false when the
// page cap was hit, so callers must not treat missing issues as closed.
func (c *Client) OpenIssues(ctx context.Context, owner, repo string, maxPages int) (issues []Issue, complete bool, err error) {
	q := url.Values{"state": {"open"}, "per_page": {"100"}}
	next := c.url(fmt.Sprintf("/repos/%s/%s/issues", owner, repo), q)
	for page := 0; next != ""; page++ {
		if page == maxPages {
			return issues, false, nil
		}
		var batch []Issue
		if next, err = c.get(ctx, next, &batch); err != nil {
			return nil, false, err
		}
		for _, i := range batch {
			if i.PullRequest == nil {
				issues = append(issues, i)
			}
		}
	}
	return issues, true, nil
}

func (c *Client) Issue(ctx context.Context, owner, repo string, number int) (*Issue, error) {
	var i Issue
	_, err := c.get(ctx, c.url(fmt.Sprintf("/repos/%s/%s/issues/%d", owner, repo, number), nil), &i)
	return &i, err
}

func (c *Client) ClosedPRs(ctx context.Context, owner, repo string) ([]PullRequest, error) {
	q := url.Values{"state": {"closed"}, "per_page": {"100"}, "sort": {"updated"}, "direction": {"desc"}}
	var prs []PullRequest
	_, err := c.get(ctx, c.url(fmt.Sprintf("/repos/%s/%s/pulls", owner, repo), q), &prs)
	return prs, err
}

func (c *Client) Reviews(ctx context.Context, owner, repo string, number int) ([]Review, error) {
	var r []Review
	_, err := c.get(ctx, c.url(fmt.Sprintf("/repos/%s/%s/pulls/%d/reviews", owner, repo, number), url.Values{"per_page": {"100"}}), &r)
	return r, err
}

func (c *Client) IssueComments(ctx context.Context, owner, repo string, number int, since *time.Time) ([]Comment, error) {
	q := url.Values{"per_page": {"100"}}
	if since != nil {
		q.Set("since", since.UTC().Format(time.RFC3339))
	}
	var out []Comment
	next := c.url(fmt.Sprintf("/repos/%s/%s/issues/%d/comments", owner, repo, number), q)
	for page := 0; next != "" && page < 5; page++ {
		var batch []Comment
		var err error
		if next, err = c.get(ctx, next, &batch); err != nil {
			return nil, err
		}
		out = append(out, batch...)
	}
	return out, nil
}

func (c *Client) Timeline(ctx context.Context, owner, repo string, number int) ([]TimelineEvent, error) {
	var out []TimelineEvent
	next := c.url(fmt.Sprintf("/repos/%s/%s/issues/%d/timeline", owner, repo, number), url.Values{"per_page": {"100"}})
	for page := 0; next != "" && page < 5; page++ {
		var batch []TimelineEvent
		var err error
		if next, err = c.get(ctx, next, &batch); err != nil {
			return nil, err
		}
		out = append(out, batch...)
	}
	return out, nil
}

func (c *Client) LastCommit(ctx context.Context, owner, repo string) (*time.Time, error) {
	var commits []commit
	if _, err := c.get(ctx, c.url(fmt.Sprintf("/repos/%s/%s/commits", owner, repo), url.Values{"per_page": {"1"}}), &commits); err != nil {
		return nil, err
	}
	if len(commits) == 0 {
		return nil, nil
	}
	return commits[0].Commit.Committer.Date, nil
}

type SearchPR struct {
	Number        int        `json:"number"`
	Title         string     `json:"title"`
	State         string     `json:"state"`
	HTMLURL       string     `json:"html_url"`
	RepositoryURL string     `json:"repository_url"`
	CreatedAt     *time.Time `json:"created_at"`
	ClosedAt      *time.Time `json:"closed_at"`
	PullRequest   *struct {
		MergedAt *time.Time `json:"merged_at"`
	} `json:"pull_request"`
}

// Repo returns the owner and name from the item's repository_url.
func (p SearchPR) Repo() (owner, name string) {
	parts := strings.Split(strings.TrimRight(p.RepositoryURL, "/"), "/")
	if len(parts) < 2 {
		return "", ""
	}
	return parts[len(parts)-2], parts[len(parts)-1]
}

func (c *Client) AuthenticatedUser(ctx context.Context) (string, error) {
	var u User
	if _, err := c.get(ctx, c.url("/user", nil), &u); err != nil {
		return "", err
	}
	return u.Login, nil
}

// PRsByAuthor returns pull requests opened by login in any repository, newest first.
func (c *Client) PRsByAuthor(ctx context.Context, login string) ([]SearchPR, error) {
	q := url.Values{"q": {"author:" + login + " type:pr"}, "per_page": {"100"}, "sort": {"created"}, "order": {"desc"}}
	var out []SearchPR
	next := c.url("/search/issues", q)
	for page := 0; next != "" && page < 3; page++ {
		var res struct {
			Items []SearchPR `json:"items"`
		}
		var err error
		if next, err = c.get(ctx, next, &res); err != nil {
			return nil, err
		}
		out = append(out, res.Items...)
	}
	return out, nil
}

func (c *Client) url(path string, q url.Values) string {
	u := strings.TrimRight(c.BaseURL, "/") + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return u
}

type StatusError struct {
	Code int
	URL  string
	Body string
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("github: %d from %s: %s", e.Code, e.URL, e.Body)
}

func (c *Client) get(ctx context.Context, rawURL string, out any) (next string, err error) {
	for attempt := 1; ; attempt++ {
		if err := c.waitIfExhausted(ctx); err != nil {
			return "", err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		req.Header.Set("User-Agent", "hellogitty")
		if c.token != "" {
			req.Header.Set("Authorization", "Bearer "+c.token)
		}
		c.requests.Add(1)
		resp, err := c.HTTP.Do(req)
		if err != nil {
			if attempt < maxAttempts && ctx.Err() == nil {
				if err := c.sleep(ctx, backoff(attempt)); err != nil {
					return "", err
				}
				continue
			}
			return "", err
		}
		c.recordRate(resp.Header)
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		resp.Body.Close()
		if readErr != nil {
			return "", readErr
		}

		switch {
		case resp.StatusCode == http.StatusOK:
			if err := json.Unmarshal(body, out); err != nil {
				return "", fmt.Errorf("github: decode %s: %w", rawURL, err)
			}
			return nextLink(resp.Header.Get("Link")), nil

		case isRateLimited(resp):
			wait := c.rateWait(resp.Header)
			if wait > maxRateWait || attempt >= maxAttempts {
				return "", fmt.Errorf("%w (wait %s, %s)", ErrRateLimited, wait.Round(time.Second), rawURL)
			}
			log.Printf("github: rate limited, waiting %s", wait.Round(time.Second))
			if err := c.sleep(ctx, wait); err != nil {
				return "", err
			}

		case resp.StatusCode >= 500 && attempt < maxAttempts:
			if err := c.sleep(ctx, backoff(attempt)); err != nil {
				return "", err
			}

		default:
			msg := string(body)
			if len(msg) > 300 {
				msg = msg[:300]
			}
			return "", &StatusError{Code: resp.StatusCode, URL: rawURL, Body: msg}
		}
	}
}

func isRateLimited(resp *http.Response) bool {
	if resp.StatusCode == http.StatusTooManyRequests {
		return true
	}
	if resp.StatusCode != http.StatusForbidden {
		return false
	}
	return resp.Header.Get("Retry-After") != "" || resp.Header.Get("X-RateLimit-Remaining") == "0"
}

func (c *Client) recordRate(h http.Header) {
	// Search has its own 30/min limit; only the core quota is tracked against the hourly budget.
	if res := h.Get("X-RateLimit-Resource"); res != "" && res != "core" {
		return
	}
	rem, err1 := strconv.Atoi(h.Get("X-RateLimit-Remaining"))
	lim, err2 := strconv.Atoi(h.Get("X-RateLimit-Limit"))
	reset, err3 := strconv.ParseInt(h.Get("X-RateLimit-Reset"), 10, 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return
	}
	c.mu.Lock()
	c.remaining, c.limit, c.reset = rem, lim, time.Unix(reset, 0)
	c.mu.Unlock()
}

func (c *Client) rateWait(h http.Header) time.Duration {
	if s, err := strconv.Atoi(h.Get("Retry-After")); err == nil {
		return time.Duration(s) * time.Second
	}
	if reset, err := strconv.ParseInt(h.Get("X-RateLimit-Reset"), 10, 64); err == nil {
		if d := time.Unix(reset, 0).Sub(c.now()) + time.Second; d > 0 {
			return d
		}
	}
	// Secondary limits without headers: GitHub asks clients to wait at least a minute.
	return time.Minute
}

func (c *Client) waitIfExhausted(ctx context.Context) error {
	c.mu.Lock()
	rem, reset := c.remaining, c.reset
	c.mu.Unlock()
	if rem != 0 {
		return nil
	}
	wait := reset.Sub(c.now()) + time.Second
	if wait <= 0 {
		return nil
	}
	if wait > maxRateWait {
		return fmt.Errorf("%w (quota resets in %s)", ErrRateLimited, wait.Round(time.Second))
	}
	log.Printf("github: quota exhausted, waiting %s for reset", wait.Round(time.Second))
	return c.sleep(ctx, wait)
}

var linkNext = regexp.MustCompile(`<([^>]+)>;\s*rel="next"`)

func nextLink(h string) string {
	if m := linkNext.FindStringSubmatch(h); m != nil {
		return m[1]
	}
	return ""
}

func backoff(attempt int) time.Duration {
	return time.Duration(1<<attempt) * time.Second
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
