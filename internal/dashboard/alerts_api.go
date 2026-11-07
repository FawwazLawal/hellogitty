package dashboard

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// AlertsAPI backs every page under /alerts/*.
//
// WHY ONE DOCUMENT AND NOT TEN. The ten templated alert pages all derive from
// the same `h.build()` snapshot: a user opening three of them in sequence has
// the server rebuild the view-model three times, for state that moved on one
// cadence. One endpoint pays for one rebuild; the React side caches it once
// and every page reads from the same object. Ten endpoints would also be ten
// places for the per-section `known` flag to leak back to zero, which is the
// lie this port exists to stop.
//
// SECTIONED, NOT FLATTENED. Four independent subsystems feed these pages — the
// work refresh (your-move), the watch feed (watched-claimed, watched-closed),
// the pipeline tool (repo-flagged, stage-failed) and the GitHub API meter
// (api-low), with the poller sitting under data-stale. Each one can be
// unknown while the others are known; conflating them into a top-level
// `known` would re-introduce the "some of this is zero because nothing has
// run yet" ambiguity the templates have today. Each slice carries its own
// known flag, and the UI renders a THIRD state for not-yet-fetched that
// never falls through to "all clear".

// AlertsLabels forwards the pipeline tool's custom column labels.
//
// Repo-flagged and stage-failed let the pipeline name what "flagged" and
// "failed" mean in its own words. The templates thread these through as
// `.Labels.Flagged` and `.Labels.Failed`; the API carries them so the React
// pages don't re-invent vocabulary.
type AlertsLabels struct {
	Flagged string `json:"flagged"`
	Failed  string `json:"failed"`
}

type AlertsTotals struct {
	RepoCount   int `json:"repoCount"`
	TargetCount int `json:"targetCount"`
}

// AlertItem is one item across the three your-move sub-sections.
//
// It intentionally mirrors WorkItem's shape rather than WorkRow's. The alert
// pages read a subset — the status-with-notes, the quote, no labels — and
// repeating that subset here is cheaper than widening the general work shape
// and remembering which pages ignore which fields.
type AlertItem struct {
	Kind     string      `json:"kind"`
	Repo     string      `json:"repo"`
	Number   int         `json:"number"`
	Title    string      `json:"title"`
	URL      string      `json:"url"`
	Why      string      `json:"why,omitempty"`
	Status   string      `json:"status,omitempty"`
	Level    string      `json:"level,omitempty"`
	Ago      string      `json:"ago,omitempty"`
	AgoTitle string      `json:"agoTitle,omitempty"`
	Notes    []AlertNote `json:"notes"`
	Quote    string      `json:"quote,omitempty"`
	QuoteBy  string      `json:"quoteBy,omitempty"`
}

type AlertNote struct {
	Text  string `json:"text"`
	Level string `json:"level,omitempty"`
}

type AlertWork struct {
	Known    bool        `json:"known"`
	Partial  bool        `json:"partial"`
	YourMove int         `json:"yourMove"`
	You      []AlertItem `json:"you"`
	InYou    []AlertItem `json:"inYou"`
	ConvYou  []AlertItem `json:"convYou"`
}

type WatchItem struct {
	Repo        string `json:"repo"`
	Number      int    `json:"number"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	// Status is the server's vocabulary — "CLAIMED", "CLOSED_FIXED",
	// "CLOSED_WONT" — not translated. The React table should disagree about
	// colour, never about what state a thing is in.
	Status      string `json:"status,omitempty"`
	ClaimDetail string `json:"claimDetail,omitempty"`
	ChangedAt   string `json:"changedAt,omitempty"`
}

type AlertWatch struct {
	// Known on the watch feed is distinct from Known on work or pipeline; a
	// user may have never watched anything, which is different from the feed
	// having never fetched. Today the templates read `len .ClaimedWatch` and
	// render 0 for both. The flag is false until the watch refresh has
	// completed at least once.
	Known   bool        `json:"known"`
	Total   int         `json:"total"`
	Claimed []WatchItem `json:"claimed"`
	Closed  []WatchItem `json:"closed"`
}

type AlertFailedRepo struct {
	Name  string `json:"name"`
	Error string `json:"error"`
}

type AlertChecks struct {
	// Known is tied to the poller — a failed check cannot be reported before
	// the first poll runs. Rendering `0 failed checks` with no poll behind it
	// is the archetypal unknown-as-zero bug.
	Known  bool              `json:"known"`
	Failed []AlertFailedRepo `json:"failed"`
}

type HealthItem struct {
	Owner  string `json:"owner"`
	Name   string `json:"name"`
	URL    string `json:"url"`
	Health string `json:"health"`
	// Polled says whether this repository has ever been polled successfully.
	//
	// It matters because when it is false, Open/GFI are zero because nobody
	// looked — not because nothing is open. The /repos projection introduced
	// the same field for the same reason; this is the same check in a
	// different projection. The DORMANT/SLOW filters this page runs happen
	// to drop never-polled repos (their Health is UNKNOWN, by
	// store.HealthLabel), so the row list is already honest. But the field
	// is here so a future stat that counts "checked" repositories cannot
	// quietly count never-polled as checked-and-fine, and so a client can
	// render per-row counts as em-dashes if ever shown off-filter.
	Polled bool `json:"polled"`
	Open   int  `json:"open"`
	GFI    int  `json:"gfi"`
	// AgeKnown and AgeDays survive from dashboard.json's Repo shape; same
	// reasoning. A repository we have not yet looked at has no "last commit"
	// to show.
	AgeKnown bool `json:"ageKnown"`
	AgeDays  int  `json:"ageDays"`
}

type AlertHealth struct {
	// Known is "the repo list has been built", which happens as soon as the
	// config loads. Once true, rendering an empty list means "no dormant or
	// slow repos", which is a real answer.
	Known bool         `json:"known"`
	Items []HealthItem `json:"items"`
}

type ThreadItem struct {
	Path     string `json:"path"`
	Author   string `json:"author"`
	Bot      bool   `json:"bot"`
	At       string `json:"at"`
	Outdated bool   `json:"outdated"`
	Body     string `json:"body"`
	URL      string `json:"url,omitempty"`
}

type UnresolvedPR struct {
	Repo    string       `json:"repo"`
	Number  int          `json:"number"`
	Title   string       `json:"title"`
	URL     string       `json:"url"`
	Threads []ThreadItem `json:"threads"`
}

type AlertThreads struct {
	// Thread discovery runs with the work refresh — same fetch cost, same
	// Known flag. Templates inherit `Work.Known` implicitly; this surfaces it.
	Known bool           `json:"known"`
	Items []UnresolvedPR `json:"items"`
}

type Phase struct {
	Name  string `json:"name"`
	Abbr  string `json:"abbr"`
	State string `json:"state"`
}

type PipeFlagged struct {
	Owner string `json:"owner"`
	Name  string `json:"name"`
	URL   string `json:"url"`
	Stage string `json:"stage,omitempty"`
	Label string `json:"label,omitempty"`
}

type PipeFailed struct {
	Owner  string  `json:"owner"`
	Name   string  `json:"name"`
	URL    string  `json:"url"`
	Label  string  `json:"label,omitempty"`
	Phases []Phase `json:"phases"`
}

type AlertPipeline struct {
	// Known comes from the pipeline tool's own cycle; already modelled on
	// page.Pipeline.Known and promoted here so the per-page port can read it.
	Known   bool          `json:"known"`
	Flagged []PipeFlagged `json:"flagged"`
	Failed  []PipeFailed  `json:"failed"`
}

type AlertPoll struct {
	// Known is `LastPollUnix > 0`. The data-stale page already keys on this
	// implicitly; carrying it as a boolean makes the client branch obvious.
	Known           bool              `json:"known"`
	LastUTC         string            `json:"lastUtc,omitempty"`
	NextUTC         string            `json:"nextUtc,omitempty"`
	IntervalSeconds int               `json:"intervalSeconds"`
	FailedRepos     []AlertFailedRepo `json:"failedRepos"`
}

type AlertAPI struct {
	// Known is whether GitHub has reported a quota yet — already modelled on
	// page.APIKnown and carried through.
	Known    bool   `json:"known"`
	Used     int    `json:"used"`
	Limit    int    `json:"limit"`
	Percent  int    `json:"percent"`
	ResetUTC string `json:"resetUtc,omitempty"`
}

// AlertsAPI is the document served at /app/api/alerts.json.
type AlertsAPI struct {
	GeneratedAt string       `json:"generatedAt"`
	Labels      AlertsLabels `json:"labels"`
	Totals      AlertsTotals `json:"totals"`

	Work     AlertWork     `json:"work"`
	Watch    AlertWatch    `json:"watch"`
	Checks   AlertChecks   `json:"checks"`
	Health   AlertHealth   `json:"health"`
	Threads  AlertThreads  `json:"threads"`
	Pipeline AlertPipeline `json:"pipeline"`
	Poll     AlertPoll     `json:"poll"`
	API      AlertAPI      `json:"api"`
}

func toAlertItems(rows []workRow) []AlertItem {
	out := make([]AlertItem, 0, len(rows))
	for _, w := range rows {
		notes := make([]AlertNote, 0, len(w.Notes))
		for _, n := range w.Notes {
			notes = append(notes, AlertNote{Text: n.Text, Level: n.Level})
		}
		out = append(out, AlertItem{
			Kind: w.Kind, Repo: w.Repo, Number: w.Number,
			Title: w.Title, URL: w.URL, Why: w.Why,
			Status: w.Status, Level: w.Level,
			Ago: w.Ago, AgoTitle: w.AgoTitle,
			Notes:   notes,
			Quote:   w.Quote,
			QuoteBy: w.QuoteBy,
		})
	}
	return out
}

func toWatchItems(rows []watchRow) []WatchItem {
	out := make([]WatchItem, 0, len(rows))
	for _, w := range rows {
		changed := ""
		if w.ChangedAt != nil {
			changed = w.ChangedAt.UTC().Format(time.RFC3339)
		}
		out = append(out, WatchItem{
			Repo: w.Repo, Number: w.Number, Title: w.Title, URL: w.URL,
			Status: w.Status, ClaimDetail: w.ClaimDetail, ChangedAt: changed,
		})
	}
	return out
}

// serveAlertsAPI writes the alert document as JSON.
func (h *Handler) serveAlertsAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, err := h.build()
	if err != nil {
		// A build failure is the server's problem, and the client has an
		// error state for it. Returning an empty 200 would render as "nothing
		// to worry about on any alert page", which is exactly the lie each
		// `known` flag below exists to prevent.
		http.Error(w, "alerts unavailable", http.StatusInternalServerError)
		return
	}

	// GeneratedAt follows serveDashboardAPI's reasoning: the epoch, formatted
	// as RFC 3339. Empty when no poll has completed, said honestly rather
	// than claiming 1970.
	generated := ""
	if p.LastPollUnix > 0 {
		generated = time.Unix(p.LastPollUnix, 0).UTC().Format(time.RFC3339)
	}

	doc := AlertsAPI{
		GeneratedAt: generated,
		Labels:      AlertsLabels{Flagged: p.Labels.Flagged, Failed: p.Labels.Failed},
		Totals:      AlertsTotals{RepoCount: p.RepoCount, TargetCount: p.TargetCount},
	}

	// Work slice — three sub-lists, whose distinction is the whole point of
	// your-move and so is preserved rather than merged.
	doc.Work = AlertWork{
		Known:    p.Work.Known,
		Partial:  p.Work.Partial,
		YourMove: len(p.Work.You) + len(p.Work.InYou) + len(p.Work.ConvYou),
		You:      toAlertItems(p.Work.You),
		InYou:    toAlertItems(p.Work.InYou),
		ConvYou:  toAlertItems(p.Work.ConvYou),
	}

	// Watch slice. Known is "the watch feed has fetched" — tied to Work.Known
	// since the same refresh populates it. The templates render 0 ClaimedWatch
	// as "no claimed issues", which reads as reassurance before a first fetch;
	// the React pages render the unknown branch instead.
	doc.Watch = AlertWatch{
		Known:   p.Work.Known,
		Total:   len(p.Watch),
		Claimed: toWatchItems(p.ClaimedWatch),
		Closed:  toWatchItems(p.ClosedWatch),
	}

	// Checks slice. Known is tied to the poller — failed checks are a product
	// of a poll, and reporting zero before one runs is reassurance from
	// ignorance.
	failed := make([]AlertFailedRepo, 0, len(p.FailedRepos))
	for _, fr := range p.FailedRepos {
		failed = append(failed, AlertFailedRepo{Name: fr.Name, Error: fr.Error})
	}
	doc.Checks = AlertChecks{
		Known:  p.LastPollUnix > 0,
		Failed: failed,
	}

	// Health slice. We send every tracked repository with its health label;
	// the client filters to DORMANT or SLOW. One payload backs both routes.
	healthItems := make([]HealthItem, 0, len(p.Rows))
	for _, r := range p.Rows {
		healthItems = append(healthItems, HealthItem{
			Owner: r.Owner, Name: r.Name, URL: r.URL,
			Health: r.Health,
			// Same rule as in serveDashboardAPI's Repo.Polled — a repo with
			// no successful poll is UNKNOWN per store.HealthLabel. One place
			// for the mapping would be nicer; one place per projection is
			// what the existing file does, so this matches that.
			Polled: r.Health != "UNKNOWN",
			Open:   r.Open, GFI: r.GFI,
			AgeKnown: r.AgeKnown, AgeDays: r.AgeDays,
		})
	}
	doc.Health = AlertHealth{
		Known: p.LastPollUnix > 0,
		Items: healthItems,
	}

	// Threads slice. The thread list is populated by the work refresh, so its
	// Known tracks Work.Known. An unknown `len .UnresolvedPRs == 0` is the
	// difference between "no threads need answering" and "we haven't looked",
	// and the page used to conflate them.
	threads := make([]UnresolvedPR, 0, len(p.UnresolvedPRs))
	for _, u := range p.UnresolvedPRs {
		tItems := make([]ThreadItem, 0, len(u.Threads))
		for _, t := range u.Threads {
			tItems = append(tItems, ThreadItem{
				Path: t.Path, Author: t.Author, Bot: t.Bot,
				At: t.At.UTC().Format(time.RFC3339), Outdated: t.Outdated,
				Body: t.Body, URL: t.URL,
			})
		}
		threads = append(threads, UnresolvedPR{
			Repo: u.Repo, Number: u.Number, Title: u.Title, URL: u.URL,
			Threads: tItems,
		})
	}
	doc.Threads = AlertThreads{
		Known: p.Work.Known,
		Items: threads,
	}

	// Pipeline slice. flagged and failed are two rows[] on the page; keep the
	// split rather than merging into one with a flag — the alert pages key on
	// which list they read, not on a per-item predicate.
	flaggedRows := make([]PipeFlagged, 0, len(p.FlaggedPipeline))
	for _, r := range p.FlaggedPipeline {
		flaggedRows = append(flaggedRows, PipeFlagged{
			Owner: r.Owner, Name: r.Name, URL: r.URL,
			Stage: r.Stage, Label: r.Label,
		})
	}
	failedRows := make([]PipeFailed, 0, len(p.FailedPipeline))
	for _, r := range p.FailedPipeline {
		phases := make([]Phase, 0, len(r.Phases))
		for _, ph := range r.Phases {
			phases = append(phases, Phase{Name: ph.Name, Abbr: ph.Abbr, State: ph.State})
		}
		failedRows = append(failedRows, PipeFailed{
			Owner: r.Owner, Name: r.Name, URL: r.URL,
			Label: r.Label, Phases: phases,
		})
	}
	doc.Pipeline = AlertPipeline{
		Known:   p.Pipeline.Known,
		Flagged: flaggedRows,
		Failed:  failedRows,
	}

	// Poll slice, backs the data-stale page. IntervalSeconds mirrors the
	// template's "every Xs" wording; a zero means "not configured", the same
	// as the template's `if .PollInterval` branch — the client takes that as
	// its unknown branch for the interval specifically.
	pollFailed := make([]AlertFailedRepo, 0, len(p.FailedRepos))
	for _, fr := range p.FailedRepos {
		pollFailed = append(pollFailed, AlertFailedRepo{Name: fr.Name, Error: fr.Error})
	}
	doc.Poll = AlertPoll{
		Known:           p.LastPollUnix > 0,
		LastUTC:         p.LastPollUTC,
		NextUTC:         p.NextPollUTC,
		IntervalSeconds: p.PollInterval,
		FailedRepos:     pollFailed,
	}

	// API slice. Known is p.APIKnown already — kept honest.
	doc.API = AlertAPI{
		Known: p.APIKnown, Used: p.APIUsed, Limit: p.APILimit,
		Percent: p.APIPct, ResetUTC: p.APIResetUTC,
	}

	// Content-type and no-store, same as the other /app/api/* endpoints.
	// These figures move on every poll; caching them would quietly stop the
	// alert pages from updating, which is the failure hardest to spot.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(doc)
}

// alertsReactPaths is the set of /alerts/* paths the React shell owns when
// ReactIsDefault is true. Kept in one place so the route table in handler.go
// can ask "is this a React alert path" once rather than listing eleven cases
// twice (once to serve the shell, once to carry the legacy equivalent).
var alertsReactPaths = map[string]bool{
	"/alerts/your-move":          true,
	"/alerts/watched-claimed":    true,
	"/alerts/watched-closed":     true,
	"/alerts/check-failed":       true,
	"/alerts/repo-dormant":       true,
	"/alerts/repo-slow":          true,
	"/alerts/unresolved-threads": true,
	"/alerts/data-stale":         true,
	"/alerts/repo-flagged":       true,
	"/alerts/stage-failed":       true,
	"/alerts/api-low":            true,
}

// isAlertsReactPath is a tiny helper so the route switch stays flat.
func isAlertsReactPath(p string) bool { return alertsReactPaths[p] }

// legacyAlertName returns the alert key for /legacy/alerts/<name>, or "".
func legacyAlertName(p string) string {
	const prefix = "/legacy/alerts/"
	if strings.HasPrefix(p, prefix) {
		return p[len(prefix):]
	}
	return ""
}
