package dashboard

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/feed"
	"github.com/FawwazLawal/hellogitty/web"
)

type feedSource struct {
	fakeSource
	acked []string
}

func (f *feedSource) Feed() []feed.Row {
	return []feed.Row{{ID: "i:pbakaus/impeccable#1101", Kind: "new-issue", Label: "New issue", Repo: "pbakaus/impeccable", Number: 1101,
		Text: "Live mode misses DESIGN.md edits", URL: "https://github.com/pbakaus/impeccable/issues/1101", At: time.Now().Add(-time.Hour), Key: "pbakaus/impeccable#1101"}}
}

func (f *feedSource) Ack(_ context.Context, ids []string) []AckResult {
	f.acked = append(f.acked, ids...)
	return []AckResult{{ID: ids[0], GitHub: "local"}}
}

func TestFeedPanelPageAndGuardedAck(t *testing.T) {
	src := &feedSource{}
	h := handler(fakeSource{})
	h.Source = src
	h.FeedTemplate = web.Feed

	_, dash := get(t, h, "/")
	for _, want := range []string{`data-module="feed"`, `<span class="ftag new-issue">New issue</span>`, `data-token="` + h.token() + `"`,
		`title="Acknowledge; kept in HelloGitty only"`, `<span id="feed-open">1</span> new`} {
		if !strings.Contains(dash, want) {
			t.Errorf("dashboard missing %s", want)
		}
	}
	if code, page := get(t, h, "/feed"); code != 200 || !strings.Contains(page, "<title>HelloGitty live</title>") || !strings.Contains(page, "Live mode misses DESIGN.md edits") {
		t.Errorf("feed page %d", code)
	}
	if _, js := get(t, h, "/feed.json"); !strings.Contains(js, `"id":"i:pbakaus/impeccable#1101"`) {
		t.Errorf("feed.json %s", js)
	}

	post := func(token, origin string) int {
		req := httptest.NewRequest("POST", "/feed/ack", strings.NewReader(`{"ids":["i:pbakaus/impeccable#1101"]}`))
		req.Host = "localhost:7340"
		if token != "" {
			req.Header.Set("X-HelloGitty-Token", token)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if c := post("", ""); c != http.StatusForbidden {
		t.Errorf("no token: %d", c)
	}
	if c := post(h.token(), "https://evil.example"); c != http.StatusForbidden {
		t.Errorf("another website: %d", c)
	}
	if len(src.acked) != 0 {
		t.Fatal("nothing may be acknowledged by a forged request")
	}
	if c := post(h.token(), "http://localhost:7340"); c != 200 || len(src.acked) != 1 {
		t.Errorf("the page's own request: %d %v", c, src.acked)
	}
	if code, _ := get(t, h, "/feed/ack"); code != http.StatusMethodNotAllowed {
		t.Errorf("GET ack: %d", code)
	}
}
