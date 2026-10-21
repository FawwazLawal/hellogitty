// Command hellogitty polls GitHub for a set of repositories and serves a local dashboard.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	iofs "io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/FawwazLawal/hellogitty/docs"
	"github.com/FawwazLawal/hellogitty/internal/config"
	"github.com/FawwazLawal/hellogitty/internal/dashboard"
	"github.com/FawwazLawal/hellogitty/internal/github"
	"github.com/FawwazLawal/hellogitty/internal/inbox"
	"github.com/FawwazLawal/hellogitty/internal/notify"
	"github.com/FawwazLawal/hellogitty/internal/overlap"
	"github.com/FawwazLawal/hellogitty/internal/pipeline"
	"github.com/FawwazLawal/hellogitty/internal/poller"
	"github.com/FawwazLawal/hellogitty/internal/snapshot"
	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
	"github.com/FawwazLawal/hellogitty/web"
)

const usage = `HelloGitty polls GitHub for the repositories you follow and serves a local dashboard.

Usage:
  hellogitty [flags]                       run the poller and the dashboard
  hellogitty watch owner/name 123 [456]    watch issues for claims and fixes
  hellogitty watch                         list watched issues
  hellogitty unwatch owner/name 123 [456]  stop watching issues

Repositories come from a config file (default ./hellogitty.json) or from -repos.
GITHUB_TOKEN must hold a GitHub token; read-only access is enough.

Flags:
`

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	if len(os.Args) > 1 && os.Args[1] == "watch" {
		if err := runWatch(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, "hellogitty watch:", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "unwatch" {
		if err := runUnwatch(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, "hellogitty unwatch:", err)
			os.Exit(1)
		}
		return
	}
	os.Exit(run())
}

type common struct {
	config *string
	repos  *string
}

func commonFlags(fs *flag.FlagSet) common {
	return common{
		config: fs.String("config", config.DefaultFile, "path to the config file"),
		repos:  fs.String("repos", "", "comma-separated owner/name list, added to the config file's repos"),
	}
}

// load reads the config file, falling back to flags alone when the default file is absent.
func (c common) load(fs *flag.FlagSet) (*config.Config, error) {
	explicit := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "config" {
			explicit = true
		}
	})
	cfg, err := config.Load(*c.config)
	if errors.Is(err, os.ErrNotExist) && !explicit {
		cfg, err = config.Default(".")
	}
	if err != nil {
		return nil, err
	}
	for _, r := range strings.Split(*c.repos, ",") {
		if r = strings.TrimSpace(r); r != "" {
			if _, err := config.ParseRepo(r); err != nil {
				return nil, err
			}
			cfg.Repos = append(cfg.Repos, r)
		}
	}
	if _, err := cfg.Targets(); err != nil {
		return nil, fmt.Errorf("%w: add \"repos\" to %s or pass -repos owner/name", err, config.DefaultFile)
	}
	return cfg, nil
}

func run() int {
	fs := flag.NewFlagSet("hellogitty", flag.ContinueOnError)
	fs.Usage = func() { fmt.Fprint(fs.Output(), usage); fs.PrintDefaults() }
	cf := commonFlags(fs)
	listen := fs.String("listen", "", "dashboard address, loopback only (default from config, else "+config.DefaultListen+")")
	interval := fs.Duration("interval", 0, "poll interval (default from config, else 60m)")
	once := fs.Bool("once", false, "poll once, write the snapshot and the inbox, and exit")
	showVersion := fs.Bool("version", false, "print the version and exit")
	if err := fs.Parse(os.Args[1:]); err != nil {
		return 2
	}
	if *showVersion {
		fmt.Println(versionLine())
		return 0
	}
	cfg, err := cf.load(fs)
	if err != nil {
		fmt.Fprintln(os.Stderr, "hellogitty:", err)
		return 2
	}
	if *listen != "" {
		cfg.Listen = *listen
	}
	if *interval > 0 {
		cfg.PollInterval = *interval
	}

	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		fmt.Fprintln(os.Stderr, "hellogitty: GITHUB_TOKEN is not set. Export a read-only GitHub token and start again.")
		return 2
	}

	st, err := store.Open(cfg.Path(cfg.Database))
	if err != nil {
		log.Printf("open database: %v", err)
		return 1
	}
	defer st.Close()

	gh := github.New(token)
	pl := &poller.Poller{GH: gh, Store: st, Targets: func() ([]poller.Target, error) {
		repos, err := cfg.Targets()
		if err != nil {
			return nil, err
		}
		out := make([]poller.Target, 0, len(repos))
		for _, r := range repos {
			out = append(out, poller.Target{Owner: r.Owner, Name: r.Name, Upstream: "https://github.com/" + r.String()})
		}
		return out, nil
	}}
	pipe := &pipeline.Provider{Command: cfg.PipelineCommand(), Dir: cfg.Dir}
	board := &work.Tracker{GH: gh, Maintain: cfg.Maintain}
	feed := &notify.Feed{GH: gh}
	// Pull requests you opened appear in your notifications even when GitHub's search misses them.
	// Any pull request thread is a candidate (a mention on your own closed pull request, say); the
	// lookup keeps only yours and remembers the rest.
	board.Extra = func() []work.IssueRef {
		var refs []work.IssueRef
		for _, n := range feed.Snapshot().Items {
			if n.Kind == "PullRequest" && n.Number > 0 {
				refs = append(refs, work.IssueRef{Repo: n.Repo, Number: n.Number})
			}
		}
		return refs
	}
	ov := &overlap.Watcher{GH: gh, Store: st}
	checkOverlap := overlapChecker(ov, st, pl, pipe, board)
	src := source{st: st, p: pl, gh: gh, pipe: pipe, board: board, feed: feed, ov: ov}
	writeInbox := inboxWriter(cfg.Path(cfg.Inbox), src)
	snapPath := cfg.Path(cfg.Snapshot)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cycle := func() (failed int) {
		start := time.Now()
		if err := pl.PollAll(ctx); err != nil {
			log.Printf("poll cycle: %v", err)
		}
		if err := writeSnapshot(st, pl, snapPath, cfg.PollInterval); err != nil {
			log.Printf("write snapshot: %v", err)
			failed++
		}
		ps := pl.Status()
		rem, lim, _ := gh.RateLimit()
		log.Printf("poll cycle done in %s: %d repos, %d failed, %d requests, %d of your PRs, rate %d/%d",
			time.Since(start).Round(time.Second), len(ps.Targets), len(ps.Errors), ps.CycleRequests, len(ps.OurPRs), rem, lim)
		return failed + len(ps.Errors)
	}

	if *once {
		failed := cycle()
		if cfg.Inbox != "" {
			if err := board.Refresh(ctx); err != nil {
				log.Printf("work board: %v", err)
				failed++
			}
			checkOverlap(ctx)
			writeInbox()
		}
		if failed > 0 {
			return 1
		}
		return 0
	}

	if err := requireLoopback(cfg.Listen); err != nil {
		log.Print(err)
		return 1
	}
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		log.Printf("listen %s: %v", cfg.Listen, err)
		return 1
	}
	versionLabel, versionBaby := dashboardVersion()
	mascotFS, err := iofs.Sub(web.Mascot, "mascot")
	if err != nil {
		log.Printf("mascot assets: %v", err)
		return 1
	}
	srv := &http.Server{
		Handler: &dashboard.Handler{
			Template:     web.Index,
			SnapshotPath: snapPath,
			Source:       src,
			PollInterval: cfg.PollInterval,
			Version:      versionLabel,
			Baby:         versionBaby,
			Mascot:       mascotFS,
			HelpTemplate: web.Help,
			FeedTemplate: web.Feed,
			Guide:        docs.Guide,
			Screenshot:   docs.Screenshot,
			About:        aboutInstall(cfg),
		},
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("%s: dashboard on http://%s", versionLine(), cfg.Listen)
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("http: %v", err)
			stop()
		}
	}()

	// GitHub notifications, for the new-activity dots: about once a minute, as GitHub asks. An
	// unchanged inbox answers 304, which costs no quota.
	// The first fetch happens before the work board's, so its missed-PR lookup has something to use.
	if err := feed.Refresh(ctx); err != nil {
		log.Printf("notifications: %v", err)
	}
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(feed.Interval()):
			}
			if err := feed.Refresh(ctx); err != nil {
				log.Printf("notifications: %v", err)
			}
		}
	}()

	// The work board is one GraphQL request, so it refreshes far more often than the repo poll.
	go func() {
		ticker := time.NewTicker(workRefresh)
		defer ticker.Stop()
		var checked time.Time
		for {
			if err := board.Refresh(ctx); err != nil {
				log.Printf("work board: %v", err)
			} else if b, _ := board.Snapshot(); b != nil {
				log.Printf("work board: %d sent, %d incoming, %d GraphQL points (%d left)", len(b.Sent), len(b.Incoming), b.Cost, b.Remaining)
			}
			if time.Since(checked) >= overlapRefresh-time.Minute {
				checked = time.Now()
				checkOverlap(ctx)
			}
			writeInbox()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()

	go func() {
		ticker := time.NewTicker(cfg.PollInterval)
		defer ticker.Stop()
		for {
			cycle()
			writeInbox()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()

	<-ctx.Done()
	log.Print("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	return 0
}

func writeSnapshot(st *store.Store, pl *poller.Poller, path string, interval time.Duration) error {
	reports, err := tracked(st, pl)
	if err != nil {
		return err
	}
	return snapshot.Write(path, snapshot.Build(reports, time.Now(), interval))
}

func tracked(st *store.Store, pl *poller.Poller) ([]store.RepoReport, error) {
	reports, err := st.Report(snapshot.DeniedSampleSize)
	if err != nil {
		return nil, err
	}
	ps := pl.Status()
	applyTotals(reports, ps.Totals)
	if ps.Targets == nil {
		return reports, nil
	}
	keys := make([]snapshot.Key, 0, len(ps.Targets))
	for _, t := range ps.Targets {
		keys = append(keys, snapshot.Key{Owner: t.Owner, Name: t.Name})
	}
	return snapshot.Filter(reports, keys), nil
}

// applyTotals replaces counts computed from a capped issue fetch with the exact totals.
func applyTotals(reports []store.RepoReport, totals map[string]poller.IssueTotals) {
	for i := range reports {
		if t, ok := totals[strings.ToLower(reports[i].Owner+"/"+reports[i].Name)]; ok {
			reports[i].OpenIssuesTotal, reports[i].OpenIssuesGFI, reports[i].OpenIssuesUnassigned = t.Open, t.GFI, t.Unassigned
		}
	}
}

// inboxWriter returns a function that rewrites the inbox file from the latest work board, watch
// list, overlap reports and new issues, or does nothing when no inbox is configured. Both loops call
// it; the mutex keeps one write at a time, and the file itself is replaced atomically. Nothing is
// written before the first board and the first overlap check, so a fresh start never replaces a full
// inbox with a partial one.
func inboxWriter(path string, src source) func() {
	if path == "" {
		return func() {}
	}
	var mu sync.Mutex
	return func() {
		mu.Lock()
		defer mu.Unlock()
		now := time.Now().UTC()
		entries, ok := src.entries(now)
		if !ok {
			return
		}
		f := inbox.File{GeneratedAt: now, PollIntervalMinutes: int(workRefresh / time.Minute), Entries: entries}
		if err := inbox.Write(path, f); err != nil {
			log.Printf("inbox: %v", err)
			return
		}
		log.Printf("inbox: %d entries written to %s", len(entries), path)
	}
}

// aboutInstall lists the files and settings in use, for Help → About this install.
func aboutInstall(cfg *config.Config) []dashboard.AboutItem {
	optional := func(path string) string {
		if path == "" {
			return "not set"
		}
		return cfg.Path(path)
	}
	repos := strconv.Itoa(len(cfg.Repos)) + " listed in the config"
	if cfg.ReposFile != "" {
		repos += ", plus " + cfg.Path(cfg.ReposFile) + " (re-read every check)"
	}
	pipe := "not set"
	if len(cfg.Pipeline) > 0 {
		pipe = "set"
	}
	return []dashboard.AboutItem{
		{Key: "Config folder", Value: cfg.Dir},
		{Key: "Dashboard address", Value: "http://" + cfg.Listen},
		{Key: "Checks repositories every", Value: strconv.Itoa(int(cfg.PollInterval/time.Minute)) + " minutes"},
		{Key: "Tracked repositories", Value: repos},
		{Key: "Database", Value: cfg.Path(cfg.Database)},
		{Key: "Snapshot file", Value: cfg.Path(cfg.Snapshot)},
		{Key: "Inbox file", Value: optional(cfg.Inbox)},
		{Key: "Pipeline command", Value: pipe},
	}
}

// overlapChecker returns a function that checks the issues you plan to work on, and the issues
// your open pull requests fix, for someone else's work. It waits for the first work board, which
// says who you are and which issues your pull requests fix.
func overlapChecker(ov *overlap.Watcher, st *store.Store, pl *poller.Poller, pipe *pipeline.Provider, board *work.Tracker) func(context.Context) {
	return func(ctx context.Context) {
		b, _ := board.Snapshot()
		if b == nil {
			return
		}
		ps, err := pipe.Get(ctx)
		if err != nil {
			log.Printf("overlap: %v", err) // ps is the last good answer, if there was one
		}
		reports, err := tracked(st, pl)
		if err != nil {
			log.Printf("overlap: %v", err)
		}
		targets := overlapTargets(ps, reports, b)
		res, err := ov.Run(ctx, b.Login, targets)
		if err != nil {
			log.Printf("overlap: %v", err)
		}
		if len(res.Skipped) > 0 {
			log.Printf("overlap: GitHub has no issue %s", strings.Join(res.Skipped, ", "))
		}
		for _, o := range res.Reported {
			log.Printf("overlap: reported %s#%d %s: %s", o.Repo, o.Number, o.Signal, o.Summary)
		}
		log.Printf("overlap: %d of %d issues checked, %d new reports, %d GraphQL points (%d left)",
			res.Checked, len(targets), len(res.Reported), res.Cost, res.Remaining)
	}
}

// overlapTargets merges the pipeline's watch list, the open issues on the watch list, and the
// issues your open pull requests fix, one target per issue.
func overlapTargets(ps *pipeline.State, reports []store.RepoReport, b *work.Board) []overlap.Target {
	var out []overlap.Target
	at := map[string]int{}
	add := func(repo string, n int, title string) *overlap.Target {
		k := overlap.Key(repo, n)
		if i, ok := at[k]; ok {
			return &out[i]
		}
		at[k] = len(out)
		out = append(out, overlap.Target{Repo: repo, Number: n, Title: title})
		return &out[len(out)-1]
	}
	if ps != nil {
		for _, w := range ps.Watch {
			add(w.Repo, w.Number, w.Title)
		}
	}
	for _, r := range reports {
		for _, w := range r.Watch {
			if store.WatchLabel(w.Status) == "STILL_OPEN" {
				add(r.Owner+"/"+r.Name, w.Number, w.Title)
			}
		}
	}
	for _, it := range b.Sent {
		if !it.PR || it.Role != work.RoleAuthor || it.State != "OPEN" {
			continue
		}
		for _, f := range it.Fixes {
			t := add(f.Repo, f.Number, "")
			t.OurPRs = append(t.OurPRs, it.Number)
		}
	}
	return out
}

// overlapRefresh is how often the overlap check runs, on the work board's schedule.
const overlapRefresh = 15 * time.Minute

// workRefresh is how often the work board is fetched. The page reloads every 5 minutes.
const workRefresh = 5 * time.Minute

type source struct {
	st    *store.Store
	p     *poller.Poller
	gh    *github.Client
	pipe  *pipeline.Provider
	board *work.Tracker
	feed  *notify.Feed
	ov    *overlap.Watcher
}

// OverlapReports returns the overlap reports for issues still being watched, for the row peeks.
func (s source) OverlapReports() []store.Overlap {
	watching, ready := s.ov.Watching()
	if !ready {
		return nil
	}
	rows, err := s.st.Overlaps()
	if err != nil {
		return nil
	}
	var out []store.Overlap
	for _, o := range rows {
		if watching[overlap.Key(o.Repo, o.Number)] {
			out = append(out, o)
		}
	}
	return out
}

func (s source) Notifications() notify.View { return s.feed.Snapshot() }

func (s source) Work() (*work.Board, string) { return s.board.Snapshot() }

func (s source) Reports() ([]store.RepoReport, error) { return tracked(s.st, s.p) }

func (s source) Pipeline() (*pipeline.State, error) { return s.pipe.Get(context.Background()) }

func (s source) Telemetry() dashboard.Telemetry {
	ps := s.p.Status()
	rem, lim, reset := s.gh.RateLimit()
	t := dashboard.Telemetry{
		LastPoll: ps.LastPoll, Errors: ps.Errors, CycleDuration: ps.CycleDuration, CycleRequests: ps.CycleRequests,
		RateRemaining: rem, RateLimit: lim, RateReset: reset, PRsKnown: ps.PRsKnown, PRError: ps.PRError,
	}
	for _, pr := range ps.OurPRs {
		t.OurPRs = append(t.OurPRs, dashboard.PR{Owner: pr.Owner, Name: pr.Name, Number: pr.Number, Title: pr.Title,
			URL: pr.URL, State: pr.State, Merged: pr.Merged, CreatedAt: pr.CreatedAt})
	}
	return t
}

func requireLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("bad listen address %q: %v", addr, err)
	}
	if host == "localhost" {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf("listen address %q is not a loopback address; the dashboard is local-only", addr)
}

// runWatch adds issues to the watch list, or lists it when given no issues.
func runWatch(args []string) error {
	fs := flag.NewFlagSet("watch", flag.ContinueOnError)
	cf := commonFlags(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := cf.load(fs)
	if err != nil {
		return err
	}
	st, err := store.Open(cfg.Path(cfg.Database))
	if err != nil {
		return err
	}
	defer st.Close()

	if fs.NArg() == 0 {
		reports, err := st.Report(0)
		if err != nil {
			return err
		}
		for _, r := range reports {
			for _, w := range r.Watch {
				fmt.Printf("%s/%s#%d\t%s\t%s\n", r.Owner, r.Name, w.Number, store.WatchLabel(w.Status), w.Title)
			}
		}
		return nil
	}
	if fs.NArg() < 2 {
		return errors.New("usage: hellogitty watch owner/name 123 [456 ...]")
	}
	want, err := config.ParseRepo(fs.Arg(0))
	if err != nil {
		return err
	}
	targets, err := cfg.Targets()
	if err != nil {
		return err
	}
	var repo *config.Repo
	for i := range targets {
		if strings.EqualFold(targets[i].String(), want.String()) {
			repo = &targets[i]
		}
	}
	if repo == nil {
		return fmt.Errorf("%s is not in your configured repositories, so it would never be polled", want)
	}
	numbers, err := issueNumbers(fs.Args()[1:])
	if err != nil {
		return err
	}
	id, err := st.UpsertRepo(repo.Owner, repo.Name, "https://github.com/"+repo.String())
	if err != nil {
		return err
	}
	for _, n := range numbers {
		if err := st.AddWatch(id, n); err != nil {
			return err
		}
		fmt.Printf("watching %s#%d (checked on the next poll)\n", repo, n)
	}
	return nil
}

// runUnwatch removes issues from the watch list. The repository need not still be configured,
// so watches left behind by a repository you stopped following can be cleared too.
func runUnwatch(args []string) error {
	fs := flag.NewFlagSet("unwatch", flag.ContinueOnError)
	cf := commonFlags(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 2 {
		return errors.New("usage: hellogitty unwatch owner/name 123 [456 ...]")
	}
	want, err := config.ParseRepo(fs.Arg(0))
	if err != nil {
		return err
	}
	numbers, err := issueNumbers(fs.Args()[1:])
	if err != nil {
		return err
	}
	cfg, err := cf.load(fs)
	if err != nil {
		return err
	}
	st, err := store.Open(cfg.Path(cfg.Database))
	if err != nil {
		return err
	}
	defer st.Close()
	return unwatch(st, want, numbers, os.Stdout)
}

func unwatch(st *store.Store, want config.Repo, numbers []int, out io.Writer) error {
	repo, err := st.RepoByName(want.Owner, want.Name)
	if err != nil {
		return err
	}
	if repo != nil {
		want = config.Repo{Owner: repo.Owner, Name: repo.Name}
	}
	for _, n := range numbers {
		removed := false
		if repo != nil {
			if removed, err = st.RemoveWatch(repo.ID, n); err != nil {
				return err
			}
		}
		if removed {
			fmt.Fprintf(out, "stopped watching %s#%d\n", want, n)
		} else {
			fmt.Fprintf(out, "not watching %s#%d, nothing to remove\n", want, n)
		}
	}
	return nil
}

// issueNumbers parses issue numbers ("123" or "#123"), rejecting the whole list on the first bad
// one so a typo never applies half a command.
func issueNumbers(args []string) ([]int, error) {
	out := make([]int, 0, len(args))
	for _, a := range args {
		n, err := strconv.Atoi(strings.TrimPrefix(a, "#"))
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("bad issue number %q", a)
		}
		out = append(out, n)
	}
	return out, nil
}
