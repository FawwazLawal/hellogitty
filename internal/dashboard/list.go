package dashboard

import (
	"html/template"
	"log"
	"net/http"
	"strings"

	"github.com/FawwazLawal/hellogitty/internal/pipeline"
)

// The Pipeline panel's numbers open what they count on a page of their own: the repositories at a
// stage, or your pull requests that are open, merged or closed.

type listPage struct {
	Version     string
	Title, Sub  string
	PRs         []prRow
	Repos       []row
	HasPipeline bool
	Labels      pipeline.Labels
	Empty       string
	Links       []listLink // the panel's other numbers, to move between lists
}

type listLink struct {
	Label, URL string
	Count      int
	Current    bool
}

func (h *Handler) serveList(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.New("index").Funcs(funcs).Parse(h.Template)
	if err == nil && h.ListTemplate != "" {
		_, err = tmpl.New("listpage").Parse(h.ListTemplate)
	}
	if err != nil || h.ListTemplate == "" {
		log.Printf("dashboard: list template: %v", err)
		http.Error(w, "list template error", http.StatusInternalServerError)
		return
	}
	p, err := h.build()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	q := r.URL.Query()
	lp := listPage{Version: h.Version, HasPipeline: p.HasPipeline, Labels: p.Labels}
	prWant, stage := q.Get("prs"), q.Get("stage")
	for _, c := range p.Pipeline.Counts {
		lp.Links = append(lp.Links, listLink{Label: c.Abbr + " · " + c.Name, URL: "/list?stage=" + c.Name, Count: c.Count, Current: c.Name == stage})
	}
	for _, k := range []struct{ key, label string }{{"opened", "Opened"}, {"open", "Open"}, {"merged", "Merged"}, {"closed", "Closed"}} {
		n := 0
		for _, pr := range p.Pipeline.All {
			if prMatches(pr, k.key) {
				n++
			}
		}
		lp.Links = append(lp.Links, listLink{Label: k.label, URL: "/list?prs=" + k.key, Count: n, Current: k.key == prWant})
	}
	switch {
	case prWant != "":
		for _, pr := range p.Pipeline.All {
			if prMatches(pr, prWant) {
				lp.PRs = append(lp.PRs, pr)
			}
		}
		lp.Title = map[string]string{"opened": "Pull requests you opened", "open": "Your open pull requests",
			"merged": "Your merged pull requests", "closed": "Your pull requests closed without merging",
			"decided": "Your merged and closed pull requests"}[prWant]
		if lp.Title == "" {
			http.NotFound(w, r)
			return
		}
		lp.Sub = "In tracked repositories, newest first."
		lp.Empty = "None yet."
	case stage != "":
		known := false
		for _, c := range p.Pipeline.Counts {
			known = known || c.Name == stage
		}
		if !known {
			http.NotFound(w, r)
			return
		}
		for _, rw := range p.Rows {
			if rw.InPipeline && rw.Stage == stage {
				lp.Repos = append(lp.Repos, rw)
			}
		}
		lp.Title = "Repositories at " + stage
		lp.Sub = "Where your pipeline command says each repository is now."
		lp.Empty = "No repository is at this stage."
	default:
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := tmpl.ExecuteTemplate(w, "listpage", lp); err != nil {
		log.Printf("dashboard: render list: %v", err)
	}
}

func prMatches(pr prRow, want string) bool {
	switch want {
	case "opened":
		return true
	case "open":
		return pr.State == "Open"
	case "merged":
		return pr.State == "Merged"
	case "closed":
		return pr.State == "Closed"
	case "decided":
		return pr.State == "Merged" || pr.State == "Closed"
	}
	return strings.EqualFold(pr.State, want)
}
