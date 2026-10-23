package dashboard

import (
	"bytes"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/pipeline"
	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

const (
	deniedShown = 5
	staleAfter  = 2 * time.Hour
	// Commit age bars saturate here; anything older is simply "old".
	ageScaleDays = 120
)

// Telemetry is the poller's view of its own most recent cycle.
type Telemetry struct {
	LastPoll      time.Time
	Errors        map[string]string
	CycleDuration time.Duration
	CycleRequests int64
	RateRemaining int
	RateLimit     int
	RateReset     time.Time
	OurPRs        []PR
	PRsKnown      bool
	PRError       string
	OpenPRs       map[string][]OpenPR // newest open pull requests per repository, by lowercase owner/name
}

// OpenPR is an open pull request in a tracked repository.
type OpenPR struct {
	Number    int
	Title     string
	URL       string
	Author    string
	Bot       bool
	Draft     bool
	CreatedAt time.Time
}

type PR struct {
	Owner, Name string
	Number      int
	Title       string
	URL         string
	State       string
	Merged      bool
	CreatedAt   *time.Time
}

// Source supplies everything the page shows. Reports are already filtered to tracked repos.
// Pipeline returns nil, nil when no pipeline command is configured. Work returns the last good
// work board (nil before the first fetch) and the error from the latest fetch, if it failed.
type Source interface {
	Reports() ([]store.RepoReport, error)
	Telemetry() Telemetry
	Pipeline() (*pipeline.State, error)
	Work() (*work.Board, string)
}

type Handler struct {
	Template     string
	SnapshotPath string
	Source       Source
	PollInterval time.Duration
	Version      string
	// Baby marks a codename that has not graduated yet; the page sets it apart from the label.
	Baby bool
	// Mascot holds the banner clips and rest still; nil leaves the banner without a mascot.
	Mascot fs.FS
	Now    func() time.Time

	// Help page: its template (parsed with Template, whose base styles it shares), the guide in
	// Markdown, the guide's screenshot, and facts about this install set at startup (files in use).
	HelpTemplate string
	FeedTemplate string // the feed on its own page, parsed with Template like Help
	ListTemplate   string // what a Pipeline number counts, on a page of its own
	IssuesTemplate        string // all open issues across tracked repos, on a page of its own
	ReposTemplate         string // tracked repos on a page of its own
	PipelineTemplate      string // pipeline on a page of its own
	ConversationsTemplate string // conversations on a page of its own
	YourReposTemplate     string // your repos on a page of its own

	WorkTemplate               string // your work on a page of its own
	AlertYourMoveTemplate      string
	AlertWatchedClaimedTemplate string
	AlertWatchedClosedTemplate  string
	AlertCheckFailedTemplate    string
	AlertRepoHealthTemplate     string
	Guide        string
	Screenshot   []byte
	About        []AboutItem
}

type page struct {
	// RepoTools says repositories can be added and removed here; RemovedRepos are config-file
	// repositories you removed, which can come back with one click.
	RepoTools    bool
	RemovedRepos []string
	CanWatch     bool // the eye can watch and unwatch issues
	Version      string
	Baby         bool
	Mascot       *mascot
	HasPipeline  bool
	PipelineErr  string
	Labels       pipeline.Labels
	NowUTC       string
	NowUnix      int64
	LastPollUnix int64
	LastPollUTC  string
	NextPollUTC  string
	PollInterval int
	CycleText    string
	CycleCalls   string
	APIKnown     bool
	APIUsed      int
	APILimit     int
	APIPct       int
	APIResetUTC  string
	RepoCount    int
	TargetCount  int
	Cells        []cell
	Stages       []stageHead
	Rows         []row
	Watch        []watchRow
	Pipeline     pipelineView
	Work         workView
	Glossary     map[string]Term
	GlossaryJSON template.JS
	Feed         feedView
	Token        string // sent back with acknowledgements; see Handler.token
	// Issues panel: the most recent open issues across tracked repos.
	Issues     []globalIssue
	IssueTotal int

	// Issues full-page (/issues).
	IssuePages    int
	IssuePg       int
	IssuePrevPage int
	IssueNextPage int
	IssueHasPrev  bool
	IssueHasNext  bool
	IssueWindow   int
	IssueQuery    string

	// List page (/list).
	ListTitle string
	ListSub   string
	ListPRs   []prRow
	ListRepos []row
	ListEmpty string
	ListLinks []listLink
	// "New" counts beside each section's heading.
	WorkNew, ConvNew, ReposNew, TrackedNew, TrackedNewRepos int

	// Work items dismissed from the dashboard but shown on the /work page.
	DismissedWork []workRow

	// Alert detail pages.
	ClaimedWatch []watchRow
	ClaimedCount int
	ClosedWatch  []watchRow
	ClosedCount  int
	FailedRepos  []failedRepo
	HealthRepos  []row
	AlertTitle   string
	AlertDesc    string
}

// HasTerm reports whether the hover help explains id, so the page only marks what it can explain.
func (p *page) HasTerm(id string) bool {
	_, ok := p.Glossary[id]
	return ok
}

// mascot lists the banner clips by kind; the page picks one on load.
type mascot struct {
	Routine, News []string
	Rest          string
}

type cell struct {
	Key, Label, Value, Level string
	// Detail names what lit the cell, cut to fit; Title carries the full list.
	Detail, Title string
	// More counts names left out of Detail; it renders outside the clamped text so it always shows.
	More             int
	Lit, Wide, Empty bool
	// Items are the names that light the cell, for clearing; Cleared counts those you cleared.
	Items     []string
	ItemsAttr string
	Clearable bool
	Cleared   int
	Link      string // alert detail page URL, if the cell is clickable
}

type failedRepo struct {
	Name  string
	Error string
}

type stageHead struct{ Abbr, Name string }

type phaseCell struct{ Abbr, Name, State string }

type row struct {
	Key, Owner, Name, URL string
	Health                string
	Phases                []phaseCell
	InPipeline            bool
	Stage                 string
	StageAbbr             string
	Label                 string
	Level                 string
	NotesURL              string
	Open, GFI, Unassigned int
	AgeKnown              bool
	AgeDays               int
	AgePct                int
	AgeWarn               bool
	Watch                 []watchRow
	DeniedTotal           int
	Denied                []store.DeniedPR
	Error                 string
	ErrorRaw              string // GitHub's own words, for a bug report
	PRs                   []prRow
	Search                string // lowercase text the page's search box matches against
	Peek                  peek
	// The repository's tabs, and how much in the live feed about it is unacknowledged.
	NewCount  int
	NewIDs    string // the unacknowledged feed rows, space-separated, so the page can count down as they are acknowledged
	NewIssues int
	Issues    []repoIssue
	OpenPRs   []repoPR
	ClosedPRs []repoPR
	Activity  []feedRow
	Tab       string // the tab it opens on
}

type watchRow struct {
	Repo        string
	Number      int
	Title       string
	Status      string
	ClaimDetail string
	ChangedAt   *time.Time
	URL         string
	Outside     bool // in a repository you don't track, watched with the eye
	// Item is how the alert cells name it ("Name#123"); Seen says you marked its claim or closing
	// as seen, which also clears it from the alert.
	Item string
	Seen bool
}

// CellKey is the alert cell this row's state lights, or "" when it lights none.
func (w watchRow) CellKey() string {
	switch w.Status {
	case "CLAIMED":
		return "watch-claimed"
	case "CLOSED_FIXED", "CLOSED_WONT":
		return "watch-closed"
	}
	return ""
}

// K is the issue as "owner/name#123", the eye's key.
func (w watchRow) K() string { return rowKey(w.Repo, w.Number) }

type stageCount struct {
	Abbr, Name string
	Count      int
}

type prRow struct {
	Repo, Title, URL, State string
	Number                  int
	Opened                  string
	NotesURL                string
}

type pipelineView struct {
	Counts                       []stageCount
	Opened, Open, Merged, Closed int
	Rate                         string
	Known                        bool
	Err                          string
	PRs                          []prRow
	All                          []prRow // every one, for the list page; PRs is the panel's first ten
}

// eye draws the watch toggle for an issue keyed "owner/name#123": an outlined eye, filled in when
// you watch it.
func eye(key string, on bool) template.HTML {
	k := template.HTMLEscapeString(key)
	state, label, title := "", "Watch "+k, "Watch: hear if someone claims it or it closes"
	if on {
		state, label, title = " on", "Stop watching "+k, "Watching: you'll hear if someone claims it or it closes. Click to stop."
	}
	return template.HTML(`<button type="button" class="eye` + state + `" data-watch="` + k + `" aria-pressed="` +
		strconv.FormatBool(on) + `" aria-label="` + label + `" title="` + title + `"><svg viewBox="0 0 16 16" aria-hidden="true">` +
		`<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg></button>`)
}

var funcs = template.FuncMap{
	"eye":   eye,
	"lower": strings.ToLower,
	"upper": strings.ToUpper,
	"isURL": func(s string) bool { return strings.HasPrefix(s, "https://") },
	"utc": func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.UTC().Format("2006-01-02 15:04Z")
	},
	"watchText": func(status string) string {
		switch status {
		case "CLAIMED":
			return "Claimed"
		case "CLOSED_FIXED":
			return "Fixed"
		case "CLOSED_WONT":
			return "Closed"
		}
		return "Open"
	},
	"verdict": func(v string) string {
		switch v {
		case "CHANGES_REQUESTED":
			return "Changes requested"
		case "APPROVED":
			return "Approved"
		case "COMMENTED":
			return "Reviewed"
		}
		return v
	},
	"assoc": func(a string) string {
		switch a {
		case "NONE", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER":
			return "First-time contributor"
		case "CONTRIBUTOR":
			return "Past contributor"
		case "MANNEQUIN":
			return "Imported account"
		}
		return a
	},
	"days": func(t *time.Time) string {
		if t == nil {
			return "—"
		}
		d := int(time.Since(*t).Hours() / 24)
		return strconv.Itoa(d) + " D"
	},
}

func (h *Handler) now() time.Time {
	if h.Now != nil {
		return h.Now().UTC()
	}
	return time.Now().UTC()
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/":
		h.serveDashboard(w, r)
	case strings.HasPrefix(r.URL.Path, "/mascot/") && h.Mascot != nil:
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.StripPrefix("/mascot/", http.FileServer(http.FS(h.Mascot))).ServeHTTP(w, r)
	case r.URL.Path == "/feed":
		h.serveFeedPage(w, r)
	case r.URL.Path == "/feed.json":
		h.serveFeedJSON(w, r)
	case r.URL.Path == "/feed/ack":
		h.serveFeedAck(w, r)
	case r.URL.Path == "/notifications/clear":
		h.serveNoticeClear(w, r)
	case r.URL.Path == "/watch":
		h.serveWatch(w, r)
	case r.URL.Path == "/issues":
		h.serveIssues(w, r)
	case r.URL.Path == "/repos":
		h.serveReposPage(w, r)
	case r.URL.Path == "/pipeline":
		h.servePipelinePage(w, r)
	case r.URL.Path == "/conversations":
		h.serveConversationsPage(w, r)
	case r.URL.Path == "/your-repos":
		h.serveYourReposPage(w, r)
	case r.URL.Path == "/alerts/your-move":
		h.serveAlertYourMove(w, r)
	case r.URL.Path == "/alerts/watched-claimed":
		h.serveAlertWatchedClaimed(w, r)
	case r.URL.Path == "/alerts/watched-closed":
		h.serveAlertWatchedClosed(w, r)
	case r.URL.Path == "/alerts/check-failed":
		h.serveAlertCheckFailed(w, r)
	case r.URL.Path == "/alerts/repo-dormant":
		h.serveAlertRepoHealthPage(w, r)
	case r.URL.Path == "/alerts/repo-slow":
		h.serveAlertRepoHealthPage(w, r)
	case r.URL.Path == "/list":
		h.serveList(w, r)
	case r.URL.Path == "/repos/add":
		h.serveRepos(w, r, true)
	case r.URL.Path == "/repos/remove":
		h.serveRepos(w, r, false)
	case r.URL.Path == "/repos/ready":
		h.serveRepoReady(w, r)
	case r.URL.Path == "/cells/clear":
		h.serveCells(w, r, false)
	case r.URL.Path == "/cells/restore":
		h.serveCells(w, r, true)
	case r.URL.Path == "/work":
		h.serveWorkPage(w, r)
	case r.URL.Path == "/work/dismiss":
		h.serveWorkDismiss(w, r, false)
	case r.URL.Path == "/work/restore":
		h.serveWorkDismiss(w, r, true)
	case r.URL.Path == "/help":
		h.serveHelp(w, r)
	case r.URL.Path == "/help/screenshot.png" && len(h.Screenshot) > 0:
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(h.Screenshot)
	case r.URL.Path == "/attention.json":
		h.serveAttention(w, r)
	case r.URL.Path == "/snapshot.json":
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, h.SnapshotPath)
	case strings.HasPrefix(r.URL.Path, "/notes/"):
		h.serveNotes(w, r, strings.TrimPrefix(r.URL.Path, "/notes/"))
	default:
		http.NotFound(w, r)
	}
}

// serveNotes serves a repo's notes file. Only paths the pipeline command named are readable,
// so a request cannot reach any other file.
func (h *Handler) serveNotes(w http.ResponseWriter, r *http.Request, ownerName string) {
	owner, name, ok := strings.Cut(ownerName, "/")
	if !ok || owner == "" || name == "" || strings.Contains(name, "/") {
		http.NotFound(w, r)
		return
	}
	st, _ := h.Source.Pipeline()
	pr, found := st.Repo(owner, name)
	if !found || pr.Notes == "" {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(pr.Notes)
	if err != nil {
		http.Error(w, "No notes file for "+owner+"/"+name+" yet.", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

func (h *Handler) serveDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	tmpl, err := template.New("index").Funcs(funcs).Parse(h.Template)
	if err != nil {
		log.Printf("dashboard: parse template: %v", err)
		http.Error(w, "dashboard template error", http.StatusInternalServerError)
		return
	}
	p, err := h.build()
	if err != nil {
		log.Printf("dashboard: %v", err)
		http.Error(w, "could not read dashboard data", http.StatusInternalServerError)
		return
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, p); err != nil {
		log.Printf("dashboard: render: %v", err)
		http.Error(w, "dashboard render error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(buf.Bytes())
}

func (h *Handler) build() (*page, error) {
	reports, err := h.Source.Reports()
	if err != nil {
		return nil, err
	}
	tel := h.Source.Telemetry()
	pst, pErr := h.Source.Pipeline()
	now := h.now()

	p := &page{
		Version:      h.Version,
		Baby:         h.Baby,
		Mascot:       h.mascot(),
		HasPipeline:  pst != nil,
		NowUTC:       now.Format("2006-01-02 15:04:05Z"),
		NowUnix:      now.Unix(),
		PollInterval: int(h.PollInterval / time.Minute),
		RepoCount:    len(reports),
		CycleText:    "—",
		CycleCalls:   "—",
	}
	if pErr != nil {
		p.PipelineErr = pErr.Error()
	}
	if pst != nil {
		p.Labels = pst.Labels
		for _, s := range pst.Stages {
			p.Stages = append(p.Stages, stageHead{Abbr: s.Abbr, Name: s.Name})
		}
	}

	lastPoll := tel.LastPoll
	// After a restart the in-memory poll time is empty until the first cycle ends.
	if lastPoll.IsZero() {
		for _, r := range reports {
			if r.LastPoll != nil && r.LastPoll.After(lastPoll) {
				lastPoll = *r.LastPoll
			}
		}
	}
	if !lastPoll.IsZero() {
		p.LastPollUnix = lastPoll.Unix()
		p.LastPollUTC = lastPoll.UTC().Format("15:04:05Z")
		p.NextPollUTC = lastPoll.Add(h.PollInterval).UTC().Format("15:04Z")
	}
	if tel.CycleDuration > 0 {
		p.CycleText = duration(tel.CycleDuration)
		p.CycleCalls = strconv.FormatInt(tel.CycleRequests, 10)
	}
	if tel.RateLimit > 0 {
		p.APIKnown = true
		p.APILimit = tel.RateLimit
		p.APIUsed = tel.RateLimit - tel.RateRemaining
		p.APIPct = p.APIUsed * 100 / tel.RateLimit
		p.APIResetUTC = tel.RateReset.UTC().Format("15:04Z")
	}

	p.Glossary = terms(pst)
	p.GlossaryJSON = glossaryJSON(p.Glossary)
	var overlaps []store.Overlap
	if src, ok := h.Source.(OverlapSource); ok {
		overlaps = src.OverlapReports()
	}

	p.Token = h.token()
	if rs, ok := h.Source.(RepoSource); ok {
		p.RepoTools, p.RemovedRepos = true, rs.Removed()
	}
	var news map[string]*repoNews
	if fs, ok := h.Source.(FeedSource); ok {
		rows := fs.Feed()
		p.Feed = buildFeed(rows, now)
		news = newsByRepo(rows)
	}

	board, workErr := h.Source.Work()
	p.Work = buildWork(board, workErr, now)
	addOverlapPeeks(&p.Work, overlapsByIssue(overlaps))
	if ns, ok := h.Source.(NotificationSource); ok {
		nv := ns.Notifications()
		applyAttention(&p.Work, nv, matchNotifications(board, nv.Items, now))
	}
	if cn, ok := h.Source.(NoticeSource); ok {
		cleared := cn.ClearedNotifications()
		p.Work.Other, p.Work.RepoOther = dropCleared(p.Work.Other, cleared), dropCleared(p.Work.RepoOther, cleared)
	}
	if ds, ok := h.Source.(WorkDismissSource); ok {
		dismissed := ds.DismissedWork()
		var d []workRow
		p.Work.You, d = filterDismissed(p.Work.You, dismissed)
		p.DismissedWork = append(p.DismissedWork, d...)
		p.Work.Them, d = filterDismissed(p.Work.Them, dismissed)
		p.DismissedWork = append(p.DismissedWork, d...)
		p.Work.Done, d = filterDismissed(p.Work.Done, dismissed)
		p.DismissedWork = append(p.DismissedWork, d...)
		p.Work.ConvYou, d = filterDismissed(p.Work.ConvYou, dismissed)
		p.DismissedWork = append(p.DismissedWork, d...)
		p.Work.ConvThem, d = filterDismissed(p.Work.ConvThem, dismissed)
		p.DismissedWork = append(p.DismissedWork, d...)
		p.Work.InYou, d = filterDismissed(p.Work.InYou, dismissed)
		p.DismissedWork = append(p.DismissedWork, d...)
		p.Work.InThem, d = filterDismissed(p.Work.InThem, dismissed)
		p.DismissedWork = append(p.DismissedWork, d...)
	}
	for _, list := range [][]workRow{p.Work.You, p.Work.Them, p.Work.Done} {
		for _, r := range list {
			if r.Attn == "new" {
				p.WorkNew++
			}
		}
	}
	for _, o := range p.Work.Other {
		if o.New > 0 {
			p.WorkNew++
		}
	}
	for _, list := range [][]workRow{p.Work.InYou, p.Work.InThem} {
		for _, r := range list {
			if r.Attn == "new" {
				p.ReposNew++
			}
		}
	}
	for _, o := range p.Work.RepoOther {
		if o.New > 0 {
			p.ReposNew++
		}
	}
	for _, list := range [][]workRow{p.Work.ConvYou, p.Work.ConvThem} {
		for _, r := range list {
			if r.Attn == "new" {
				p.ConvNew++
			}
		}
	}

	notesURL := func(owner, name string) string {
		if r, ok := pst.Repo(owner, name); ok && r.Notes != "" {
			return "/notes/" + owner + "/" + name
		}
		return ""
	}

	prsByRepo := map[string][]prRow{}
	pl := pipelineView{Known: tel.PRsKnown, Err: tel.PRError}
	for _, pr := range withBoardPRs(tel.OurPRs, board, reports) {
		row := prRow{
			Repo: pr.Owner + "/" + pr.Name, Title: pr.Title, URL: pr.URL, Number: pr.Number,
			State: prState(pr), NotesURL: notesURL(pr.Owner, pr.Name),
		}
		if pr.CreatedAt != nil {
			row.Opened = pr.CreatedAt.UTC().Format("2006-01-02")
		}
		key := strings.ToLower(row.Repo)
		prsByRepo[key] = append(prsByRepo[key], row)
		pl.PRs = append(pl.PRs, row)
		pl.Opened++
		switch row.State {
		case "Merged":
			pl.Merged++
		case "Closed":
			pl.Closed++
		default:
			pl.Open++
		}
	}
	if decided := pl.Merged + pl.Closed; decided > 0 {
		pl.Rate = fmt.Sprintf("%d%%", pl.Merged*100/decided)
	}
	pl.All = pl.PRs
	if len(pl.PRs) > 10 {
		pl.PRs = pl.PRs[:10]
	}

	var counts []int
	if pst != nil {
		counts = make([]int, len(pst.Stages))
	}
	stageIdx := func(stage string) int { return pst.StageIndex(stage) }

	var claimed, closed, dormant, slow, flagged, failed int
	var closedRepos []string
	var claimedRepos, dormantRepos, slowRepos, flaggedRepos, failedRepos []string
	for _, r := range reports {
		full := r.Owner + "/" + r.Name
		rw := row{
			Key: strings.ToLower(full), Owner: r.Owner, Name: r.Name, URL: "https://github.com/" + full,
			Health: store.HealthLabel(r.Repo),
			Open:   r.OpenIssuesTotal, GFI: r.OpenIssuesGFI, Unassigned: r.OpenIssuesUnassigned,
			DeniedTotal: r.DeniedPRsTotal, Error: checkError(tel.Errors[strings.ToLower(full)]),
			ErrorRaw: tel.Errors[strings.ToLower(full)],
			PRs:      prsByRepo[strings.ToLower(full)], NotesURL: notesURL(r.Owner, r.Name),
		}
		if len(r.DeniedPRs) > deniedShown {
			rw.Denied = r.DeniedPRs[:deniedShown]
		} else {
			rw.Denied = r.DeniedPRs
		}
		if r.LastCommit != nil {
			rw.AgeKnown = true
			rw.AgeDays = int(now.Sub(*r.LastCommit).Hours() / 24)
			rw.AgePct = min(rw.AgeDays, ageScaleDays) * 100 / ageScaleDays
			rw.AgeWarn = rw.AgeDays > 30
		}
		rw.Search = strings.ToLower(full + " " + rw.Health)
		if pr, ok := pst.Repo(r.Owner, r.Name); ok && pr.Stage != "" {
			rw.InPipeline, rw.Stage, rw.Label, rw.Level = true, pr.Stage, pr.Label, pr.Level
			rw.StageAbbr = pst.Stages[stageIdx(pr.Stage)].Abbr
			for i, ph := range pst.Phases(pr) {
				rw.Phases = append(rw.Phases, phaseCell{Abbr: pst.Stages[i].Abbr, Name: pst.Stages[i].Name, State: string(ph)})
				if ph == pipeline.Failed {
					failed++
					failedRepos = append(failedRepos, r.Name)
				}
			}
			counts[stageIdx(pr.Stage)]++
			p.TargetCount++
			if pr.Level == "caution" {
				flagged++
				flaggedRepos = append(flaggedRepos, r.Name)
			}
		}
		switch rw.Health {
		case "DORMANT":
			dormant++
			dormantRepos = append(dormantRepos, r.Name)
		case "SLOW":
			slow++
			slowRepos = append(slowRepos, r.Name)
		}
		for _, wr := range r.Watch {
			w := watchRow{
				Repo: full, Number: wr.Number, Title: wr.Title, Status: store.WatchLabel(wr.Status),
				ClaimDetail: wr.ClaimDetail, ChangedAt: wr.StatusChangedAt,
				URL: rw.URL + "/issues/" + strconv.Itoa(wr.Number),
			}
			switch w.Status {
			case "CLAIMED":
				claimed++
				claimedRepos = append(claimedRepos, fmt.Sprintf("%s#%d", r.Name, wr.Number))
			case "CLOSED_FIXED", "CLOSED_WONT":
				closed++
				closedRepos = append(closedRepos, fmt.Sprintf("%s#%d", r.Name, wr.Number))
			}
			w.Item = fmt.Sprintf("%s#%d", r.Name, wr.Number)
			rw.Watch = append(rw.Watch, w)
			p.Watch = append(p.Watch, w)
		}
		if rw.InPipeline {
			rw.Search += " " + strings.ToLower(rw.Stage+" "+rw.Label)
		}
		fillRepoDetail(&rw, r, news[strings.ToLower(full)], tel.OpenPRs[strings.ToLower(full)], now)
		if rw.NewCount > 0 {
			p.TrackedNew += rw.NewCount
			p.TrackedNewRepos++
		}
		rw.Peek = repoPeek(rw, now, overlaps)
		p.Rows = append(p.Rows, rw)
	}
	if pst != nil {
		for i, s := range pst.Stages {
			pl.Counts = append(pl.Counts, stageCount{Abbr: s.Abbr, Name: s.Name, Count: counts[i]})
		}
	}
	p.Pipeline = pl

	sort.SliceStable(p.Rows, func(i, j int) bool {
		a, b := p.Rows[i], p.Rows[j]
		if a.InPipeline != b.InPipeline {
			return a.InPipeline
		}
		if a.InPipeline && a.Stage != b.Stage {
			return stageIdx(a.Stage) > stageIdx(b.Stage)
		}
		return strings.ToLower(a.Owner+"/"+a.Name) < strings.ToLower(b.Owner+"/"+b.Name)
	})
	// The eye: which issues on the page you watch, and watches in repositories you don't track.
	if ws, ok := h.Source.(WatchSource); ok {
		p.CanWatch = true
		for _, r := range ws.OtherWatched() {
			full := r.Owner + "/" + r.Name
			for _, wr := range r.Watch {
				w := watchRow{Repo: full, Number: wr.Number, Title: wr.Title, Status: store.WatchLabel(wr.Status),
					ClaimDetail: wr.ClaimDetail, ChangedAt: wr.StatusChangedAt,
					URL: "https://github.com/" + full + "/issues/" + strconv.Itoa(wr.Number), Outside: true}
				switch w.Status {
				case "CLAIMED":
					claimed++
					claimedRepos = append(claimedRepos, fmt.Sprintf("%s#%d", r.Name, wr.Number))
				case "CLOSED_FIXED", "CLOSED_WONT":
					closed++
					closedRepos = append(closedRepos, fmt.Sprintf("%s#%d", r.Name, wr.Number))
				}
				w.Item = fmt.Sprintf("%s#%d", r.Name, wr.Number)
				p.Watch = append(p.Watch, w)
			}
		}
		markWatched(p, ws.WatchedKeys())
	}
	sort.SliceStable(p.Watch, func(i, j int) bool { return risk(p.Watch[i].Status) < risk(p.Watch[j].Status) })

	// Issues panel: most recent open issues.
	var watchedKeys map[string]bool
	if ws, ok := h.Source.(WatchSource); ok {
		watchedKeys = ws.WatchedKeys()
	}
	p.Issues, p.IssueTotal = h.buildPanelIssues(watchedKeys)

	pollFail := len(tel.Errors)
	shortName := map[string]string{}
	for _, r := range reports {
		shortName[strings.ToLower(r.Owner+"/"+r.Name)] = r.Name
	}
	var failNames, failWhy []string
	why := map[string]string{}
	for k, e := range tel.Errors {
		name := shortName[k]
		if name == "" {
			_, name, _ = strings.Cut(k, "/")
		}
		failNames = append(failNames, name)
		why[name] = e
	}
	sort.Slice(failNames, func(i, j int) bool { return strings.ToLower(failNames[i]) < strings.ToLower(failNames[j]) })
	for _, n := range failNames {
		failWhy = append(failWhy, failedLine(n, why[n]))
	}
	if tel.PRError != "" {
		pollFail++
		failNames = append(failNames, "PR search")
		failWhy = append(failWhy, failedLine("Searching for your pull requests", tel.PRError))
	}
	if p.Work.Err != "" {
		pollFail++
		failNames = append(failNames, "your work")
		failWhy = append(failWhy, failedLine("Refreshing Your work", p.Work.Err))
	}
	staleLit := lastPoll.IsZero() || now.Sub(lastPoll) > staleAfter
	staleShown := ""
	if lastPoll.IsZero() {
		staleShown = "no check yet"
	} else if staleLit {
		staleShown = ago(now, lastPoll)
	}
	apiLow := tel.RateLimit > 0 && tel.RateRemaining*10 < tel.RateLimit
	apiValue := ""
	if apiLow {
		apiValue = strconv.Itoa(tel.RateRemaining) + " left"
	}
	claimedCell := counter("watch-claimed", "Watched issue claimed", claimed, "warn", claimedRepos, true)
	claimedCell.Link = "/alerts/watched-claimed"
	closedCell := counter("watch-closed", "Watched issue closed", closed, "caution", closedRepos, false)
	closedCell.Link = "/alerts/watched-closed"
	if len(p.Watch) == 0 {
		// A zero here must only ever mean "watched and clear".
		claimedCell.Value, claimedCell.Empty = "nothing watched", true
		closedCell.Value, closedCell.Empty = "nothing watched", true
	}
	var moveNames []string
	for _, r := range append(append(append([]workRow(nil), p.Work.You...), p.Work.InYou...), p.Work.ConvYou...) {
		moveNames = append(moveNames, shortRepo(r.Repo)+"#"+strconv.Itoa(r.Number))
	}
	moveCell := counter("your-move", "Your move", p.Work.YourMove(), "caution", moveNames, true)
	moveCell.Link = "/alerts/your-move"
	moveCell.Title = "Pull requests and issues waiting on you. " + moveCell.Title
	if !p.Work.Known {
		moveCell.Value, moveCell.Empty = "not checked yet", true
	}

	failCell := counter("poll-fail", "Check failed", pollFail, "warn", failNames, false)
	failCell.Link = "/alerts/check-failed"
	if len(failWhy) > 0 {
		next := " HelloGitty tries again on the next check."
		if left := lastPoll.Add(h.PollInterval).Sub(now); !lastPoll.IsZero() && h.PollInterval > 0 && left > time.Minute {
			next = " HelloGitty tries again on the next check, in about " + plural(int(left.Minutes()+0.5), "minute") + "."
		}
		failCell.Title = strings.Join(failWhy, " ") + next
	}
	p.Cells = []cell{
		claimedCell,
		moveCell,
		failCell,
		{Key: "data-stale", Label: "Data is stale", Value: staleShown, Level: "warn", Lit: staleLit,
			Title: "Lit when the last check of GitHub is more than 2 hours old."},
		closedCell,
		withLink(counter("repo-dormant", "Repo dormant", dormant, "caution", dormantRepos, false), "/alerts/repo-dormant"),
		withLink(counter("repo-slow", "Repo slowing", slow, "caution", slowRepos, false), "/alerts/repo-slow"),
	}
	if pst != nil {
		p.Cells = append(p.Cells,
			counter("repo-flagged", pst.Labels.Flagged, flagged, "caution", flaggedRepos, false),
			counter("stage-failed", pst.Labels.Failed, failed, "caution", failedRepos, false))
	}
	p.Cells = append(p.Cells, cell{Key: "api-low", Label: "API running low", Value: apiValue, Level: "caution", Lit: apiLow,
		Title: "Lit when under 10% of the hourly GitHub quota remains."})
	if cs, ok := h.Source.(CellSource); ok {
		cleared := cs.Cleared()
		for i := range p.Watch {
			if k := p.Watch[i].CellKey(); k != "" {
				p.Watch[i].Seen = cleared[ClearedID(k, p.Watch[i].Item)]
			}
		}
		if forget := applyCleared(p.Cells, cleared, !lastPoll.IsZero() && len(reports) > 0); len(forget) > 0 {
			if err := cs.ForgetCleared(forget); err != nil {
				log.Printf("dashboard: forget cleared indicators: %v", err)
			}
		}
	}

	// Alert detail page data.
	for _, w := range p.Watch {
		switch w.Status {
		case "CLAIMED":
			if !w.Seen {
				p.ClaimedWatch = append(p.ClaimedWatch, w)
			}
		case "CLOSED_FIXED", "CLOSED_WONT":
			if !w.Seen {
				p.ClosedWatch = append(p.ClosedWatch, w)
			}
		}
	}
	p.ClaimedCount = len(p.ClaimedWatch)
	p.ClosedCount = len(p.ClosedWatch)
	for _, n := range failNames {
		p.FailedRepos = append(p.FailedRepos, failedRepo{Name: n, Error: why[n]})
	}

	return p, nil
}

// A narrow cell has room for one name in two lines; the wide cell holds three. Showing more than
// fits would let the clamp hide names the "+N" does not count.
const (
	detailNamesNarrow = 1
	detailNamesWide   = 3
)

func (h *Handler) mascot() *mascot {
	if h.Mascot == nil {
		return nil
	}
	entries, err := fs.ReadDir(h.Mascot, ".")
	if err != nil {
		return nil
	}
	m := &mascot{}
	for _, e := range entries {
		name := e.Name()
		switch {
		case strings.HasPrefix(name, "kitten-routine-") && path.Ext(name) == ".mp4":
			m.Routine = append(m.Routine, "/mascot/"+name)
		case strings.HasPrefix(name, "kitten-news-") && path.Ext(name) == ".mp4":
			m.News = append(m.News, "/mascot/"+name)
		case name == "rest.png":
			m.Rest = "/mascot/rest.png"
		}
	}
	if len(m.Routine) == 0 || m.Rest == "" {
		return nil
	}
	return m
}

func counter(key, label string, n int, level string, names []string, wide bool) cell {
	c := cell{Key: key, Label: label, Value: strconv.Itoa(n), Level: level, Lit: n > 0, Wide: wide,
		Title: strings.Join(names, ", "), Items: names}
	limit := detailNamesNarrow
	if wide {
		limit = detailNamesWide
	}
	if len(names) > limit {
		c.Detail = strings.Join(names[:limit], ", ")
		c.More = len(names) - limit
	} else {
		c.Detail = strings.Join(names, ", ")
	}
	return c
}

func withLink(c cell, link string) cell { c.Link = link; return c }

func shortRepo(full string) string {
	_, name, _ := strings.Cut(full, "/")
	return name
}

// duration reads like "1 min 26 s" rather than "86 S".
func duration(d time.Duration) string {
	s := int(d.Round(time.Second) / time.Second)
	if s < 60 {
		return strconv.Itoa(s) + " s"
	}
	if s%60 == 0 {
		return strconv.Itoa(s/60) + " min"
	}
	return strconv.Itoa(s/60) + " min " + strconv.Itoa(s%60) + " s"
}

// withBoardPRs adds your pull requests in tracked repositories that the work board has and the
// pull request search missed. GitHub's search leaves some out (impeccable#1084, merged, was one),
// and the merge rate and each repository's "Your pull requests here" would miss them.
func withBoardPRs(prs []PR, b *work.Board, reports []store.RepoReport) []PR {
	if b == nil {
		return prs
	}
	tracked, have := map[string]bool{}, map[string]bool{}
	for _, r := range reports {
		tracked[strings.ToLower(r.Owner+"/"+r.Name)] = true
	}
	for _, pr := range prs {
		have[strings.ToLower(pr.Owner+"/"+pr.Name)+"#"+strconv.Itoa(pr.Number)] = true
	}
	out := append([]PR(nil), prs...)
	for _, it := range b.Sent {
		k := strings.ToLower(it.Repo) + "#" + strconv.Itoa(it.Number)
		if !it.PR || it.Role != work.RoleAuthor || have[k] || !tracked[strings.ToLower(it.Repo)] {
			continue
		}
		owner, name, _ := strings.Cut(it.Repo, "/")
		created := it.CreatedAt
		pr := PR{Owner: owner, Name: name, Number: it.Number, Title: it.Title, URL: it.URL, State: "open", CreatedAt: &created}
		switch it.State {
		case "MERGED":
			pr.State, pr.Merged = "closed", true
		case "CLOSED":
			pr.State = "closed"
		}
		have[k] = true
		out = append(out, pr)
	}
	return out
}

func prState(pr PR) string {
	switch {
	case pr.Merged:
		return "Merged"
	case pr.State == "closed":
		return "Closed"
	default:
		return "Open"
	}
}

func risk(status string) int {
	switch status {
	case "CLAIMED":
		return 0
	case "CLOSED_FIXED", "CLOSED_WONT":
		return 1
	default:
		return 2
	}
}
