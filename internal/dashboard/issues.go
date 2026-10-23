package dashboard

import (
	"html/template"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/store"
)

// IssueSource is optional: a Source that lists open issues across tracked repositories.
type IssueSource interface {
	TopOpenIssues(n int) ([]store.RecentIssue, error)
	PageOpenIssues(since time.Time, offset, limit int) ([]store.RecentIssue, int, error)
	SearchOpenIssues(since time.Time, q string, offset, limit int) ([]store.RecentIssue, int, error)
}

const (
	panelIssues   = 30
	pageIssues    = 100
	issueWindow   = 90 * 24 * time.Hour
)

type issuesPage struct {
	Version  string
	Token    string
	CanWatch bool
	Issues   []globalIssue
	Total    int
	Page     int
	Pages    int
	PrevPage int
	NextPage int
	HasPrev  bool
	HasNext  bool
	Window   int
	Query    string
}

type globalIssue struct {
	Number        int
	Title, URL    string
	Repo          string
	Ago, AgoTitle string
	Labels        []string
	Taken         string
	Watched, Eye  bool
	K             string
	Search        string
}

func toGlobalIssues(items []store.RecentIssue, now time.Time, keys map[string]bool) []globalIssue {
	var out []globalIssue
	for _, i := range items {
		url := "https://github.com/" + i.Repo + "/issues/" + strconv.Itoa(i.Number)
		k := rowKey(i.Repo, i.Number)
		gi := globalIssue{
			Number:   i.Number,
			Title:    i.Title,
			URL:      url,
			Repo:     i.Repo,
			Ago:      ago(now, i.CreatedAt),
			AgoTitle: i.CreatedAt.UTC().Format("2006-01-02 15:04Z"),
			Labels:   i.Labels,
			Eye:      true,
			K:        k,
			Watched:  keys[k],
		}
		switch {
		case len(i.Assignees) > 0:
			gi.Taken = "assigned"
		case i.ClaimSignal != "":
			gi.Taken = "claimed"
		}
		gi.Search = strings.ToLower(i.Repo + " #" + strconv.Itoa(i.Number) + " " + i.Title + " " + strings.Join(i.Labels, " "))
		out = append(out, gi)
	}
	return out
}

// buildPanelIssues returns the issues shown in the dashboard panel.
func (h *Handler) buildPanelIssues(keys map[string]bool) ([]globalIssue, int) {
	is, ok := h.Source.(IssueSource)
	if !ok {
		return nil, 0
	}
	items, err := is.TopOpenIssues(panelIssues)
	if err != nil {
		log.Printf("dashboard: panel issues: %v", err)
		return nil, 0
	}
	return toGlobalIssues(items, h.now(), keys), len(items)
}

func (h *Handler) serveIssues(w http.ResponseWriter, r *http.Request) {
	is, ok := h.Source.(IssueSource)
	if !ok {
		http.NotFound(w, r)
		return
	}
	tmpl, err := template.New("index").Funcs(funcs).Parse(h.Template)
	if err == nil && h.IssuesTemplate != "" {
		_, err = tmpl.New("issuespage").Parse(h.IssuesTemplate)
	}
	if err != nil || h.IssuesTemplate == "" {
		log.Printf("dashboard: issues template: %v", err)
		http.Error(w, "issues template error", http.StatusInternalServerError)
		return
	}

	pg := 1
	if v := r.URL.Query().Get("page"); v != "" {
		if n, e := strconv.Atoi(v); e == nil && n > 0 {
			pg = n
		}
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	offset := (pg - 1) * pageIssues
	since := h.now().Add(-issueWindow)

	var items []store.RecentIssue
	var total int
	if q != "" {
		items, total, err = is.SearchOpenIssues(since, q, offset, pageIssues)
	} else {
		items, total, err = is.PageOpenIssues(since, offset, pageIssues)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	pages := (total + pageIssues - 1) / pageIssues
	if pages < 1 {
		pages = 1
	}

	var keys map[string]bool
	ip := issuesPage{
		Version: h.Version, Token: h.token(), Total: total,
		Page: pg, Pages: pages, Window: 90,
		HasPrev: pg > 1, HasNext: pg < pages,
		PrevPage: pg - 1, NextPage: pg + 1,
		Query: q,
	}
	if ws, ok := h.Source.(WatchSource); ok {
		ip.CanWatch = true
		keys = ws.WatchedKeys()
	}
	ip.Issues = toGlobalIssues(items, h.now(), keys)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := tmpl.ExecuteTemplate(w, "issuespage", ip); err != nil {
		log.Printf("dashboard: render issues: %v", err)
	}
}
