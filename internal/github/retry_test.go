package github

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

type timeoutErr struct{}

func (timeoutErr) Error() string   { return "read tcp: i/o timeout" }
func (timeoutErr) Timeout() bool   { return true }
func (timeoutErr) Temporary() bool { return true }

func TestRetryable(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{context.DeadlineExceeded, true},
		{fmt.Errorf("pull requests: %w", context.DeadlineExceeded), true},
		{timeoutErr{}, true},
		{&url.Error{Op: "Get", URL: "u", Err: timeoutErr{}}, true},
		{&StatusError{Code: 502}, true},
		{&StatusError{Code: 503}, true},
		{&StatusError{Code: 504}, true},
		{fmt.Errorf("pull requests: %w", &StatusError{Code: 502}), true},
		{&StatusError{Code: 404}, false},
		{&StatusError{Code: 422}, false},
		{&StatusError{Code: 401}, false},
		{ErrRateLimited, false},
		{fmt.Errorf("%w (wait 2m)", ErrRateLimited), false},
		{context.Canceled, false},
		{errors.New("decode: bad json"), false},
		{nil, false},
	}
	for _, tc := range cases {
		if got := Retryable(tc.err); got != tc.want {
			t.Errorf("Retryable(%v) = %v, want %v", tc.err, got, tc.want)
		}
	}
}

func TestRequestTimeoutBoundsEachAttemptAndCanBeWidened(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("slow") == "1" {
			time.Sleep(150 * time.Millisecond)
		}
		fmt.Fprint(w, `{"login":"me"}`)
	}))
	defer srv.Close()
	c, slept := testClient(srv)
	c.RequestTimeout = 30 * time.Millisecond
	slow := c.url("/user", url.Values{"slow": {"1"}})

	var out User
	_, err := c.get(context.Background(), slow, &out)
	if err == nil {
		t.Fatal("a 150ms answer must fail a 30ms request timeout")
	}
	if !Retryable(err) {
		t.Errorf("a timed-out request must be retryable: %v", err)
	}
	if len(*slept) != maxAttempts-1 {
		t.Errorf("slept %d times, want %d (every attempt timed out, backoff between each)", len(*slept), maxAttempts-1)
	}

	*slept = nil
	if _, err := c.get(WithRequestTimeout(context.Background(), 2*time.Second), slow, &out); err != nil {
		t.Fatalf("a widened timeout must let the slow answer through: %v", err)
	}
	if out.Login != "me" || len(*slept) != 0 {
		t.Errorf("login %q slept %v, want me and no backoff", out.Login, *slept)
	}
}
