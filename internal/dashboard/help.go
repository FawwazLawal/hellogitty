package dashboard

import (
	"html/template"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/FawwazLawal/hellogitty/internal/help"
)

// AboutItem is one line of "About this install" on the Help page.
type AboutItem struct {
	Key, Value, URL string
}

// Where the public project lives, for links out of the Help page.
const (
	projectURL = "https://github.com/FawwazLawal/hellogitty"
	issuesURL  = projectURL + "/issues/new"
)

type helpSection struct {
	ID, Title, Text string
	HTML            template.HTML
}

type helpTerm struct {
	ID, Label, Kind, Means, Do, Search string
}

type helpPage struct {
	headerInfo
	Title     string
	Intro     template.HTML
	IntroText string
	Sections  []helpSection
	Glossary  []helpTerm
	About     []AboutItem
	AIPrompt  string
}

// guideLinks points the guide's links where they work from inside the app: its screenshot to the
// copy served here, other files to their page in the project on GitHub, anchors unchanged.
func guideLinks(target string) string {
	switch {
	case strings.HasPrefix(target, "#"), strings.HasPrefix(target, "http"):
		return target
	case target == "screenshot.png":
		return "/help/screenshot.png"
	case target == "../README.md":
		return projectURL + "#readme"
	case strings.HasPrefix(target, "../"):
		return projectURL + "/blob/main/" + strings.TrimPrefix(target, "../")
	}
	return projectURL + "/blob/main/docs/" + target
}

// kindOf says where on the page a glossary term lives, from its id.
func kindOf(id string) string {
	for prefix, kind := range map[string]string{
		"group-": "Your work section", "cell-": "Alert cell", "col-": "Tracked repositories column",
		"health-": "Health light", "watch-": "Watched issue status", "stage-": "Pipeline stage", "p:": "From your pipeline",
		"checks-": "Note chip", "ci-": "Note chip", "merge-": "Note chip", "behind": "Note chip", "threads": "Note chip", "assigned": "Note chip",
	} {
		if strings.HasPrefix(id, prefix) {
			return kind
		}
	}
	return "Dashboard"
}

func (h *Handler) serveHelp(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.New("index").Funcs(funcs).Parse(h.Template)
	if err == nil {
		_, err = tmpl.New("help").Parse(h.HelpTemplate)
	}
	if err != nil {
		log.Printf("dashboard: parse help template: %v", err)
		http.Error(w, "help template error", http.StatusInternalServerError)
		return
	}
	pst, _ := h.Source.Pipeline()
	doc := help.Render(h.Guide, guideLinks)
	p := helpPage{headerInfo: h.buildHeaderInfo(), Title: doc.Title, Intro: template.HTML(doc.Intro),
		IntroText: strings.ToLower(doc.Title)}
	for _, s := range doc.Sections {
		p.Sections = append(p.Sections, helpSection{ID: s.ID, Title: s.Title, Text: s.Text, HTML: template.HTML(s.HTML)})
	}
	for id, t := range terms(pst) {
		k := kindOf(id)
		slug := strings.NewReplacer(":", "-", " ", "-").Replace(strings.ToLower(id))
		p.Glossary = append(p.Glossary, helpTerm{ID: slug, Label: t.Label, Kind: k, Means: t.Means, Do: t.Do,
			Search: strings.ToLower(t.Label + " " + k + " " + t.Means + " " + t.Do)})
	}
	sort.Slice(p.Glossary, func(i, j int) bool {
		a, b := strings.ToLower(p.Glossary[i].Label), strings.ToLower(p.Glossary[j].Label)
		if a != b {
			return a < b
		}
		return p.Glossary[i].Kind < p.Glossary[j].Kind
	})
	p.About = h.about()
	p.AIPrompt = aiPrompt(p.About)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := tmpl.ExecuteTemplate(w, "help", p); err != nil {
		log.Printf("dashboard: render help: %v", err)
	}
}

// about lists what someone helping you would ask first: the version, the files in use, whether the
// token can read notifications, and where to get help. Never the token itself.
func (h *Handler) about() []AboutItem {
	out := []AboutItem{{Key: "Version", Value: h.Version}}
	out = append(out, h.About...)
	tel := h.Source.Telemetry()
	if !tel.LastPoll.IsZero() {
		out = append(out, AboutItem{Key: "Last check", Value: tel.LastPoll.UTC().Format("2006-01-02 15:04 UTC")})
	}
	if tel.RateLimit > 0 {
		out = append(out, AboutItem{Key: "GitHub API this hour", Value: strconv.Itoa(tel.RateLimit-tel.RateRemaining) + " of " + strconv.Itoa(tel.RateLimit) + " calls"})
	}
	notes := "Not checked yet"
	if ns, ok := h.Source.(NotificationSource); ok {
		switch v := ns.Notifications(); v.State {
		case "ok":
			notes = "Readable: new-activity dots are on"
		case "off":
			notes = "Off: " + v.Note
		}
	} else {
		notes = "Not available in this build"
	}
	out = append(out, AboutItem{Key: "Notifications", Value: notes},
		AboutItem{Key: "Your data", Value: "Stays on this computer; HelloGitty only reads from GitHub, except marking a notification read when you press Ack"},
		AboutItem{Key: "Install and settings", Value: "README on GitHub", URL: projectURL + "#readme"},
		AboutItem{Key: "What changed", Value: "Changelog", URL: projectURL + "/blob/main/CHANGELOG.md"},
		AboutItem{Key: "Report a problem", Value: "Open an issue (include the version above, never your token)", URL: issuesURL})
	return out
}
