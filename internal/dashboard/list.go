package dashboard

import (
	"html/template"
	"log"
	"net/http"
	"net/url"
	"strings"
)

// The Pipeline panel's numbers open what they count on a page of their own: the repositories at a
// stage, or your pull requests that are open, merged or closed.

// listPrKinds is the closed set of ?prs=<value> the /list page recognises. Mirrors the keys of the
// ListTitle map in serveList below, so a change there without a change here fails the validation
// compile-check that the test in list_test.go pins.
var listPrKinds = map[string]bool{
	"opened":  true,
	"open":    true,
	"merged":  true,
	"closed":  true,
	"decided": true,
}

// listQueryIsValid reports whether a /list request's query can lead to a meaningful page under
// EITHER the templated or the React handler. Both call it; both 404 on false.
//
// Two shapes are valid:
//   - prs=<kind> where kind is in listPrKinds. Fixed set; cheap to check.
//   - stage=<non-empty>. Pipeline stages are runtime config (polled from the user's own
//     pipeline command) and change per installation, so a server-side allow-list here would
//     either be wrong or require h.build() on every request. The React client already renders
//     a visible "Not a stage" view for an unknown stage via /app/api/dashboard.json's
//     pipeline.counts, so an unknown stage lands cleanly without needing a 404 from here.
//     Templated serveList does validate the stage against pipeline.Counts and renders the same
//     message in-page (see the switch below) — so templated-side we DO validate; here on the
//     React shell guard we accept any non-empty stage and let the client render.
//
// Any other shape — bare /list, pr=open (typo), what=anything — is 404.
func listQueryIsValid(q url.Values) bool {
	if prWant := q.Get("prs"); prWant != "" {
		return listPrKinds[prWant]
	}
	if q.Get("stage") != "" {
		return true
	}
	return false
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
		log.Printf("dashboard: list build: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	q := r.URL.Query()
	if !listQueryIsValid(q) {
		// Bare /list, a typo like ?pr=open, or ?prs=my-open — the same shapes the React guard
		// at handler.go refuses — never had a landing page here either. The old serveList fell
		// through to a `default: http.NotFound` after a long switch; running the templated
		// walk against an invalid query only to reach that default is wasted work. Refuse up
		// front, same way the React side does, and the two routes stay in lockstep.
		http.NotFound(w, r)
		return
	}
	prWant, stage := q.Get("prs"), q.Get("stage")
	for _, c := range p.Pipeline.Counts {
		p.ListLinks = append(p.ListLinks, listLink{Label: c.Abbr + " · " + c.Name, URL: "/list?stage=" + c.Name, Count: c.Count, Current: c.Name == stage})
	}
	for _, k := range []struct{ key, label string }{{"opened", "Opened"}, {"open", "Open"}, {"merged", "Merged"}, {"closed", "Closed"}} {
		n := 0
		for _, pr := range p.Pipeline.All {
			if prMatches(pr, k.key) {
				n++
			}
		}
		p.ListLinks = append(p.ListLinks, listLink{Label: k.label, URL: "/list?prs=" + k.key, Count: n, Current: k.key == prWant})
	}
	switch {
	case prWant != "":
		// listQueryIsValid already said prWant is one of the five kinds, so the ListTitle
		// lookup below is guaranteed non-empty. Kept the map local to serveList so a change
		// to the user-facing titles stays here.
		for _, pr := range p.Pipeline.All {
			if prMatches(pr, prWant) {
				p.ListPRs = append(p.ListPRs, pr)
			}
		}
		p.ListTitle = map[string]string{"opened": "Pull requests you opened", "open": "Your open pull requests",
			"merged": "Your merged pull requests", "closed": "Your pull requests closed without merging",
			"decided": "Your merged and closed pull requests"}[prWant]
		p.ListSub = "In tracked repositories, newest first."
		p.ListEmpty = "None yet."
	case stage != "":
		known := false
		for _, c := range p.Pipeline.Counts {
			known = known || c.Name == stage
		}
		if !known {
			// Pipeline stages are runtime config, so this is the one shape listQueryIsValid
			// cannot validate — it passes anything non-empty through. The templated page has
			// the pipeline struct in hand here, so it can still 404 an unknown stage. The
			// React guard trusts the client to render "Not a stage" against the same data.
			http.NotFound(w, r)
			return
		}
		for _, rw := range p.Rows {
			if rw.InPipeline && rw.Stage == stage {
				p.ListRepos = append(p.ListRepos, rw)
			}
		}
		p.ListTitle = "Repositories at " + stage
		p.ListSub = "Where your pipeline command says each repository is now."
		p.ListEmpty = "No repository is at this stage."
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := tmpl.ExecuteTemplate(w, "listpage", p); err != nil {
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
