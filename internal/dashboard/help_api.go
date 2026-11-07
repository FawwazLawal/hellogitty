package dashboard

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/FawwazLawal/hellogitty/internal/help"
)

// HelpAPI backs the React /help page.
//
// WHY AN ENDPOINT FOR WHAT LOOKS LIKE PROSE. The static parts of this page
// — Title, Intro, Sections — look like markdown that the client could
// render on its own. They're not: `help.Render` rewrites every link in the
// guide through `guideLinks`, which maps `screenshot.png` to the
// server-served PNG at /help/screenshot.png, `../README.md` to the
// project's README on GitHub, and bare paths to `docs/` on `main`. Those
// rewrites are server knowledge (where the project URL lives, where the
// screenshot is served), and duplicating them in TypeScript would create
// two places for a renamed file to drift.
//
// The live parts — Glossary (depends on pipeline.State), About (depends
// on telemetry, notification state, version) — carry per-item `known`
// where it matters, same convention as every other migrated page.
type HelpAPI struct {
	Title     string        `json:"title"`
	Intro     string        `json:"intro"`
	IntroText string        `json:"introText"`
	Sections  []HelpSection `json:"sections"`
	Glossary  []HelpTerm    `json:"glossary"`
	About     []AboutRow    `json:"about"`
	AIPrompt  string        `json:"aiPrompt"`
}

// HelpSection is one section of the guide. `HTML` is trusted output of
// `help.Render` — a goldmarkdown renderer with a fixed set of extensions
// and the same link rewriter the templated page already uses — so the
// client renders it with dangerouslySetInnerHTML. If `help.Render` ever
// starts letting user input in, that trust decision moves with it.
type HelpSection struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Text  string `json:"text"`
	HTML  string `json:"html"`
}

type HelpTerm struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Kind   string `json:"kind"`
	Means  string `json:"means"`
	Do     string `json:"do,omitempty"`
	Search string `json:"search"`
}

// AboutRow carries one line of "About this install". `Known` separates a
// real value from a placeholder like "Not checked yet": the two were the
// same string in the templated page, which worked because nothing read
// them except humans, and would stop working the moment a client wanted
// to render an em-dash for one and italics for the other. The client
// renders unknown values as em-dashes, matching the alert-page convention.
type AboutRow struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	URL   string `json:"url,omitempty"`
	Known bool   `json:"known"`
}

func (h *Handler) serveHelpAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	pst, _ := h.Source.Pipeline()
	doc := help.Render(h.Guide, guideLinks)

	api := HelpAPI{
		Title:     doc.Title,
		Intro:     doc.Intro,
		IntroText: strings.ToLower(doc.Title),
	}
	for _, s := range doc.Sections {
		api.Sections = append(api.Sections, HelpSection{
			ID: s.ID, Title: s.Title, Text: s.Text, HTML: s.HTML,
		})
	}
	for id, t := range terms(pst) {
		k := kindOf(id)
		slug := strings.NewReplacer(":", "-", " ", "-").Replace(strings.ToLower(id))
		api.Glossary = append(api.Glossary, HelpTerm{
			ID: slug, Label: t.Label, Kind: k, Means: t.Means, Do: t.Do,
			Search: strings.ToLower(t.Label + " " + k + " " + t.Means + " " + t.Do),
		})
	}
	sort.Slice(api.Glossary, func(i, j int) bool {
		a, b := strings.ToLower(api.Glossary[i].Label), strings.ToLower(api.Glossary[j].Label)
		if a != b {
			return a < b
		}
		return api.Glossary[i].Kind < api.Glossary[j].Kind
	})

	api.About = h.aboutAPI()
	// aiPrompt expects []AboutItem rather than the API's []AboutRow. Same
	// values either way, so convert in place rather than duplicate the
	// prompt builder.
	items := make([]AboutItem, 0, len(api.About))
	for _, r := range api.About {
		items = append(items, AboutItem{Key: r.Key, Value: r.Value, URL: r.URL})
	}
	api.AIPrompt = aiPrompt(items)

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(api)
}

// aboutAPI mirrors (*Handler).about but tags each row with `Known`, so the
// client can render "Not checked yet" / "Not available" as em-dashes
// rather than reading them as real values. The row text stays the
// server's, in case the client wants it in a tooltip.
func (h *Handler) aboutAPI() []AboutRow {
	out := []AboutRow{{Key: "Version", Value: h.Version, Known: true}}
	for _, a := range h.About {
		out = append(out, AboutRow{Key: a.Key, Value: a.Value, URL: a.URL, Known: true})
	}
	tel := h.Source.Telemetry()
	if !tel.LastPoll.IsZero() {
		out = append(out, AboutRow{
			Key:   "Last check",
			Value: tel.LastPoll.UTC().Format("2006-01-02 15:04 UTC"),
			Known: true,
		})
	} else {
		out = append(out, AboutRow{Key: "Last check", Value: "Not checked yet", Known: false})
	}
	if tel.RateLimit > 0 {
		out = append(out, AboutRow{
			Key: "GitHub API this hour",
			Value: strconv.Itoa(tel.RateLimit-tel.RateRemaining) + " of " +
				strconv.Itoa(tel.RateLimit) + " calls",
			Known: true,
		})
	} else {
		out = append(out, AboutRow{Key: "GitHub API this hour", Value: "Not reported yet", Known: false})
	}

	var notesValue string
	notesKnown := false
	if ns, ok := h.Source.(NotificationSource); ok {
		v := ns.Notifications()
		switch v.State {
		case "ok":
			notesValue = "Readable: new-activity dots are on"
			notesKnown = true
		case "off":
			notesValue = "Off: " + v.Note
			notesKnown = true
		default:
			notesValue = "Not checked yet"
		}
	} else {
		notesValue = "Not available in this build"
		// "Not available" is a real answer, not an unknown — this build
		// never has notifications, and saying "unknown" would imply a
		// different one might. So it reads as known.
		notesKnown = true
	}
	out = append(out, AboutRow{Key: "Notifications", Value: notesValue, Known: notesKnown})

	out = append(out,
		AboutRow{Key: "Your data", Value: "Stays on this computer; HelloGitty only reads from GitHub, except marking a notification read when you press Ack", Known: true},
		AboutRow{Key: "Install and settings", Value: "README on GitHub", URL: projectURL + "#readme", Known: true},
		AboutRow{Key: "What changed", Value: "Changelog", URL: projectURL + "/blob/main/CHANGELOG.md", Known: true},
		AboutRow{Key: "Report a problem", Value: "Open an issue (include the version above, never your token)", URL: issuesURL, Known: true},
	)
	return out
}
