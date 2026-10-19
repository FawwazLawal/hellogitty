// Command hellogitty polls GitHub for a set of repositories and serves a local dashboard.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/config"
	"github.com/FawwazLawal/hellogitty/internal/dashboard"
	"github.com/FawwazLawal/hellogitty/internal/github"
	"github.com/FawwazLawal/hellogitty/internal/pipeline"
	"github.com/FawwazLawal/hellogitty/internal/poller"
	"github.com/FawwazLawal/hellogitty/internal/snapshot"
	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/web"
)

const usage = `HelloGitty polls GitHub for the repositories you follow and serves a local dashboard.

Usage:
  hellogitty [flags]                       run the poller and the dashboard
  hellogitty watch owner/name 123 [456]    watch issues for claims and fixes
  hellogitty watch                         list watched issues

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
	once := fs.Bool("once", false, "poll once, write the snapshot, and exit")
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
		if cycle() > 0 {
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
	srv := &http.Server{
		Handler: &dashboard.Handler{
			Template:     web.Index,
			SnapshotPath: snapPath,
			Source:       source{st: st, p: pl, gh: gh, pipe: pipe},
			PollInterval: cfg.PollInterval,
			Version:      versionLabel,
			Baby:         versionBaby,
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

	go func() {
		ticker := time.NewTicker(cfg.PollInterval)
		defer ticker.Stop()
		for {
			cycle()
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
	targets := pl.Status().Targets
	if targets == nil {
		return reports, nil
	}
	keys := make([]snapshot.Key, 0, len(targets))
	for _, t := range targets {
		keys = append(keys, snapshot.Key{Owner: t.Owner, Name: t.Name})
	}
	return snapshot.Filter(reports, keys), nil
}

type source struct {
	st   *store.Store
	p    *poller.Poller
	gh   *github.Client
	pipe *pipeline.Provider
}

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
	id, err := st.UpsertRepo(repo.Owner, repo.Name, "https://github.com/"+repo.String())
	if err != nil {
		return err
	}
	for _, a := range fs.Args()[1:] {
		n, err := strconv.Atoi(strings.TrimPrefix(a, "#"))
		if err != nil || n <= 0 {
			return fmt.Errorf("bad issue number %q", a)
		}
		if err := st.AddWatch(id, n); err != nil {
			return err
		}
		fmt.Printf("watching %s#%d (checked on the next poll)\n", repo, n)
	}
	return nil
}
