package dashboard

import (
	"encoding/json"
	"net/http"
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

	// Partial says that this document covers the KPI slice only, and that the
	// repository table, pipeline and work rails are still rendered from
	// fixtures on the client. It exists so the frontend cannot quietly assume
	// it has everything — Phase 4 sets it false as each section lands.
	Partial bool `json:"partial"`
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
		Partial:     true,
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
