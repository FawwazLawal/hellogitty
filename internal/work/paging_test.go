package work

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

// openPRServer is a GraphQL server whose open-PR search holds total pull
// requests and answers page by page with a cursor; every other search is
// empty. It records the page size each open-PR request asked for.
func openPRServer(t *testing.T, total int) (*httptest.Server, func() []int) {
	t.Helper()
	first := regexp.MustCompile(`prsOpen: search\([^)]*first: (\d+)`)
	var mu sync.Mutex
	var asked []int
	node := func(i int) string {
		return fmt.Sprintf(`{"__typename":"PullRequest","number":%d,"title":"pr %d","url":"https://github.com/o/r/pull/%d","state":"OPEN","createdAt":"2026-11-20T08:00:00Z","updatedAt":"2026-11-20T08:00:00Z","repository":{"nameWithOwner":"o/r"},"author":{"login":"me","__typename":"User"}}`, i, i, i)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var req struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		_ = json.Unmarshal(b, &req)
		if _, ok := req.Variables["prsOpen"]; !ok {
			name := "none"
			for k := range req.Variables {
				name = k
			}
			fmt.Fprintf(w, `{"data":{%q:{"nodes":[]},"rateLimit":{"cost":1,"remaining":4000}}}`, name)
			return
		}
		m := first.FindStringSubmatch(req.Query)
		if m == nil {
			t.Errorf("open-PR query names no page size:\n%s", req.Query)
			return
		}
		size, _ := strconv.Atoi(m[1])
		start := 0
		if a, ok := req.Variables["after"].(string); ok && a != "" {
			start, _ = strconv.Atoi(strings.TrimPrefix(a, "c"))
		}
		mu.Lock()
		asked = append(asked, size)
		mu.Unlock()
		end := min(start+size, total)
		var nodes []string
		for i := start; i < end; i++ {
			nodes = append(nodes, node(i+1))
		}
		fmt.Fprintf(w, `{"data":{"prsOpen":{"pageInfo":{"hasNextPage":%t,"endCursor":"c%d"},"nodes":[%s]},"rateLimit":{"cost":1,"remaining":4000}}}`,
			end < total, end, strings.Join(nodes, ","))
	}))
	t.Cleanup(srv.Close)
	return srv, func() []int { mu.Lock(); defer mu.Unlock(); return append([]int(nil), asked...) }
}

func sentPRs(b *Board) int {
	n := 0
	for _, it := range b.Sent {
		if it.PR {
			n++
		}
	}
	return n
}

// The open-PR search is the board's heaviest (every node carries its
// checks, review threads and timeline), so it is asked for in small pages:
// a large page is what came back as a 502 or a truncated body. Paging
// changes nothing on the board: every open PR up to the same cap arrives.
func TestOpenPRsArriveInSmallPages(t *testing.T) {
	for _, c := range []struct{ total, want int }{{45, 45}, {99, 50}} {
		srv, asked := openPRServer(t, c.total)
		gh := github.New("t")
		gh.BaseURL = srv.URL
		b, err := fetch(context.Background(), gh, "me", nil, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC))
		if err != nil {
			t.Fatalf("%d open PRs: %v", c.total, err)
		}
		// The bound is written here, not read from the code: 50 at once is what failed.
		const maxPage = 20
		pages := asked()
		for _, size := range pages {
			if size > maxPage {
				t.Errorf("%d open PRs: a request asked for %d at once; pages are at most %d", c.total, size, maxPage)
			}
		}
		if c.total > maxPage && len(pages) < 2 {
			t.Errorf("%d open PRs arrived in %d request(s); want more than one page", c.total, len(pages))
		}
		if got := sentPRs(b); got != c.want {
			t.Errorf("%d open PRs: the board shows %d, want %d (pages asked: %v)", c.total, got, c.want, pages)
		}
	}
}
