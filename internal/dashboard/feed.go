package dashboard

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/feed"
)

// FeedSource is optional: a Source that can build the live activity feed and acknowledge its rows.
type FeedSource interface {
	Feed() []feed.Row
	Ack(ctx context.Context, ids []string) []AckResult
}

// AckResult says what acknowledging one row did: "marked" (also marked read on GitHub), "local"
// (no GitHub notification behind it, so kept here only), or "failed: ...".
type AckResult struct {
	ID     string `json:"id"`
	GitHub string `json:"github"`
}

// feedShown is how many rows the dashboard panel renders before its first live update.
const feedShown = 40

type feedRow struct {
	feed.Row
	Eye      bool // show the eye: a row about an issue, on a page that can watch
	Ago      string
	AgoTitle string
}

type feedView struct {
	Known bool
	Rows  []feedRow
	Open  int // rows not yet acknowledged
}

func buildFeed(rows []feed.Row, now time.Time) feedView {
	v := feedView{Known: true}
	for i, r := range rows {
		if !r.Acked {
			v.Open++
		}
		if i < feedShown {
			v.Rows = append(v.Rows, feedRow{Row: r, Ago: ago(now, r.At), AgoTitle: r.At.UTC().Format("2006-01-02 15:04Z")})
		}
	}
	return v
}

var (
	tokenOnce sync.Once
	pageToken string
)

// token is a random value the page sends back with every acknowledgement. Another website can't
// read it, so it can't make your browser acknowledge rows (or mark notifications read) behind your
// back.
func (h *Handler) token() string {
	tokenOnce.Do(func() {
		b := make([]byte, 16)
		rand.Read(b)
		pageToken = hex.EncodeToString(b)
	})
	return pageToken
}

// sameOrigin reports whether a request came from this dashboard's own pages.
func sameOrigin(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		return false
	}
	if o := r.Header.Get("Origin"); o != "" {
		u, err := url.Parse(o)
		if err != nil || u.Host != r.Host {
			return false
		}
	}
	return true
}

func (h *Handler) serveFeedJSON(w http.ResponseWriter, r *http.Request) {
	fs, ok := h.Source.(FeedSource)
	out := struct {
		Rows []feed.Row `json:"rows"`
	}{Rows: []feed.Row{}}
	if ok {
		if rows := fs.Feed(); rows != nil {
			out.Rows = rows
		}
		if ws, ok := h.Source.(WatchSource); ok {
			keys := ws.WatchedKeys()
			for i := range out.Rows {
				out.Rows[i].Watched = keys[out.Rows[i].Key]
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(out)
}

func (h *Handler) serveFeedAck(w http.ResponseWriter, r *http.Request) {
	fs, ok := h.Source.(FeedSource)
	switch {
	case !ok:
		http.NotFound(w, r)
		return
	case r.Method != http.MethodPost:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	case !sameOrigin(r) || r.Header.Get("X-HelloGitty-Token") != h.token():
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil || len(req.IDs) == 0 || len(req.IDs) > 200 {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	res := fs.Ack(ctx, req.IDs)
	for _, x := range res {
		if strings.HasPrefix(x.GitHub, "failed") {
			log.Printf("feed: acknowledge %s: %s", x.ID, x.GitHub)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		Results []AckResult `json:"results"`
	}{res})
}

// serveFeedPage is the feed on its own, small enough to keep in a narrow window beside your work.
func (h *Handler) serveFeedPage(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.New("index").Funcs(funcs).Parse(h.Template)
	if err == nil && h.FeedTemplate != "" {
		_, err = tmpl.New("feedpage").Parse(h.FeedTemplate)
	}
	if err != nil || h.FeedTemplate == "" {
		log.Printf("dashboard: feed template: %v", err)
		http.Error(w, "feed template error", http.StatusInternalServerError)
		return
	}
	p := struct {
		headerInfo
		Token    string
		Feed     feedView
		CanWatch bool
	}{headerInfo: h.buildHeaderInfo(), Token: h.token()}
	if fs, ok := h.Source.(FeedSource); ok {
		p.Feed = buildFeed(fs.Feed(), h.now())
	}
	if ws, ok := h.Source.(WatchSource); ok {
		keys := ws.WatchedKeys()
		p.CanWatch = true
		for i := range p.Feed.Rows {
			p.Feed.Rows[i].Watched = keys[p.Feed.Rows[i].Key]
			p.Feed.Rows[i].Eye = issueKind(p.Feed.Rows[i].Kind)
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := tmpl.ExecuteTemplate(w, "feedpage", p); err != nil {
		log.Printf("dashboard: render feed: %v", err)
	}
}
