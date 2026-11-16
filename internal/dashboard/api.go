package dashboard

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// The JSON API the React application reads.
//
// ADR-UI-002 §4 is specific about how to arrive here: "Do not assume a full
// JSON API exists: inspect the Go routing and template handlers, inventory data
// dependencies, then add minimal typed endpoints if the migration actually
// requires them." This is that minimum — the figures one vertical slice needs,
// and nothing else.
//
// WHY A PROJECTION RATHER THAN THE VIEW MODEL. The obvious shortcut is to
// marshal the internal `page` struct, which already holds everything. It is the
// wrong move twice over. It carries `Token`, the value sent back with
// acknowledgements, which has no business in a read-only document. It carries
// template.JS fields that mean nothing outside html/template. And it is shaped
// by what the template needed on the day each field was added, so publishing it
// would freeze those accidents into a contract the frontend then depends on.
//
// §4 also sets the trust boundary: "The React UI does not directly own GitHub
// secrets, filesystem operations, backend persistence or privileged API calls."
// So this is GET-only, derived from the snapshot the server already holds, and
// it exposes no credential, no path and no write.

// KPI is one figure in the stat rail.
//
// `Known` is the field that makes the difference between a real zero and an
// absent one. The dashboard polls GitHub on an interval, so before the first
// poll completes every count is genuinely unknown — and a UI that renders
// unknown as 0 tells the viewer there is nothing waiting for them, which is a
// lie with consequences. The existing template already models this as
// RailKnown/APIKnown; the API keeps it rather than flattening it.
type KPI struct {
	ID       string `json:"id"`
	Value    int    `json:"value"`
	Label    string `json:"label"`
	Sublabel string `json:"sublabel"`
	Known    bool   `json:"known"`
}

// Stage is one cell in a repository's pipeline strip.
//
// `State` is the Go side's own vocabulary rather than a re-coded enum. The
// template and the React table should disagree about colour, never about what
// state a thing is in, and translating here would create a second place for
// that vocabulary to drift.
type Stage struct {
	Abbr  string `json:"abbr"`
	Name  string `json:"name"`
	State string `json:"state"`
}

// Repo is one row of the tracked repositories table.
type Repo struct {
	Owner  string  `json:"owner"`
	Name   string  `json:"name"`
	URL    string  `json:"url"`
	Health string  `json:"health"`
	Stages []Stage `json:"stages"`
	Gate   string  `json:"gate"`

	// Polled says whether this repository has EVER been polled successfully.
	//
	// It matters because when it is false, Open/GoodFirst/Unassigned are all
	// zero — and those zeros are absences, not counts. A card rendering them
	// as "0 open, 0 good first, 0 unassigned" tells the reader this repository
	// needs nothing from them, about a repository nobody has ever looked at.
	//
	// The rule lives in store.HealthLabel: a repo with no successful poll is
	// UNKNOWN rather than defaulting to ACTIVE. This field exists so the UI
	// does not have to infer "the counts are meaningless" from a health label,
	// which is an inference that would keep working right up until the
	// vocabulary changed.
	Polled bool `json:"polled"`

	// InPipeline and Stage are the program's own view of this repository: is
	// it a pipeline target, and which stage is it at. Derivable from Stages
	// only by guessing which state word means "here", so they are sent rather
	// than inferred — the guess would be invisible when it went wrong.
	InPipeline bool   `json:"inPipeline"`
	Stage      string `json:"stage,omitempty"`

	Open       int `json:"open"`
	GoodFirst  int `json:"goodFirst"`
	Unassigned int `json:"unassigned"`
	Watching   int `json:"watching"`
	TurnedDown int `json:"turnedDown"`
	NewCount   int `json:"newCount"`

	// AgeKnown separates "committed today" from "we have not looked". Same
	// reasoning as KPI.Known: a zero that means absence, rendered as a zero
	// that means freshness, is a quiet lie.
	AgeKnown bool `json:"ageKnown"`
	AgeDays  int  `json:"ageDays"`

	// Error is GitHub's complaint about this repository, if any. The row still
	// renders — a repository that failed to poll is information, not a gap.
	Error string `json:"error,omitempty"`
}

// StageCount is one column of the pipeline rail.
type StageCount struct {
	Abbr  string `json:"abbr"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Pipeline is the pipeline rail.
//
// `Rate` arrives as the server's own formatted string rather than a number.
// It is computed as merged / (merged + closed), deliberately excluding open
// pull requests, and the panel prints a note saying so. Sending the ratio for
// the client to format would put that definition in two places, and the
// definition is the part that is easy to get subtly wrong.
type Pipeline struct {
	Counts []StageCount `json:"counts"`
	Opened int          `json:"opened"`
	Open   int          `json:"open"`
	Merged int          `json:"merged"`
	Closed int          `json:"closed"`
	Rate   string       `json:"rate"`
	// Known separates "no pull requests moved" from "the pipeline has not run".
	Known bool   `json:"known"`
	Error string `json:"error,omitempty"`
}

// WorkItem is one row of the "your work" rail.
type WorkItem struct {
	Key    string `json:"key"`
	Kind   string `json:"kind"`
	Repo   string `json:"repo"`
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	// Why it is on the board at all: "You opened it", "Assigned to you".
	Why string `json:"why"`
	// Ago is the server's phrasing ("3 days"), with the exact instant beside
	// it so the client can show one and title the other without reformatting.
	Ago      string `json:"ago"`
	AgoTitle string `json:"agoTitle"`
	// Level is the server's severity word: "caution", "ok" or empty.
	Level string `json:"level"`
	// YourMove is whether this is waiting on the owner rather than on someone
	// else. The rail's whole purpose is that distinction.
	YourMove bool   `json:"yourMove"`
	Status   string `json:"status"`
}

// Work is the "your work" rail.
type Work struct {
	// Known is false before the first work refresh; Partial is true when the
	// refresh failed halfway and the list is new but incomplete. The two are
	// different and the panel should say so differently — "not fetched yet" is
	// not "here is some of it".
	Known   bool       `json:"known"`
	Partial bool       `json:"partial"`
	Login   string     `json:"login"`
	NeedYou int        `json:"needYou"`
	Total   int        `json:"total"`
	Items   []WorkItem `json:"items"`
	Error   string     `json:"error,omitempty"`
}

// Conversations counts threads joined but not opened by the owner.
type Conversations struct {
	Known bool `json:"known"`
	// Quiet is waiting on someone else; NeedYou is waiting on the owner.
	Quiet   int `json:"quiet"`
	NeedYou int `json:"needYou"`
	Total   int `json:"total"`
}

// WatchItem (defined in alerts_api.go) is reused as the row type here. The
// alerts page carries a pre-filtered subset (claimed / closed only), the
// dashboard's Watched panel carries all watched items, and both share one
// shape so the React side has a single row component to render.

// DashboardAPI is the document served at /app/api/dashboard.json.
type DashboardAPI struct {
	// GeneratedAt is when the snapshot this is derived from was written, in
	// RFC 3339. Not the time of the request: the client needs to know how stale
	// the figures are, and a server timestamp would always look fresh.
	GeneratedAt string `json:"generatedAt"`
	Version     string `json:"version"`
	KPIs        []KPI  `json:"kpis"`
	Repos       []Repo `json:"repos"`
	// StageHeads is the column order for the pipeline strip, from the server,
	// so the table cannot drift out of step with the stages the rows carry.
	StageHeads []Stage `json:"stageHeads"`
	RepoTotals struct {
		NewCount  int `json:"newCount"`
		RepoCount int `json:"repoCount"`
	} `json:"repoTotals"`
	Pipeline      Pipeline      `json:"pipeline"`
	Work          Work          `json:"work"`
	Conversations Conversations `json:"conversations"`
	// Watched is the Watched panel's rows: issues and PRs the owner has flagged
	// with the eye, plus ones the backend attached because something changed
	// state on them. Empty when nothing is watched. Not gated on `known` —
	// the list is an accumulating set, not a periodic refresh, so there is no
	// "before the first fetch" condition to signal.
	Watched []WatchItem `json:"watched"`
}

// serveDashboardAPI writes the KPI slice as JSON.
func (h *Handler) serveDashboardAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, err := h.build()
	if err != nil {
		// A build failure is the server's problem, and the client has a real
		// error state for it. Returning an empty 200 would render as "nothing
		// needs you", which is the same lie as rendering unknown as zero.
		http.Error(w, "dashboard unavailable", http.StatusInternalServerError)
		return
	}

	// LastPollUnix, not LastPollUTC. The latter is what the template prints in
	// the footer and is a time of day — "00:44:56Z", no date — which a client
	// cannot compute staleness from, and which silently reads as "today" across
	// a midnight boundary. The epoch field is the one that carries a full
	// instant, and RFC 3339 is what the frontend's schema expects.
	//
	// Zero means no poll has completed, and an empty string says that honestly
	// rather than claiming 1970.
	generated := ""
	if p.LastPollUnix > 0 {
		generated = time.Unix(p.LastPollUnix, 0).UTC().Format(time.RFC3339)
	}

	doc := DashboardAPI{
		GeneratedAt: generated,
		Version:     p.Version,
		KPIs: []KPI{
			{ID: "needs", Value: p.RailNeedsYou, Label: "Needs you", Known: p.RailKnown},
			{ID: "prs", Value: p.RailOpenPRs, Label: "Open PRs", Sublabel: "non-draft, state OPEN", Known: p.RailKnown},
			{ID: "repos", Value: p.RepoCount, Label: "Repos", Known: true},
			{ID: "api", Value: p.APIRemaining, Label: "API left", Known: p.APIKnown},
		},
	}
	if p.APIKnown {
		doc.KPIs[3].Sublabel = "of " + itoa(p.APILimit) + " this hour"
	}

	// Empty collections marshal as [] rather than null.
	//
	// A nil slice encodes as JSON null, and a client writing the obvious
	// `doc.stageHeads.map(...)` then crashes on a dashboard that simply has no
	// pipeline configured. Emitting [] makes "none" and "some" the same shape,
	// so the absent case needs no special handling and cannot be forgotten.
	doc.Repos = []Repo{}
	doc.StageHeads = []Stage{}

	for _, h := range p.Stages {
		doc.StageHeads = append(doc.StageHeads, Stage{Abbr: h.Abbr, Name: h.Name})
	}
	for _, r := range p.Rows {
		rep := Repo{
			Owner: r.Owner, Name: r.Name, URL: r.URL, Health: r.Health,
			Gate:       r.Label,
			Polled:     r.Health != "UNKNOWN",
			InPipeline: r.InPipeline,
			Stage:      r.Stage,
			Open:       r.Open,
			GoodFirst:  r.GFI,
			Unassigned: r.Unassigned,
			Watching:   len(r.Watch),
			TurnedDown: r.DeniedTotal,
			NewCount:   r.NewCount,
			AgeKnown:   r.AgeKnown,
			AgeDays:    r.AgeDays,
			Error:      r.Error,
		}
		rep.Stages = []Stage{}
		for _, ph := range r.Phases {
			rep.Stages = append(rep.Stages, Stage{Abbr: ph.Abbr, Name: ph.Name, State: ph.State})
		}
		doc.Repos = append(doc.Repos, rep)
		doc.RepoTotals.NewCount += r.NewCount
	}
	doc.RepoTotals.RepoCount = len(p.Rows)

	// Pipeline.
	doc.Pipeline = Pipeline{
		Counts: []StageCount{},
		Opened: p.Pipeline.Opened,
		Open:   p.Pipeline.Open,
		Merged: p.Pipeline.Merged,
		Closed: p.Pipeline.Closed,
		Rate:   p.Pipeline.Rate,
		Known:  p.Pipeline.Known,
		Error:  p.Pipeline.Err,
	}
	for _, c := range p.Pipeline.Counts {
		doc.Pipeline.Counts = append(doc.Pipeline.Counts, StageCount{Abbr: c.Abbr, Name: c.Name, Count: c.Count})
	}

	// Your work. `You` is what waits on the owner; that is the rail's point, so
	// it leads and carries YourMove true.
	doc.Work = Work{
		Known:   p.Work.Known,
		Partial: p.Work.Partial,
		Login:   p.Work.Login,
		NeedYou: len(p.Work.You),
		Total:   len(p.Work.You) + len(p.Work.Them),
		Items:   []WorkItem{},
		Error:   p.Work.Err,
	}
	appendWork := func(rows []workRow, yourMove bool) {
		for _, w := range rows {
			doc.Work.Items = append(doc.Work.Items, WorkItem{
				Key: w.Key, Kind: w.Kind, Repo: w.Repo, Number: w.Number,
				Title: w.Title, URL: w.URL, Why: w.Why,
				Ago: w.Ago, AgoTitle: w.AgoTitle, Level: w.Level,
				YourMove: yourMove, Status: w.Status,
			})
		}
	}
	appendWork(p.Work.You, true)
	appendWork(p.Work.Them, false)

	// Conversations: joined, not opened. ConvYou asks something of the owner,
	// ConvThem is quiet.
	doc.Conversations = Conversations{
		Known:   p.Work.Known,
		Quiet:   len(p.Work.ConvThem),
		NeedYou: len(p.Work.ConvYou),
		Total:   len(p.Work.ConvYou) + len(p.Work.ConvThem),
	}

	// Watched. toWatchItems (alerts_api.go) already turns []watchRow into a
	// non-nil []WatchItem with ChangedAt formatted the same way, so the
	// dashboard and alerts documents cannot disagree on row shape.
	doc.Watched = toWatchItems(p.Watch)

	// No caching. These figures move on every poll, and a cached document is a
	// dashboard that quietly stops updating — the failure mode hardest to
	// notice, because it looks exactly like nothing happening.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// The document contains no credential, but it is still the user's data on a
	// loopback-bound server. Deny framing and sniffing on principle.
	w.Header().Set("X-Content-Type-Options", "nosniff")

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(doc); err != nil {
		// The status is already written by now; log-free here because the
		// handler has no logger and a partial body is self-evident to the
		// client's JSON parse.
		return
	}
}

// itoa avoids pulling strconv in for one call site in a file this small.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// Session is the small document carrying what the UI needs in order to act,
// as opposed to what it needs in order to render.
//
// WHY THIS IS NOT PART OF THE DASHBOARD DOCUMENT. `TestDashboardAPIDoesNotLeak
// TheToken` asserts the acknowledgement token never appears there, and that
// test is right: the dashboard document is a read-only projection that gets
// cached, logged and passed around, and a credential sprawled through it is a
// credential you have stopped being able to reason about.
//
// The token is not secret from this page, though. The templated settings page
// already renders it into the HTML as `{{.Token}}`, where any same-origin
// script can read it, and the guard it provides is CSRF rather than secrecy:
// serveRepos requires a same-origin request AND a matching header, so a page on
// another origin cannot forge a write even knowing the endpoint. Serving it at
// a same-origin endpoint is the identical property, not a weaker one.
//
// Keeping it in its own document means the one that carries it is small,
// obviously about authorisation, and easy to audit — rather than one field
// among forty in a document about repositories.
type Session struct {
	// Token authorises writes via the X-HelloGitty-Token header.
	Token string `json:"token"`
	// Writable says whether this build can change what is tracked at all. The
	// UI should hide the controls rather than offer an action that 404s.
	Writable bool `json:"writable"`
}

func (h *Handler) serveSessionAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, writable := h.Source.(RepoSource)

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	json.NewEncoder(w).Encode(Session{Token: h.token(), Writable: writable})
}

// SettingsAPI backs the settings page.
//
// Everything here is READ-ONLY. The page's two write actions — track and
// untrack a repository — already have endpoints at /repos/add and
// /repos/remove, guarded by same-origin plus the token header, and the React
// page uses those rather than growing parallel ones. §4 asks for "minimal
// typed endpoints if the migration actually requires them"; for writes it does
// not.
//
// The config paths are shown so you can see where the service is reading and
// writing. They are paths, not contents: nothing here opens a file.
type SettingsAPI struct {
	Version  string `json:"version"`
	Codename string `json:"codename"`

	Config struct {
		Listen    string `json:"listen"`
		Database  string `json:"database"`
		Snapshot  string `json:"snapshot"`
		ReposFile string `json:"reposFile"`
		Inbox     string `json:"inbox"`
		// LayoutDefault is JSON from the config file, or empty when unset.
		LayoutDefault string `json:"layoutDefault"`
		// Maintain is the `maintain:` list from hellogitty.json — orgs and
		// repositories ("owner" or "owner/name") whose open PRs and issues
		// land under "Waiting on you" on top of the owner's own. Read-only
		// here; editing it means editing the config file and restarting.
		// Empty when the list is empty — the React page gates the display
		// on length rather than a separate `hasMaintain` flag, matching how
		// the templated page gated on `{{if .ConfigMaintain}}`.
		Maintain []string `json:"maintain"`
	} `json:"config"`

	Polling struct {
		IntervalMinutes int `json:"intervalMinutes"`
		// WorkIntervalMinutes is the work-board loop's cadence, which is
		// SEPARATE from the repo poll interval above. The templated Checks
		// panel calls it "Your work refresh". Zero when the field is unset
		// on the Handler (the binary sets it from a default; a bare Default
		// in config never ships a zero, but the field defaults to zero so
		// the test fakes do).
		WorkIntervalMinutes int `json:"workIntervalMinutes"`
		// LastPollUnix is the full unix-seconds moment of the last poll. The
		// dashboard footer subtracts it from `Date.now()/1000` to compute
		// "N minutes ago" at any age, matching the templated page's
		// `data-since` mechanism at web/index.html:4739 (which emits
		// `.LastPollUnix` and does `Date.now()/1000 - dataset.since` from
		// JS). The alternative — sending `LastPollUTC` and reconstructing a
		// date in the client — caps the computed age at 24 hours, since the
		// client has to assume "today" and roll back a day if the result is
		// in the future. A poll that actually happened three days ago then
		// reads as "3 hours ago": confident, plausible, wrong by three
		// days. #284.
		LastPollUnix int64  `json:"lastPollUnix"`
		LastPollUTC  string `json:"lastPollUtc"`
		NextPollUTC  string `json:"nextPollUtc"`
		// Known is false before the first poll completes. Without it a fresh
		// start looks identical to a stalled one.
		Known bool `json:"known"`
		// LastCycleMs is how long the last repo-poll cycle took, in
		// milliseconds. Zero when no cycle has reached the point of recording
		// a duration — the first one has not finished, or an earlier one
		// aborted on rate-limit before the final tally. This is a DIFFERENT
		// signal from `Known` above, which only says "some repo poll
		// completed" (a rate-limited run still ticks that), so the client
		// gates its em-dash on `lastCycleMs == 0` rather than on `!known`.
		// The templated Checks panel calls this "Last check took".
		LastCycleMs int64 `json:"lastCycleMs"`
	} `json:"polling"`

	API struct {
		Known    bool   `json:"known"`
		Used     int    `json:"used"`
		Limit    int    `json:"limit"`
		Percent  int    `json:"percent"`
		ResetUTC string `json:"resetUtc"`
		// CallsPerCycle is the number of API requests the last poll cycle
		// charged against the hour's budget. Zero under the same conditions
		// as polling.lastCycleMs above (no cycle has finished recording
		// telemetry), and the client gates its em-dash the same way. The
		// templated Checks panel calls this "API calls per check".
		CallsPerCycle int64 `json:"callsPerCycle"`
	} `json:"api"`

	Repos struct {
		// Tracked is what the next poll will look at: the repositories in the
		// last snapshot, minus any removed since.
		//
		// WHY THE SUBTRACTION. The snapshot is written by the poller, so a
		// repository removed a second ago is still in it until the next cycle
		// — up to an hour. Listing the snapshot alone made removal look like
		// it had failed: the request returned 200, and the row stayed.
		Tracked []string `json:"tracked"`
		Count   int      `json:"count"`
		// Removed lists config-file repositories dropped here but still
		// present in the snapshot. Shown so the removal is visibly an action
		// that happened rather than one that did nothing.
		Removed []string `json:"removed"`
		// InPipeline is how many of them the pipeline command knows about.
		// Only meaningful when `hasPipeline` is true — zero without a
		// configured pipeline is ambiguous with zero WITH one and no
		// matches, and conflating the two is exactly the "unknown is zero"
		// trap the React side is careful to avoid.
		InPipeline int `json:"inPipeline"`
	} `json:"repos"`

	// HasPipeline gates the "pipeline targets" readout. False for a dashboard
	// with no `pipeline_command` configured; the React page hides the line
	// rather than showing "0 targets" against a user who has no pipeline.
	HasPipeline bool `json:"hasPipeline"`
}

func (h *Handler) serveSettingsAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p, err := h.build()
	if err != nil {
		http.Error(w, "settings unavailable", http.StatusInternalServerError)
		return
	}

	var doc SettingsAPI
	doc.Version = p.Version
	doc.Config.Listen = p.ConfigListen
	doc.Config.Database = p.ConfigDatabase
	doc.Config.Snapshot = p.ConfigSnapshot
	doc.Config.ReposFile = p.ConfigReposFile
	doc.Config.Inbox = p.ConfigInbox
	// p.LayoutDefault is template.JS — a type that exists to tell html/template
	// this string is already safe to inline in a <script>. That marking means
	// nothing in JSON and carries no guarantee here, so it is converted
	// explicitly rather than silently: whatever reads this field is doing its
	// own escaping.
	doc.Config.LayoutDefault = string(p.LayoutDefault)
	doc.Config.Maintain = []string{}
	doc.Config.Maintain = append(doc.Config.Maintain, p.ConfigMaintain...)

	doc.Polling.IntervalMinutes = p.PollInterval
	doc.Polling.WorkIntervalMinutes = p.WorkInterval
	doc.Polling.LastPollUnix = p.LastPollUnix
	doc.Polling.LastPollUTC = p.LastPollUTC
	doc.Polling.NextPollUTC = p.NextPollUTC
	doc.Polling.Known = p.LastPollUnix > 0
	doc.Polling.LastCycleMs = p.CycleDurationMs

	doc.API.Known = p.APIKnown
	doc.API.Used = p.APIUsed
	doc.API.Limit = p.APILimit
	doc.API.Percent = p.APIPct
	doc.API.ResetUTC = p.APIResetUTC
	doc.API.CallsPerCycle = p.CycleRequests

	doc.Repos.Tracked = []string{}
	doc.Repos.Removed = []string{}
	removed := map[string]bool{}
	if rs, ok := h.Source.(RepoSource); ok {
		for _, full := range rs.Removed() {
			removed[strings.ToLower(full)] = true
			doc.Repos.Removed = append(doc.Repos.Removed, full)
		}
	}
	for _, row := range p.Rows {
		full := row.Owner + "/" + row.Name
		if removed[strings.ToLower(full)] {
			continue
		}
		doc.Repos.Tracked = append(doc.Repos.Tracked, full)
	}
	doc.Repos.Count = len(doc.Repos.Tracked)
	doc.Repos.InPipeline = p.TargetCount
	doc.HasPipeline = p.HasPipeline

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(doc)
}

// PullRequest is one row of the pipeline table.
//
// The booleans are the page's own derived predicates (Pending, ChecksFailing),
// computed here rather than in the client. They encode rules — "a requested
// review waits on the reviewer, so it does not count as pending" — and a rule
// restated in TypeScript is a rule with two places to drift.
type PullRequest struct {
	Repo   string `json:"repo"`
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	State  string `json:"state"`
	Opened string `json:"opened"`

	ReviewDecision    string `json:"reviewDecision"`
	Checks            string `json:"checks"`
	Conflict          bool   `json:"conflict"`
	Draft             bool   `json:"draft"`
	UnresolvedThreads int    `json:"unresolvedThreads"`
	Requested         bool   `json:"requested"`

	/* Derived server-side, so the filters cannot disagree with the counts. */
	Pending       bool `json:"pending"`
	ChecksFailing bool `json:"checksFailing"`
	Approved      bool `json:"approved"`

	// LastActivity is the newest of any comment, review, review-thread reply,
	// bot finding or our own commit — not GitHub's updated_at, which includes
	// label edits and other noise. Empty when the board has nothing to go on,
	// which is not the same as "no activity".
	LastActivity string `json:"lastActivity"`
}

// PipelinePageAPI backs the PR Pipeline page.
//
// THE SHAPE IS THE FUNNEL, deliberately. PR #222 reorganised this page after
// the owner's complaint that eleven numbers sat as peers and "do not seem like
// they're coherent numbers" — several were subsets of Open, so they summed to
// nothing. The fix separated lifetime totals from what is open now, and demoted
// the subsets to filters over the table.
//
// This document keeps that separation rather than flattening it back into a
// list of integers. A React page built from a flat list would quietly
// reintroduce exactly the thing that was fixed.
type PipelinePageAPI struct {
	Lifetime struct {
		Opened int    `json:"opened"`
		Merged int    `json:"merged"`
		Closed int    `json:"closed"`
		Rate   string `json:"rate"`
	} `json:"lifetime"`

	// OpenNow and the subsets OF it. `Pending`, `Approved` and `Draft` each
	// count a subset of `Open`, never a sibling of it — one pull request can be
	// open and pending and conflicted at once.
	OpenNow struct {
		Open     int `json:"open"`
		Pending  int `json:"pending"`
		Approved int `json:"approved"`
		Draft    int `json:"draft"`
	} `json:"openNow"`

	Known        bool          `json:"known"`
	Error        string        `json:"error,omitempty"`
	PullRequests []PullRequest `json:"pullRequests"`
	Repos        []string      `json:"repos"`

	// HasPipeline is true only when `pipeline_command` is configured and the
	// per-stage board has something to say. The templated page gates its own
	// Stages section the same way — a dashboard without a pipeline never had
	// one, and a Stages panel showing zero stages would be worse than hiding
	// the section entirely.
	HasPipeline bool `json:"hasPipeline"`
	// Stages is the per-stage count row: one entry per configured stage, in
	// the pipeline's own order. Reused from the StageCount type the dashboard
	// document already carries, so a stage definition cannot drift between
	// the dashboard panel and this page.
	Stages []StageCount `json:"stages"`
}

func (h *Handler) servePipelineAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p, err := h.build()
	if err != nil {
		http.Error(w, "pipeline unavailable", http.StatusInternalServerError)
		return
	}

	var doc PipelinePageAPI
	doc.Known = p.Pipeline.Known
	doc.Error = p.Pipeline.Err
	doc.Lifetime.Opened = p.Pipeline.Opened
	doc.Lifetime.Merged = p.Pipeline.Merged
	doc.Lifetime.Closed = p.Pipeline.Closed
	doc.Lifetime.Rate = p.Pipeline.Rate
	doc.OpenNow.Open = p.Pipeline.Open
	doc.OpenNow.Pending = p.Pipeline.Pending
	doc.OpenNow.Approved = p.Pipeline.Approved
	doc.OpenNow.Draft = p.Pipeline.Drafts

	doc.PullRequests = []PullRequest{}
	for _, pr := range p.Pipeline.All {
		row := PullRequest{
			Repo: pr.Repo, Number: pr.Number, Title: pr.Title, URL: pr.URL,
			State: pr.State, Opened: pr.Opened,
			ReviewDecision: pr.ReviewDecision, Checks: pr.Checks,
			Conflict: pr.Conflict, Draft: pr.Draft,
			UnresolvedThreads: pr.UnresolvedThreads, Requested: pr.Requested,
			Pending:       pr.Pending(),
			ChecksFailing: pr.ChecksFailing(),
			Approved:      pr.ReviewDecision == "APPROVED",
		}
		if pr.LastActivity != nil {
			row.LastActivity = pr.LastActivity.UTC().Format(time.RFC3339)
		}
		doc.PullRequests = append(doc.PullRequests, row)
	}

	doc.Repos = []string{}
	doc.Repos = append(doc.Repos, p.Pipeline.Repos...)

	doc.HasPipeline = p.HasPipeline
	doc.Stages = []StageCount{}
	for _, c := range p.Pipeline.Counts {
		doc.Stages = append(doc.Stages, StageCount{Abbr: c.Abbr, Name: c.Name, Count: c.Count})
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	json.NewEncoder(w).Encode(doc)
}

// WorkRow is one item on the work board.
type WorkRow struct {
	Key    string `json:"key"`
	Kind   string `json:"kind"`
	Repo   string `json:"repo"`
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	// Why it is on the board: "You opened it", "Assigned to you".
	Why string `json:"why"`
	// Status is the server's sentence about where it stands.
	Status string `json:"status"`
	// Level is the server's severity word: "caution", "ok" or empty.
	Level string `json:"level"`
	// Personal is a step only the owner can take, e.g. "Sign the CLA".
	Personal string   `json:"personal,omitempty"`
	Ago      string   `json:"ago"`
	AgoTitle string   `json:"agoTitle"`
	Labels   []string `json:"labels"`
	// SinceUnix is the row's last-updated instant in epoch seconds. A number,
	// not a formatted string, so the client can sort by time without parsing
	// Ago — which prints "a day" and "yesterday" and would compare lexically.
	// Zero means the server did not have the timestamp, which is not the same
	// as 1970: the client must sort those last rather than first.
	SinceUnix int64 `json:"sinceUnix"`
	// Attn is the attention cue: "new" (unread activity), "caution" (your
	// move) or empty. Carries the server's reason the row should stand out;
	// the client renders boldness and colour from it rather than inferring
	// either. Omitted when empty so the schema change is backward-compatible.
	Attn string `json:"attn,omitempty"`
}

// WorkPageAPI backs the "Your work" page.
//
// THE GROUPS ARE THE POINT and they are kept apart rather than merged into one
// list with a flag. "Waiting on you" and "waiting on them" are the question the
// page exists to answer; a single list sorted by date answers a different one.
//
// `Done` and `Dismissed` are separate again for the same reason: finished is
// not the same as set aside, and only one of them can be restored.
type WorkPageAPI struct {
	Known bool   `json:"known"`
	Error string `json:"error,omitempty"`
	// Partial: the board is new but incomplete, because a refresh failed
	// halfway. Different from Known being false, which means none has run.
	Partial bool   `json:"partial"`
	Login   string `json:"login"`
	Scope   string `json:"scope"`

	You       []WorkRow `json:"you"`
	Them      []WorkRow `json:"them"`
	Done      []WorkRow `json:"done"`
	Dismissed []WorkRow `json:"dismissed"`

	// Conversations: threads the owner joined without opening. Kept apart from
	// You/Them because they aren't the owner's to finish — they close and leave
	// the board — and because /conversations is their own page. ADR-UI-002 §4:
	// "add fields to the existing projection if needed; do not create a second
	// endpoint computing the same thing."
	//
	// ConvYou asks something of the owner, ConvThem is quiet. ConvNew counts
	// rows with unread activity across both, so the "Unread" overview card does
	// not have to peek inside each row to find them.
	ConvYou  []WorkRow `json:"convYou"`
	ConvThem []WorkRow `json:"convThem"`
	ConvNew  int       `json:"convNew"`
}

func toWorkRows(rows []workRow) []WorkRow {
	out := []WorkRow{}
	for _, w := range rows {
		labels := w.Labels
		if labels == nil {
			labels = []string{}
		}
		out = append(out, WorkRow{
			Key: w.Key, Kind: w.Kind, Repo: w.Repo, Number: w.Number,
			Title: w.Title, URL: w.URL, Why: w.Why, Status: w.Status,
			Level: w.Level, Personal: w.Personal,
			Ago: w.Ago, AgoTitle: w.AgoTitle, Labels: labels,
			SinceUnix: w.SinceUnix, Attn: w.Attn,
		})
	}
	return out
}

func (h *Handler) serveWorkAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p, err := h.build()
	if err != nil {
		http.Error(w, "work board unavailable", http.StatusInternalServerError)
		return
	}

	doc := WorkPageAPI{
		Known:     p.Work.Known,
		Error:     p.Work.Err,
		Partial:   p.Work.Partial,
		Login:     p.Work.Login,
		Scope:     p.Work.Scope,
		You:       toWorkRows(p.Work.You),
		Them:      toWorkRows(p.Work.Them),
		Done:      toWorkRows(p.Work.Done),
		Dismissed: toWorkRows(p.DismissedWork),
		ConvYou:   toWorkRows(p.Work.ConvYou),
		ConvThem:  toWorkRows(p.Work.ConvThem),
		ConvNew:   p.ConvNew,
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	json.NewEncoder(w).Encode(doc)
}

// RepoActivity is a notification about one of your own repositories that did
// not match any item on the work board: a failed workflow run, a release, a
// mention on a thread you are not already on.
//
// Separate from WorkRow deliberately: these are events about repos rather than
// items authored by you, and merging them would lose that distinction.
type RepoActivity struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Repo   string `json:"repo"`
	Number int    `json:"number,omitempty"`
	// Words is the server's own sentence for what happened, e.g. "New release".
	Words    string `json:"words"`
	Ago      string `json:"ago"`
	AgoTitle string `json:"agoTitle"`
	// New is 0 when read, otherwise the unix time the unread notification arrived.
	New int64 `json:"new,omitempty"`
	// Attn: "new" (unread), "caution" (read but still asks something of you), or "".
	Attn string `json:"attn,omitempty"`
}

// YourReposPageAPI backs the /your-repos page.
//
// The templated page shows three overview counts (Open PRs, Merged, Unread) and
// three lists (what you need to do, finished items, activity in your own
// repositories). Each is projected from the existing `page` struct the
// dashboard already builds — no new data source, and nothing the handler does
// not already compute at render time.
//
// WHY NOT REUSE /app/api/work.json. Work has You/Them/Done/Dismissed; this
// page needs You/Done plus a fourth list (RepoOther) that work.json does not
// carry and that is scoped differently — activity about repos rather than
// items authored by you. Adding RepoOther to work.json would mix the two
// scopes in one document and pull in fields the work board does not need.
//
// WHY NOT REUSE /app/api/pipeline.json. Pipeline has Open and Merged but a
// shape built for the full funnel view: per-PR rows, per-stage counts. This
// page only needs the two totals.
//
// UNKNOWN IS NOT ZERO. The templated page prints `{{.Pipeline.Open}}` without
// checking whether the pipeline has been polled — three overview tiles that
// all show "0" before the first poll lands, saying nothing needs attention
// about data nobody has looked at yet. `PipelineKnown` and `WorkKnown` carry
// that distinction out to the UI so it can render "—" for unknown.
type YourReposPageAPI struct {
	// PipelineKnown is false until the PR board has been fetched at least once.
	PipelineKnown bool `json:"pipelineKnown"`
	// WorkKnown is false until the work board has been fetched at least once.
	WorkKnown bool `json:"workKnown"`
	// Error, when set, is the friendly sentence to render across the whole page.
	Error string `json:"error,omitempty"`
	// Partial: the lists below are new but incomplete — the last refresh failed
	// halfway. Different from Known being false, which means none has run.
	Partial bool   `json:"partial"`
	Login   string `json:"login"`

	Open     int `json:"open"`
	Merged   int `json:"merged"`
	ReposNew int `json:"reposNew"`

	You       []WorkRow      `json:"you"`
	Done      []WorkRow      `json:"done"`
	RepoOther []RepoActivity `json:"repoOther"`
}

func toRepoActivity(rows []otherRow) []RepoActivity {
	out := []RepoActivity{}
	for _, o := range rows {
		out = append(out, RepoActivity{
			Key: o.Key, Title: o.Title, URL: o.URL, Repo: o.Repo, Number: o.Number,
			Words: o.Words, Ago: o.Ago, AgoTitle: o.AgoTitle,
			New: o.New, Attn: o.Attn,
		})
	}
	return out
}

func (h *Handler) serveYourReposAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p, err := h.build()
	if err != nil {
		http.Error(w, "your repositories unavailable", http.StatusInternalServerError)
		return
	}

	errText := p.Work.Err
	if errText == "" {
		errText = p.Pipeline.Err
	}

	doc := YourReposPageAPI{
		PipelineKnown: p.Pipeline.Known,
		WorkKnown:     p.Work.Known,
		Error:         errText,
		Partial:       p.Work.Partial,
		Login:         p.Work.Login,
		Open:          p.Pipeline.Open,
		Merged:        p.Pipeline.Merged,
		ReposNew:      p.ReposNew,
		You:           toWorkRows(p.Work.You),
		Done:          toWorkRows(p.Work.Done),
		RepoOther:     toRepoActivity(p.Work.RepoOther),
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	json.NewEncoder(w).Encode(doc)
}
