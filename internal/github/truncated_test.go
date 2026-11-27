package github

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// A 200 whose body was cut off in transit is a passing failure, like a 502:
// the same request a moment later returns the whole answer. It is retried
// with backoff, not returned as "unexpected end of JSON input".
func TestGraphQLRetriesATruncatedBody(t *testing.T) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if n.Add(1) == 1 {
			io.WriteString(w, `{"data":{"viewer":{"login":"m`)
			return
		}
		io.WriteString(w, `{"data":{"viewer":{"login":"me"}}}`)
	}))
	defer srv.Close()
	c, slept := testClient(srv)
	var out struct {
		Viewer struct{ Login string } `json:"viewer"`
	}
	if err := c.GraphQL(context.Background(), "query { viewer { login } }", nil, &out); err != nil {
		t.Fatalf("a body truncated once failed the call: %v", err)
	}
	if out.Viewer.Login != "me" || n.Load() != 2 || len(*slept) != 1 {
		t.Errorf("login %q after %d requests and %d waits; want me after 2 requests and 1 wait", out.Viewer.Login, n.Load(), len(*slept))
	}
}

// Retrying is bounded: a body that is truncated every time fails after the
// client's attempts, naming the truncation.
func TestGraphQLGivesUpOnABodyTruncatedEveryTime(t *testing.T) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		io.WriteString(w, `{"data":{"viewer":`)
	}))
	defer srv.Close()
	c, _ := testClient(srv)
	var out struct{}
	err := c.GraphQL(context.Background(), "query { viewer { login } }", nil, &out)
	if err == nil || !strings.Contains(err.Error(), "unexpected end of JSON input") {
		t.Fatalf("err %v; want the truncation named", err)
	}
	if n.Load() != maxAttempts {
		t.Errorf("%d requests; want %d", n.Load(), maxAttempts)
	}
}

// A body that is whole but is not the JSON expected is not retried: asking
// again returns the same thing.
func TestGraphQLDoesNotRetryAWholeBodyThatDoesNotDecode(t *testing.T) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		io.WriteString(w, `<html>not json</html>`)
	}))
	defer srv.Close()
	c, _ := testClient(srv)
	var out struct{}
	if err := c.GraphQL(context.Background(), "query { viewer { login } }", nil, &out); err == nil {
		t.Fatal("a body that is not JSON decoded")
	}
	if n.Load() != 1 {
		t.Errorf("%d requests; a whole body that does not decode is not retried", n.Load())
	}
}
