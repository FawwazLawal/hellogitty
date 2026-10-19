package github

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

func testClient(srv *httptest.Server) (*Client, *[]time.Duration) {
	c := New("test-token")
	c.BaseURL = srv.URL
	var slept []time.Duration
	c.sleep = func(_ context.Context, d time.Duration) error { slept = append(slept, d); return nil }
	return c, &slept
}

func TestOpenIssuesPaginatesAndDropsPRs(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("missing auth header")
		}
		switch r.URL.Query().Get("page") {
		case "":
			w.Header().Set("Link", fmt.Sprintf(`<%s/repos/o/r/issues?page=2>; rel="next"`, srv.URL))
			fmt.Fprint(w, `[{"number":1,"title":"a"},{"number":2,"title":"pr","pull_request":{}}]`)
		case "2":
			fmt.Fprint(w, `[{"number":3,"title":"b"}]`)
		}
	}))
	defer srv.Close()
	c, _ := testClient(srv)

	issues, complete, err := c.OpenIssues(context.Background(), "o", "r", 10)
	if err != nil {
		t.Fatal(err)
	}
	if !complete || len(issues) != 2 || issues[0].Number != 1 || issues[1].Number != 3 {
		t.Fatalf("complete=%v issues=%+v", complete, issues)
	}

	_, complete, err = c.OpenIssues(context.Background(), "o", "r", 1)
	if err != nil || complete {
		t.Fatalf("page cap should report incomplete: complete=%v err=%v", complete, err)
	}
}

func TestRateLimitWaitsThenRetries(t *testing.T) {
	var calls int32
	reset := time.Now().Add(30 * time.Second).Unix()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			w.Header().Set("X-RateLimit-Remaining", "0")
			w.Header().Set("X-RateLimit-Limit", "5000")
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset, 10))
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("X-RateLimit-Remaining", "4999")
		w.Header().Set("X-RateLimit-Limit", "5000")
		w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset, 10))
		fmt.Fprint(w, `[{"commit":{"committer":{"date":"2026-10-17T09:23:00Z"}}}]`)
	}))
	defer srv.Close()
	c, slept := testClient(srv)

	ts, err := c.LastCommit(context.Background(), "o", "r")
	if err != nil {
		t.Fatal(err)
	}
	if ts == nil || ts.Format(time.RFC3339) != "2026-10-17T09:23:00Z" {
		t.Errorf("last commit: %v", ts)
	}
	if calls != 2 {
		t.Errorf("calls=%d, want 2", calls)
	}
	if len(*slept) == 0 || (*slept)[0] <= 0 || (*slept)[0] > 32*time.Second {
		t.Errorf("expected one wait up to the reset, got %v", *slept)
	}
	if rem, lim, _ := c.RateLimit(); rem != 4999 || lim != 5000 {
		t.Errorf("rate limit tracking rem=%d lim=%d", rem, lim)
	}
}

func TestRateLimitBeyondMaxWaitFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10))
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	c, slept := testClient(srv)
	_, err := c.LastCommit(context.Background(), "o", "r")
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("want ErrRateLimited, got %v", err)
	}
	if len(*slept) != 0 {
		t.Errorf("should not sleep an hour: %v", *slept)
	}
}

func TestNotFoundIsStatusError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, `{"message":"Not Found"}`)
	}))
	defer srv.Close()
	c, _ := testClient(srv)
	_, err := c.Issue(context.Background(), "o", "r", 1)
	var se *StatusError
	if !errors.As(err, &se) || se.Code != 404 {
		t.Fatalf("want 404 StatusError, got %v", err)
	}
}

// Live check against the real API. Opt in with HELLOGITTY_LIVE=1 and GITHUB_TOKEN set.
func TestLiveOpenIssues(t *testing.T) {
	if os.Getenv("HELLOGITTY_LIVE") != "1" {
		t.Skip("set HELLOGITTY_LIVE=1 to hit api.github.com")
	}
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		t.Fatal("GITHUB_TOKEN not set")
	}
	c := New(token)
	issues, complete, err := c.OpenIssues(context.Background(), "cli", "cli", 10)
	if err != nil {
		t.Fatal(err)
	}
	rem, lim, _ := c.RateLimit()
	t.Logf("cli/cli open issues (PRs excluded): %d complete=%v | rate %d/%d", len(issues), complete, rem, lim)
	if len(issues) == 0 {
		t.Error("expected at least one open issue")
	}
}

func TestSearchRateLimitDoesNotOverwriteCoreQuota(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Limit", "5000")
		w.Header().Set("X-RateLimit-Remaining", "4000")
		w.Header().Set("X-RateLimit-Reset", "1900000000")
		w.Header().Set("X-RateLimit-Resource", "core")
		if r.URL.Path == "/search/issues" {
			w.Header().Set("X-RateLimit-Limit", "30")
			w.Header().Set("X-RateLimit-Remaining", "29")
			w.Header().Set("X-RateLimit-Resource", "search")
			fmt.Fprint(w, `{"items":[{"number":1,"repository_url":"https://api.github.com/repos/o/r"}]}`)
			return
		}
		fmt.Fprint(w, `{"login":"me"}`)
	}))
	defer srv.Close()
	c, _ := testClient(srv)
	if login, err := c.AuthenticatedUser(context.Background()); err != nil || login != "me" {
		t.Fatalf("user: %q %v", login, err)
	}
	prs, err := c.PRsByAuthor(context.Background(), "me")
	if err != nil || len(prs) != 1 {
		t.Fatalf("search: %v %v", prs, err)
	}
	if o, n := prs[0].Repo(); o != "o" || n != "r" {
		t.Errorf("repo parse %s/%s", o, n)
	}
	if rem, lim, _ := c.RateLimit(); rem != 4000 || lim != 5000 {
		t.Errorf("core quota overwritten by search headers: %d/%d", rem, lim)
	}
	if c.Requests() != 2 {
		t.Errorf("requests counted %d, want 2", c.Requests())
	}
}

func TestSecondaryRateLimitWaitsAndRetries(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, `{"message":"You have exceeded a secondary rate limit. Please wait a few minutes before you try again."}`)
			return
		}
		fmt.Fprint(w, `{"total_count":9771}`)
	}))
	defer srv.Close()
	c, slept := testClient(srv)
	n, err := c.SearchCount(context.Background(), "repo:golang/go is:issue is:open")
	if err != nil || n != 9771 {
		t.Fatalf("got %d, %v", n, err)
	}
	if calls != 2 {
		t.Errorf("calls %d, want a retry", calls)
	}
	waitedMinute := false
	for _, d := range *slept {
		if d >= time.Minute {
			waitedMinute = true
		}
	}
	if !waitedMinute {
		t.Errorf("should wait at least a minute after a secondary limit, slept %v", *slept)
	}
}

func TestSearchCallsAreSpaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"total_count":1}`)
	}))
	defer srv.Close()
	c, slept := testClient(srv)
	now := time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return now }
	for i := 0; i < 3; i++ {
		if _, err := c.SearchCount(context.Background(), "q"); err != nil {
			t.Fatal(err)
		}
	}
	var spaced int
	for _, d := range *slept {
		if d >= 2*time.Second {
			spaced++
		}
	}
	if spaced < 2 {
		t.Errorf("3 back-to-back searches should wait twice, slept %v", *slept)
	}
}
