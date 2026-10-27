package poller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

const (
	claimWindow = 30 * 24 * time.Hour
	activeAge   = 30 * 24 * time.Hour
	slowAge     = 90 * 24 * time.Hour
)

var claimPhrases = []string{
	"i'll take", "i'll work", "working on this", "i'm working", "taking this", "i can do this",
	"i'd like to take", "i'd like to work on", "i would like to work on", "i want to work on",
	"can i work on", "can i take", "may i work on", "assign me", "assign this to me",
}

var maintainerAssociations = map[string]bool{"OWNER": true, "MEMBER": true, "COLLABORATOR": true}

var outsideAssociations = map[string]bool{
	"CONTRIBUTOR": true, "FIRST_TIME_CONTRIBUTOR": true, "FIRST_TIMER": true, "NONE": true, "MANNEQUIN": true,
}

type Target struct {
	Owner    string
	Name     string
	Upstream string
}

type Poller struct {
	GH    *github.Client
	Store *store.Store
	// Targets returns the repositories to poll; it is called at the start of every cycle.
	Targets           func() ([]Target, error)
	MaxIssuePages     int
	DeniedDetailLimit int
	Now               func() time.Time

	login          string
	mu             sync.Mutex
	status         Status
	commentReplies []store.CommentReply
}

// OurPR is a pull request the token's account opened in a tracked repo.
type OurPR struct {
	Owner, Name string
	Number      int
	Title       string
	URL         string
	State       string
	Merged      bool
	CreatedAt   *time.Time
	ClosedAt    *time.Time
}

// IssueTotals are exact open-issue counts for a repo whose issue list was too long to fetch
// in full; without them its counts would describe only the fetched pages.
type IssueTotals struct {
	Open, GFI, Unassigned int
}

// Status is the result of the most recent completed cycle.
type Status struct {
	Targets []Target
	// Totals holds exact counts for repos whose open issues exceeded the page cap, keyed by
	// lowercase owner/name.
	Totals        map[string]IssueTotals
	Errors        map[string]string
	LastPoll      time.Time
	CycleDuration time.Duration
	CycleRequests int64
	OurPRs        []OurPR
	PRsKnown      bool
	PRError       string
	// OpenPRs holds each repository's newest open pull requests, keyed by lowercase owner/name,
	// for the dashboard's repository tabs.
	OpenPRs map[string][]github.PullRequest
}

func (p *Poller) Status() Status {
	p.mu.Lock()
	defer p.mu.Unlock()
	st := p.status
	st.Errors = make(map[string]string, len(p.status.Errors))
	for k, v := range p.status.Errors {
		st.Errors[k] = v
	}
	st.Targets = append([]Target(nil), p.status.Targets...)
	st.OurPRs = append([]OurPR(nil), p.status.OurPRs...)
	st.Totals = make(map[string]IssueTotals, len(p.status.Totals))
	for k, v := range p.status.Totals {
		st.Totals[k] = v
	}
	return st
}

// openPRsShown is how many open pull requests per repository the dashboard lists.
const openPRsShown = 8

// PollAll polls every target once. One repo failing never stops the others.
func (p *Poller) PollAll(ctx context.Context) error {
	targets, err := p.Targets()
	if err != nil {
		return fmt.Errorf("load targets: %w", err)
	}
	cycleStart, reqStart := time.Now(), p.GH.Requests()
	p.mu.Lock()
	p.commentReplies = nil
	p.mu.Unlock()
	p.resolveLogin(ctx) // claim detection skips your own comments, so know who you are first
	errs := map[string]string{}
	totals := map[string]IssueTotals{}
	p.mu.Lock()
	open := make(map[string][]github.PullRequest, len(p.status.OpenPRs))
	for k, v := range p.status.OpenPRs {
		open[k] = v // a repository whose list can't be fetched this time keeps the last one
	}
	p.mu.Unlock()
	for _, t := range targets {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		start := time.Now()
		tot, err := p.pollRepo(ctx, t)
		if tot != nil {
			totals[strings.ToLower(t.Owner+"/"+t.Name)] = *tot
		}
		if err != nil {
			errs[strings.ToLower(t.Owner+"/"+t.Name)] = err.Error()
			log.Printf("poll %s/%s: FAILED after %s: %v", t.Owner, t.Name, time.Since(start).Round(time.Millisecond), err)
			if errors.Is(err, github.ErrRateLimited) {
				log.Printf("poll: rate limit exhausted, stopping this cycle")
				break
			}
			continue
		}
		// Who else is working here right now: one more call, and a failure costs only this list.
		if prs, err := p.GH.OpenPRs(ctx, t.Owner, t.Name, openPRsShown); err == nil {
			open[strings.ToLower(t.Owner+"/"+t.Name)] = prs
		}
		rem, lim, _ := p.GH.RateLimit()
		log.Printf("poll %s/%s: ok in %s (rate %d/%d)", t.Owner, t.Name, time.Since(start).Round(time.Millisecond), rem, lim)
	}
	p.pollLooseWatches(ctx, targets)
	prs, prErr := p.ourPRs(ctx, targets)
	if prErr == nil {
		p.pollCrossRefs(ctx, prs, targets)
	}
	// A repository removed while the cycle ran must not come back when it ends.
	if now, err := p.Targets(); err == nil {
		keep := map[string]bool{}
		for _, t := range now {
			keep[strings.ToLower(t.Owner+"/"+t.Name)] = true
		}
		kept := targets[:0:0]
		for _, t := range targets {
			if keep[strings.ToLower(t.Owner+"/"+t.Name)] {
				kept = append(kept, t)
			}
		}
		targets = kept
	}
	p.mu.Lock()
	prev := p.status
	p.status = Status{
		Targets:       targets,
		Errors:        errs,
		Totals:        totals,
		LastPoll:      p.now(),
		CycleDuration: time.Since(cycleStart),
		CycleRequests: p.GH.Requests() - reqStart,
		OurPRs:        prs,
		PRsKnown:      prErr == nil,
		OpenPRs:       open,
	}
	if prErr != nil {
		log.Printf("poll: our PRs: %v", prErr)
		p.status.PRError = prErr.Error()
		// Keep the last good list rather than showing zero PRs on a failed search.
		p.status.OurPRs, p.status.PRsKnown = prev.OurPRs, prev.PRsKnown
	}
	p.mu.Unlock()
	return nil
}

// PollOne polls one repository now, outside the cycle, and adds it to the last cycle's results so
// a repository you just added shows up without waiting for the next check.
func (p *Poller) PollOne(ctx context.Context, t Target) error {
	key := strings.ToLower(t.Owner + "/" + t.Name)
	tot, err := p.pollRepo(ctx, t)
	var prs []github.PullRequest
	if err == nil {
		prs, _ = p.GH.OpenPRs(ctx, t.Owner, t.Name, openPRsShown)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	known := false
	for _, x := range p.status.Targets {
		known = known || strings.EqualFold(x.Owner+"/"+x.Name, key)
	}
	if !known {
		p.status.Targets = append(p.status.Targets, t)
	}
	if p.status.Errors == nil {
		p.status.Errors = map[string]string{}
	}
	delete(p.status.Errors, key)
	if err != nil {
		p.status.Errors[key] = err.Error()
	}
	if tot != nil {
		if p.status.Totals == nil {
			p.status.Totals = map[string]IssueTotals{}
		}
		p.status.Totals[key] = *tot
	}
	if prs != nil {
		if p.status.OpenPRs == nil {
			p.status.OpenPRs = map[string][]github.PullRequest{}
		}
		p.status.OpenPRs[key] = prs
	}
	return err
}

// Expect sets the repositories the first cycle will check, so that until it finishes the dashboard
// shows those and not every repository the database remembers (one you removed, say).
func (p *Poller) Expect(targets []Target) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.status.Targets == nil {
		p.status.Targets = append([]Target{}, targets...)
	}
}

// pollLooseWatches checks watched issues in repositories you don't track: one issue lookup each,
// plus its recent comments while open, instead of fetching the whole repository.
func (p *Poller) pollLooseWatches(ctx context.Context, targets []Target) {
	tracked := map[string]bool{}
	for _, t := range targets {
		tracked[strings.ToLower(t.Owner+"/"+t.Name)] = true
	}
	all, err := p.Store.AllWatches()
	if err != nil {
		log.Printf("poll: watched issues: %v", err)
		return
	}
	looseRepos := map[string]store.WatchedIssue{}
	for _, w := range all {
		if ctx.Err() != nil {
			return
		}
		if tracked[strings.ToLower(w.Owner+"/"+w.Name)] {
			continue // checked with its repository
		}
		if err := p.checkWatch(ctx, w); err != nil {
			log.Printf("watch %s/%s#%d: %v", w.Owner, w.Name, w.IssueNumber, err)
		}
		looseRepos[strings.ToLower(w.Owner+"/"+w.Name)] = w
	}
	for _, w := range looseRepos {
		if ctx.Err() != nil {
			return
		}
		p.pollCommentReplies(ctx, Target{Owner: w.Owner, Name: w.Name}, w.RepoID)
	}
}

// CheckWatch checks one watched issue now, so the eye you just clicked shows its state at once.
func (p *Poller) CheckWatch(ctx context.Context, owner, name string, number int) error {
	all, err := p.Store.AllWatches()
	if err != nil {
		return err
	}
	for _, w := range all {
		if strings.EqualFold(w.Owner, owner) && strings.EqualFold(w.Name, name) && w.IssueNumber == number {
			return p.checkWatch(ctx, w)
		}
	}
	return nil
}

func (p *Poller) checkWatch(ctx context.Context, w store.WatchedIssue) error {
	p.resolveLogin(ctx)
	t := Target{Owner: w.Owner, Name: w.Name, Upstream: "https://github.com/" + w.Owner + "/" + w.Name}
	gi, err := p.GH.Issue(ctx, w.Owner, w.Name, w.IssueNumber)
	if err != nil {
		return err
	}
	now := p.now()
	row, err := p.issueRow(ctx, t, w.RepoID, *gi, true, now)
	if err != nil {
		return err
	}
	if err := p.Store.UpsertIssue(row); err != nil {
		return err
	}
	signal := row.ClaimSignal
	if row.State == "closed" && signal == "" {
		signal = "closed_wont"
	}
	if next := watchStatus(signal); next != w.Status {
		log.Printf("watch %s/%s#%d: %s -> %s", w.Owner, w.Name, w.IssueNumber, w.Status, next)
		return p.Store.SetWatchStatus(w.ID, next, now)
	}
	return nil
}

// Drop takes a repository out of the last cycle's results, so one you removed disappears now.
func (p *Poller) Drop(owner, name string) {
	key := strings.ToLower(owner + "/" + name)
	p.mu.Lock()
	defer p.mu.Unlock()
	kept := p.status.Targets[:0:0]
	for _, x := range p.status.Targets {
		if !strings.EqualFold(x.Owner+"/"+x.Name, key) {
			kept = append(kept, x)
		}
	}
	p.status.Targets = kept
	delete(p.status.Errors, key)
}

// resolveLogin learns the token's account once. A failure leaves it empty for now; ourPRs reports it.
func (p *Poller) resolveLogin(ctx context.Context) {
	if p.login != "" {
		return
	}
	if login, err := p.GH.AuthenticatedUser(ctx); err == nil {
		p.login = login
	}
}

func (p *Poller) ourPRs(ctx context.Context, targets []Target) ([]OurPR, error) {
	if p.login == "" {
		login, err := p.GH.AuthenticatedUser(ctx)
		if err != nil {
			return nil, fmt.Errorf("resolve account: %w", err)
		}
		p.login = login
	}
	found, err := p.GH.PRsByAuthor(ctx, p.login)
	if err != nil {
		return nil, err
	}
	tracked := map[string]Target{}
	for _, t := range targets {
		tracked[strings.ToLower(t.Owner+"/"+t.Name)] = t
	}
	var out []OurPR
	for _, f := range found {
		owner, name := f.Repo()
		t, ok := tracked[strings.ToLower(owner+"/"+name)]
		if !ok {
			continue
		}
		out = append(out, OurPR{
			Owner: t.Owner, Name: t.Name, Number: f.Number, Title: f.Title, URL: f.HTMLURL, State: f.State,
			Merged:    f.PullRequest != nil && f.PullRequest.MergedAt != nil,
			CreatedAt: f.CreatedAt, ClosedAt: f.ClosedAt,
		})
	}
	return out, nil
}

func (p *Poller) now() time.Time {
	if p.Now != nil {
		return p.Now().UTC()
	}
	return time.Now().UTC()
}

func (p *Poller) pollRepo(ctx context.Context, t Target) (*IssueTotals, error) {
	now := p.now()
	repoID, err := p.Store.UpsertRepo(t.Owner, t.Name, t.Upstream)
	if err != nil {
		return nil, err
	}
	lastCommit, err := p.GH.LastCommit(ctx, t.Owner, t.Name)
	if err != nil {
		return nil, fmt.Errorf("last commit: %w", err)
	}

	watch, err := p.Store.WatchList(repoID)
	if err != nil {
		return nil, err
	}
	watched := map[int]bool{}
	for _, w := range watch {
		watched[w.IssueNumber] = true
	}

	pages := p.MaxIssuePages
	if pages <= 0 {
		pages = 10
	}
	issues, complete, err := p.GH.OpenIssues(ctx, t.Owner, t.Name, pages)
	if err != nil {
		return nil, fmt.Errorf("open issues: %w", err)
	}
	signals := map[int]string{}
	openNumbers := make([]int, 0, len(issues))
	for _, gi := range issues {
		openNumbers = append(openNumbers, gi.Number)
		row, err := p.issueRow(ctx, t, repoID, gi, watched[gi.Number], now)
		if err != nil {
			return nil, fmt.Errorf("issue #%d: %w", gi.Number, err)
		}
		if err := p.Store.UpsertIssue(row); err != nil {
			return nil, err
		}
		signals[gi.Number] = row.ClaimSignal
		delete(watched, gi.Number)
	}
	var totals *IssueTotals
	var totalsErr error
	if complete {
		if err := p.Store.MarkMissingIssuesClosed(repoID, openNumbers); err != nil {
			return nil, err
		}
	} else {
		totals, totalsErr = p.exactTotals(ctx, t)
	}

	// Watched issues not in the open list are closed (or past the page cap); look them up directly.
	for number := range watched {
		gi, err := p.GH.Issue(ctx, t.Owner, t.Name, number)
		if err != nil {
			return nil, fmt.Errorf("watched issue #%d: %w", number, err)
		}
		row, err := p.issueRow(ctx, t, repoID, *gi, true, now)
		if err != nil {
			return nil, fmt.Errorf("watched issue #%d: %w", number, err)
		}
		if err := p.Store.UpsertIssue(row); err != nil {
			return nil, err
		}
		signals[number] = row.ClaimSignal
		if row.State == "closed" && row.ClaimSignal == "" {
			signals[number] = "closed_wont"
		}
	}

	for _, w := range watch {
		next := watchStatus(signals[w.IssueNumber])
		if next != w.Status {
			log.Printf("watch %s/%s#%d: %s -> %s", t.Owner, t.Name, w.IssueNumber, w.Status, next)
			if err := p.Store.SetWatchStatus(w.ID, next, now); err != nil {
				return nil, err
			}
		}
	}

	p.pollCommentReplies(ctx, t, repoID)

	if err := p.pollPRs(ctx, t, repoID); err != nil {
		return nil, fmt.Errorf("pull requests: %w", err)
	}

	if err := p.Store.SetRepoPoll(repoID, now, lastCommit, health(lastCommit, now)); err != nil {
		return totals, err
	}
	if totalsErr != nil {
		return nil, fmt.Errorf("open issues exceed %d pages and exact totals are unavailable: %w", pages, totalsErr)
	}
	return totals, nil
}

func (p *Poller) exactTotals(ctx context.Context, t Target) (*IssueTotals, error) {
	base := "repo:" + t.Owner + "/" + t.Name + " is:issue is:open"
	var tot IssueTotals
	var err error
	if tot.Open, err = p.GH.SearchCount(ctx, base); err != nil {
		return nil, err
	}
	if tot.GFI, err = p.GH.SearchCount(ctx, base+` label:"good first issue","good-first-issue","good_first_issue"`); err != nil {
		return nil, err
	}
	if tot.Unassigned, err = p.GH.SearchCount(ctx, base+" no:assignee"); err != nil {
		return nil, err
	}
	return &tot, nil
}

func (p *Poller) issueRow(ctx context.Context, t Target, repoID int64, gi github.Issue, isWatched bool, now time.Time) (store.Issue, error) {
	row := store.Issue{
		RepoID:    repoID,
		Number:    gi.Number,
		Title:     gi.Title,
		State:     gi.State,
		Labels:    jsonNames(labelNames(gi.Labels)),
		Assignees: jsonNames(userLogins(gi.Assignees)),
		Body:      gi.Body,
		CreatedAt: gi.CreatedAt,
		UpdatedAt: gi.UpdatedAt,
		ClosedAt:  gi.ClosedAt,
	}
	if gi.State == "closed" {
		if isWatched {
			fixedBy, err := p.fixedBy(ctx, t, gi.Number)
			if err != nil {
				return row, err
			}
			if fixedBy != "" {
				row.ClaimSignal, row.ClaimDetail = "closed_fixed", fixedBy
			}
		}
		_ = p.Store.RemoveOurComment(repoID, gi.Number)
		return row, nil
	}
	if len(gi.Assignees) > 0 {
		row.ClaimSignal, row.ClaimDetail = "assigned", strings.Join(userLogins(gi.Assignees), ", ")
		return row, nil
	}
	// Comment scanning costs one request per issue, so it runs for watch-list issues only.
	if isWatched {
		since := now.Add(-claimWindow)
		comments, err := p.GH.IssueComments(ctx, t.Owner, t.Name, gi.Number, &since)
		if err != nil {
			return row, err
		}
		if c := findClaim(comments, since, p.login); c != nil {
			row.ClaimSignal, row.ClaimDetail = "comment_claim", c.HTMLURL
		}
		p.recordOurComment(repoID, gi.Number, comments)
	}
	return row, nil
}

// fixedBy returns the merged PR or commit that closed an issue, or "" if it was closed without one.
func (p *Poller) fixedBy(ctx context.Context, t Target, number int) (string, error) {
	events, err := p.GH.Timeline(ctx, t.Owner, t.Name, number)
	if err != nil {
		return "", err
	}
	for _, e := range events {
		if e.Event == "cross-referenced" && e.Source != nil && e.Source.Issue != nil &&
			e.Source.Issue.PullRequest != nil && e.Source.Issue.PullRequest.MergedAt != nil {
			return e.Source.Issue.HTMLURL, nil
		}
	}
	for _, e := range events {
		if (e.Event == "closed" || e.Event == "referenced") && e.CommitID != "" {
			return fmt.Sprintf("https://github.com/%s/%s/commit/%s", t.Owner, t.Name, e.CommitID), nil
		}
	}
	return "", nil
}

func (p *Poller) pollCrossRefs(ctx context.Context, prs []OurPR, targets []Target) {
	tracked := map[string]bool{}
	for _, t := range targets {
		tracked[strings.ToLower(t.Owner+"/"+t.Name)] = true
	}
	now := p.now()
	for _, pr := range prs {
		if pr.State != "open" || !tracked[strings.ToLower(pr.Owner+"/"+pr.Name)] {
			continue
		}
		events, err := p.GH.Timeline(ctx, pr.Owner, pr.Name, pr.Number)
		if err != nil {
			log.Printf("cross-refs %s/%s#%d: %v", pr.Owner, pr.Name, pr.Number, err)
			continue
		}
		for _, e := range events {
			if e.Event != "cross-referenced" || e.Source == nil || e.Source.Issue == nil || e.Source.Issue.PullRequest == nil {
				continue
			}
			src := e.Source.Issue
			refRepo := crossRefRepo(src.HTMLURL)
			if refRepo == "" || !tracked[strings.ToLower(refRepo)] {
				continue
			}
			if strings.EqualFold(refRepo, pr.Owner+"/"+pr.Name) && src.Number == pr.Number {
				continue
			}
			author := ""
			if src.User != nil {
				author = src.User.Login
			}
			refAt := now
			if src.CreatedAt != nil {
				refAt = *src.CreatedAt
			}
			cr := store.CrossReference{
				OurRepo:   pr.Owner + "/" + pr.Name,
				OurNumber: pr.Number,
				RefRepo:   refRepo,
				RefNumber: src.Number,
				RefTitle:  src.Title,
				RefAuthor: author,
				RefURL:    src.HTMLURL,
				RefState:  strings.ToUpper(src.State),
				RefAt:     refAt,
				SeenAt:    now,
			}
			if err := p.Store.UpsertCrossReference(cr); err != nil {
				log.Printf("cross-refs upsert: %v", err)
			}
		}
	}
}

func crossRefRepo(htmlURL string) string {
	parts := strings.Split(strings.TrimPrefix(htmlURL, "https://github.com/"), "/")
	if len(parts) >= 2 {
		return parts[0] + "/" + parts[1]
	}
	return ""
}

func (p *Poller) recordOurComment(repoID int64, issueNumber int, comments []github.Comment) {
	if p.login == "" {
		return
	}
	var best github.Comment
	found := false
	for _, c := range comments {
		if strings.EqualFold(c.User.Login, p.login) && (!found || c.ID > best.ID) {
			best = c
			found = true
		}
	}
	if !found || best.CreatedAt == nil {
		return
	}
	_ = p.Store.UpsertOurComment(store.OurComment{
		RepoID:      repoID,
		IssueNumber: issueNumber,
		CommentID:   best.ID,
		CommentedAt: *best.CreatedAt,
	})
}

func (p *Poller) pollCommentReplies(ctx context.Context, t Target, repoID int64) {
	ours, err := p.Store.OurComments(repoID)
	if err != nil || len(ours) == 0 {
		return
	}
	for _, oc := range ours {
		if ctx.Err() != nil {
			return
		}
		since := oc.CommentedAt
		comments, err := p.GH.IssueComments(ctx, t.Owner, t.Name, oc.IssueNumber, &since)
		if err != nil {
			log.Printf("comment-replies %s/%s#%d: %v", t.Owner, t.Name, oc.IssueNumber, err)
			continue
		}
		for _, c := range comments {
			if c.ID <= oc.CommentID {
				continue
			}
			if strings.EqualFold(c.User.Login, p.login) || c.User.IsBot() {
				continue
			}
			at := time.Time{}
			if c.CreatedAt != nil {
				at = *c.CreatedAt
			}
			p.mu.Lock()
			p.commentReplies = append(p.commentReplies, store.CommentReply{
				Repo:              t.Owner + "/" + t.Name,
				IssueNumber:       oc.IssueNumber,
				CommentID:         c.ID,
				Author:            c.User.Login,
				AuthorAssociation: c.AuthorAssociation,
				Body:              c.Body,
				URL:               c.HTMLURL,
				At:                at,
			})
			p.mu.Unlock()
		}
	}
}

// CommentReplies returns replies to our issue comments collected during the last poll cycle.
func (p *Poller) CommentReplies() []store.CommentReply {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]store.CommentReply(nil), p.commentReplies...)
}

func (p *Poller) pollPRs(ctx context.Context, t Target, repoID int64) error {
	prs, err := p.GH.ClosedPRs(ctx, t.Owner, t.Name)
	if err != nil {
		return err
	}
	var denied []github.PullRequest
	for _, pr := range prs {
		// Dependency bots say nothing about how maintainers receive human contributions.
		if pr.User.IsBot() {
			continue
		}
		row := store.PullRequest{
			RepoID:            repoID,
			Number:            pr.Number,
			Title:             pr.Title,
			State:             pr.State,
			Merged:            pr.MergedAt != nil,
			MergedAt:          pr.MergedAt,
			ClosedAt:          pr.ClosedAt,
			AuthorAssociation: pr.AuthorAssociation,
			Body:              pr.Body,
		}
		if err := p.Store.UpsertPR(row); err != nil {
			return err
		}
		if pr.MergedAt == nil && pr.State == "closed" && outsideAssociations[pr.AuthorAssociation] {
			denied = append(denied, pr)
		}
	}
	sort.Slice(denied, func(i, j int) bool { return after(denied[i].ClosedAt, denied[j].ClosedAt) })

	limit := p.DeniedDetailLimit
	if limit <= 0 {
		limit = 10
	}
	// Closed PRs do not change, so each one's detail is fetched once and cached.
	for i, pr := range denied {
		if i == limit {
			break
		}
		done, err := p.Store.PRDetailFetched(repoID, pr.Number)
		if err != nil {
			return err
		}
		if done {
			continue
		}
		reviews, err := p.GH.Reviews(ctx, t.Owner, t.Name, pr.Number)
		if err != nil {
			return fmt.Errorf("reviews #%d: %w", pr.Number, err)
		}
		comments, err := p.GH.IssueComments(ctx, t.Owner, t.Name, pr.Number, nil)
		if err != nil {
			return fmt.Errorf("comments #%d: %w", pr.Number, err)
		}
		if err := p.Store.SetPRDetail(repoID, pr.Number, closingComment(comments, pr), reviewVerdict(reviews, pr.ClosedAt)); err != nil {
			return err
		}
	}
	return nil
}

// findClaim returns the newest comment since since that claims the issue. Your own comments
// (self) and bots' never do: asking "are you still working on this?" is not you claiming it.
func findClaim(comments []github.Comment, since time.Time, self string) *github.Comment {
	for i := len(comments) - 1; i >= 0; i-- {
		c := comments[i]
		if c.CreatedAt != nil && c.CreatedAt.Before(since) {
			continue
		}
		if c.User.IsBot() || (self != "" && strings.EqualFold(c.User.Login, self)) {
			continue
		}
		if containsClaim(c.Body) {
			return &comments[i]
		}
	}
	return nil
}

// containsClaim reports whether a comment says its author is taking the issue. It reads sentence
// by sentence, skips quoted lines, and skips questions put to someone else ("Are you still working
// on this?", "Is anyone working on it?"), which mention the work without claiming it.
func containsClaim(body string) bool {
	b := strings.ToLower(strings.NewReplacer("’", "'", "‘", "'").Replace(body))
	var kept []string
	for _, line := range strings.Split(b, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), ">") {
			kept = append(kept, line)
		}
	}
	b = strings.Join(kept, "\n")
	start := 0
	for i := 0; i <= len(b); i++ {
		if i < len(b) && !strings.ContainsRune(".!?\n", rune(b[i])) {
			continue
		}
		sentence := b[start:i]
		question := i < len(b) && b[i] == '?'
		start = i + 1
		if question && askingOthers(sentence) {
			continue
		}
		for _, phrase := range claimPhrases {
			if strings.Contains(sentence, phrase) {
				return true
			}
		}
	}
	return false
}

// askingOthers says a question is put to someone else rather than asking leave to take the issue.
func askingOthers(q string) bool {
	for _, w := range strings.Fields(q) {
		switch strings.Trim(w, ",;:@") {
		case "you", "you're", "your", "anyone", "anybody", "someone", "somebody":
			return true
		}
	}
	return false
}

// ciStickyMarkers open comments that CI actions post and keep updating, even from a
// maintainer's account; they report a check, not a reason for closing.
var ciStickyMarkers = []string{"<!-- add-pr-comment", "<!-- sticky-pull-request-comment", "<!-- codecov", "<!-- coverage"}

func isCIStatus(body string) bool {
	b := strings.ToLower(strings.TrimSpace(body))
	for _, m := range ciStickyMarkers {
		if strings.HasPrefix(b, m) {
			return true
		}
	}
	return false
}

// closingComment is the last maintainer comment at or before the PR was closed, skipping bots
// and CI status comments.
func closingComment(comments []github.Comment, pr github.PullRequest) string {
	for i := len(comments) - 1; i >= 0; i-- {
		c := comments[i]
		if !maintainerAssociations[c.AuthorAssociation] || c.User.Login == pr.User.Login || c.User.IsBot() || isCIStatus(c.Body) {
			continue
		}
		if pr.ClosedAt != nil && c.CreatedAt != nil && c.CreatedAt.After(pr.ClosedAt.Add(time.Minute)) {
			continue
		}
		return strings.TrimSpace(c.Body)
	}
	return ""
}

// reviewVerdict is the last review decision submitted before close. A bare comment review
// counts only when no decision was ever made.
func reviewVerdict(reviews []github.Review, closedAt *time.Time) string {
	verdict, commented := "", false
	for _, r := range reviews {
		if closedAt != nil && r.SubmittedAt != nil && r.SubmittedAt.After(*closedAt) {
			continue
		}
		switch r.State {
		case "APPROVED", "CHANGES_REQUESTED", "DISMISSED":
			verdict = r.State
		case "COMMENTED":
			commented = true
		}
	}
	if verdict == "" && commented {
		return "COMMENTED"
	}
	return verdict
}

func watchStatus(signal string) string {
	switch signal {
	case "assigned", "comment_claim":
		return "claimed"
	case "closed_fixed":
		return "closed_fixed"
	case "closed_wont":
		return "closed_wont"
	default:
		return "open"
	}
}

func health(lastCommit *time.Time, now time.Time) string {
	if lastCommit == nil {
		return "dormant"
	}
	switch age := now.Sub(*lastCommit); {
	case age <= activeAge:
		return "active"
	case age <= slowAge:
		return "slow"
	default:
		return "dormant"
	}
}

func after(a, b *time.Time) bool {
	if a == nil {
		return false
	}
	if b == nil {
		return true
	}
	return a.After(*b)
}

func labelNames(ls []github.Label) []string {
	out := make([]string, 0, len(ls))
	for _, l := range ls {
		out = append(out, l.Name)
	}
	return out
}

func userLogins(us []github.User) []string {
	out := make([]string, 0, len(us))
	for _, u := range us {
		out = append(out, u.Login)
	}
	return out
}

func jsonNames(names []string) string {
	b, _ := json.Marshal(names)
	return string(b)
}
