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
}

type page struct {
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
	PRs                   []prRow
}

type watchRow struct {
	Repo        string
	Number      int
	Title       string
	Status      string
	ClaimDetail string
	ChangedAt   *time.Time
	URL         string
}

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
}

var funcs = template.FuncMap{
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

	board, workErr := h.Source.Work()
	p.Work = buildWork(board, workErr, now)

	notesURL := func(owner, name string) string {
		if r, ok := pst.Repo(owner, name); ok && r.Notes != "" {
			return "/notes/" + owner + "/" + name
		}
		return ""
	}

	prsByRepo := map[string][]prRow{}
	pl := pipelineView{Known: tel.PRsKnown, Err: tel.PRError}
	for _, pr := range tel.OurPRs {
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
	if len(pl.PRs) > 10 {
		pl.PRs = pl.PRs[:10]
	}

	var counts []int
	if pst != nil {
		counts = make([]int, len(pst.Stages))
	}
	stageIdx := func(stage string) int { return pst.StageIndex(stage) }

	var claimed, closed, dormant, slow, flagged, failed int
	var claimedRepos, dormantRepos, slowRepos, flaggedRepos, failedRepos []string
	for _, r := range reports {
		full := r.Owner + "/" + r.Name
		rw := row{
			Key: strings.ToLower(full), Owner: r.Owner, Name: r.Name, URL: "https://github.com/" + full,
			Health: store.HealthLabel(r.Repo),
			Open:   r.OpenIssuesTotal, GFI: r.OpenIssuesGFI, Unassigned: r.OpenIssuesUnassigned,
			DeniedTotal: r.DeniedPRsTotal, Error: tel.Errors[strings.ToLower(full)],
			PRs: prsByRepo[strings.ToLower(full)], NotesURL: notesURL(r.Owner, r.Name),
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
			}
			rw.Watch = append(rw.Watch, w)
			p.Watch = append(p.Watch, w)
		}
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
	sort.SliceStable(p.Watch, func(i, j int) bool { return risk(p.Watch[i].Status) < risk(p.Watch[j].Status) })

	pollFail := len(tel.Errors)
	shortName := map[string]string{}
	for _, r := range reports {
		shortName[strings.ToLower(r.Owner+"/"+r.Name)] = r.Name
	}
	var failNames []string
	for k := range tel.Errors {
		name := shortName[k]
		if name == "" {
			_, name, _ = strings.Cut(k, "/")
		}
		failNames = append(failNames, name)
	}
	sort.Slice(failNames, func(i, j int) bool { return strings.ToLower(failNames[i]) < strings.ToLower(failNames[j]) })
	if tel.PRError != "" {
		pollFail++
		failNames = append(failNames, "PR search")
	}
	if p.Work.Err != "" {
		pollFail++
		failNames = append(failNames, "your work")
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
	closedCell := counter("watch-closed", "Watched issue closed", closed, "caution", nil, false)
	if len(p.Watch) == 0 {
		// A zero here must only ever mean "watched and clear".
		claimedCell.Value, claimedCell.Empty = "nothing watched", true
		closedCell.Value, closedCell.Empty = "nothing watched", true
	}
	var moveNames []string
	for _, r := range append(append([]workRow(nil), p.Work.You...), p.Work.InYou...) {
		moveNames = append(moveNames, shortRepo(r.Repo)+"#"+strconv.Itoa(r.Number))
	}
	moveCell := counter("your-move", "Your move", p.Work.YourMove(), "caution", moveNames, true)
	moveCell.Title = "Pull requests and issues waiting on you. " + moveCell.Title
	if !p.Work.Known {
		moveCell.Value, moveCell.Empty = "not checked yet", true
	}

	p.Cells = []cell{
		claimedCell,
		moveCell,
		counter("poll-fail", "Check failed", pollFail, "warn", failNames, false),
		{Key: "data-stale", Label: "Data is stale", Value: staleShown, Level: "warn", Lit: staleLit,
			Title: "Lit when the last check of GitHub is more than 2 hours old."},
		closedCell,
		counter("repo-dormant", "Repo dormant", dormant, "caution", dormantRepos, false),
		counter("repo-slow", "Repo slowing", slow, "caution", slowRepos, false),
	}
	if pst != nil {
		p.Cells = append(p.Cells,
			counter("repo-flagged", pst.Labels.Flagged, flagged, "caution", flaggedRepos, false),
			counter("stage-failed", pst.Labels.Failed, failed, "caution", failedRepos, false))
	}
	p.Cells = append(p.Cells, cell{Key: "api-low", Label: "API running low", Value: apiValue, Level: "caution", Lit: apiLow,
		Title: "Lit when under 10% of the hourly GitHub quota remains."})
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
		Title: strings.Join(names, ", ")}
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
