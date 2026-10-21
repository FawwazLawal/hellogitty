package overlap

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

// chunk is how many issues go in one request. Each costs two small searches plus the issue, so a
// request of 20 stays far below GitHub's per-query limits.
const chunk = 20

const fragments = `
fragment pr on PullRequest {
  number title url state createdAt mergedAt
  author { login __typename }
  repository { nameWithOwner }
}
fragment facts on Issue {
  number title state stateReason closedAt
  assignees(first: 10) { nodes { login } }
  closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { ...pr } }
  timelineItems(last: 50, itemTypes: [CROSS_REFERENCED_EVENT, ASSIGNED_EVENT, CLOSED_EVENT]) { nodes { __typename
    ... on CrossReferencedEvent { source { __typename ...pr } }
    ... on AssignedEvent { createdAt assignee { __typename ... on User { login } ... on Bot { login } } }
    ... on ClosedEvent { actor { login } closer { __typename ...pr } } } }
  comments(last: 30) { nodes { url createdAt body author { login __typename } } }
}`

// Watcher checks targets and records what it reports.
type Watcher struct {
	GH    *github.Client
	Store *store.Store
	Now   func() time.Time

	mu       sync.Mutex
	watching map[string]bool
	ready    bool
}

// Result is what one run did.
type Result struct {
	Checked   int             // issues GitHub answered for
	Skipped   []string        // issues GitHub could not resolve
	Reported  []store.Overlap // new reports this run
	Cost      int             // GraphQL points spent
	Remaining int
}

// Watching returns the issues of the latest run, by Key, and whether a run has happened yet.
func (w *Watcher) Watching() (map[string]bool, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.watching, w.ready
}

var safeName = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

// Run checks every target once and records anything newly worth reporting.
func (w *Watcher) Run(ctx context.Context, login string, targets []Target) (Result, error) {
	now := time.Now().UTC()
	if w.Now != nil {
		now = w.Now()
	}
	var res Result
	watching := map[string]bool{}
	var valid []Target
	for _, t := range targets {
		if !safeName.MatchString(t.Repo) || t.Number <= 0 {
			res.Skipped = append(res.Skipped, t.Repo+"#"+strconv.Itoa(t.Number))
			continue
		}
		watching[Key(t.Repo, t.Number)] = true
		valid = append(valid, t)
	}

	w.mu.Lock()
	w.watching, w.ready = watching, true
	w.mu.Unlock()

	rows, err := w.Store.Overlaps()
	if err != nil {
		return res, err
	}
	prior := map[string]*Prior{}
	for _, o := range rows {
		k := Key(o.Repo, o.Number)
		if prior[k] == nil {
			prior[k] = &Prior{}
		}
		if o.Hard {
			prior[k].Hard = append(prior[k].Hard, o.Signal)
		} else {
			prior[k].Soft = append(prior[k].Soft, o.Signal)
		}
	}

	var errs []error
	for start := 0; start < len(valid); start += chunk {
		part := valid[start:min(start+chunk, len(valid))]
		facts, cost, remaining, skipped, err := w.fetch(ctx, part)
		res.Cost += cost
		if remaining > 0 {
			res.Remaining = remaining
		}
		res.Skipped = append(res.Skipped, skipped...)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		for _, t := range part {
			f, ok := facts[Key(t.Repo, t.Number)]
			if !ok {
				continue
			}
			res.Checked++
			p := Prior{}
			if pp := prior[Key(t.Repo, t.Number)]; pp != nil {
				p = *pp
			}
			s := Choose(Signals(f, t, login, now), p)
			if s == nil {
				continue
			}
			o := store.Overlap{Repo: f.Repo, Number: f.Number, Signal: s.ID, Hard: s.Hard, Actor: s.Actor, URL: s.URL,
				Summary: s.Summary, OccurredAt: s.At, ReportedAt: now}
			if err := w.Store.AddOverlap(o); err != nil {
				errs = append(errs, err)
				continue
			}
			res.Reported = append(res.Reported, o)
		}
	}

	return res, errors.Join(errs...)
}

// fetch asks for the issues in one request, then for the pull requests near them in a second,
// because the subject search needs each issue's real title.
func (w *Watcher) fetch(ctx context.Context, ts []Target) (map[string]Facts, int, int, []string, error) {
	var q strings.Builder
	q.WriteString("query {\n  rateLimit { cost remaining }\n")
	for i, t := range ts {
		owner, name, _ := strings.Cut(t.Repo, "/")
		fmt.Fprintf(&q, "  i%d: repository(owner: %q, name: %q) { issue(number: %d) { ...facts } }\n", i, owner, name, t.Number)
		fmt.Fprintf(&q, "  c%d: search(type: ISSUE, first: 10, query: %q) { nodes { __typename ...pr } }\n", i,
			"repo:"+t.Repo+" is:pr "+strconv.Itoa(t.Number)+" in:title")
	}
	q.WriteString("}\n" + fragments)

	var data map[string]json.RawMessage
	cost, remaining, partial, err := w.query(ctx, q.String(), &data)
	if err != nil {
		return nil, cost, remaining, nil, err
	}

	out := map[string]Facts{}
	var skipped []string
	for i, t := range ts {
		var repo struct {
			Issue *issueNode `json:"issue"`
		}
		if raw := data["i"+strconv.Itoa(i)]; len(raw) > 0 {
			json.Unmarshal(raw, &repo)
		}
		if repo.Issue == nil {
			skipped = append(skipped, t.Repo+"#"+strconv.Itoa(t.Number))
			continue
		}
		f := repo.Issue.facts(t.Repo)
		var cites searchNodes
		json.Unmarshal(data["c"+strconv.Itoa(i)], &cites)
		mention := citePattern(t.Number)
		for _, n := range cites.Nodes {
			if n.Typename == "PullRequest" && mention.MatchString(n.Title) {
				f.PRs = addPR(f.PRs, n.pr(true))
			}
		}
		out[Key(t.Repo, t.Number)] = f
	}
	if partial != nil && len(out) == 0 {
		return nil, cost, remaining, skipped, partial
	}

	// The subject search, for the issues that have a title with at least two words to match.
	q.Reset()
	q.WriteString("query {\n  rateLimit { cost remaining }\n")
	asked := 0
	for i, t := range ts {
		f, ok := out[Key(t.Repo, t.Number)]
		if !ok {
			continue
		}
		words := Keywords(f.Title)
		if len(words) < 2 {
			continue
		}
		asked++
		fmt.Fprintf(&q, "  s%d: search(type: ISSUE, first: 20, query: %q) { nodes { __typename ...pr } }\n", i,
			"repo:"+t.Repo+" is:pr in:title "+strings.Join(words, " OR "))
	}
	if asked == 0 {
		return out, cost, remaining, skipped, nil
	}
	q.WriteString("}\n" + fragments[:strings.Index(fragments, "fragment facts")])
	var similar map[string]json.RawMessage
	c2, r2, _, err := w.query(ctx, q.String(), &similar)
	cost += c2
	if r2 > 0 {
		remaining = r2
	}
	if err != nil {
		return out, cost, remaining, skipped, nil // the hard signals still stand; the subject search waits for the next run
	}
	for i, t := range ts {
		k := Key(t.Repo, t.Number)
		f, ok := out[k]
		if !ok {
			continue
		}
		var found searchNodes
		json.Unmarshal(similar["s"+strconv.Itoa(i)], &found)
		for _, n := range found.Nodes {
			if n.Typename == "PullRequest" {
				f.PRs = addPR(f.PRs, n.pr(false))
			}
		}
		out[k] = f
	}
	return out, cost, remaining, skipped, nil
}

// query runs one request. An error GitHub reports alongside data (an issue that does not exist,
// say) comes back as partial, with the data decoded; anything else is err.
func (w *Watcher) query(ctx context.Context, q string, data *map[string]json.RawMessage) (cost, remaining int, partial, err error) {
	err = w.GH.GraphQL(ctx, q, nil, data)
	var ge *github.GraphQLError
	if errors.As(err, &ge) {
		partial, err = err, nil
	}
	if err != nil {
		return 0, 0, nil, err
	}
	var rl struct {
		Cost      int `json:"cost"`
		Remaining int `json:"remaining"`
	}
	json.Unmarshal((*data)["rateLimit"], &rl)
	return rl.Cost, rl.Remaining, partial, nil
}

// citePattern matches a title that names the issue: "#8504", "[8504]", or "8504 ..." at the start,
// a convention some projects use.
func citePattern(n int) *regexp.Regexp {
	d := strconv.Itoa(n)
	return regexp.MustCompile(`(^|[^0-9&])#` + d + `([^0-9]|$)|\[` + d + `\]|^` + d + `[\s:-]`)
}

func addPR(prs []PR, p PR) []PR {
	for i := range prs {
		if prs[i].Number == p.Number && strings.EqualFold(prs[i].Repo, p.Repo) {
			prs[i].Cites = prs[i].Cites || p.Cites
			return prs
		}
	}
	return append(prs, p)
}

type who struct {
	Login    string `json:"login"`
	Typename string `json:"__typename"`
}

func (a *who) name() string {
	if a == nil {
		return "ghost"
	}
	return a.Login
}

func (a *who) bot() bool {
	return a != nil && (a.Typename == "Bot" || strings.HasSuffix(a.Login, "[bot]"))
}

type prNode struct {
	Typename   string     `json:"__typename"`
	Number     int        `json:"number"`
	Title      string     `json:"title"`
	URL        string     `json:"url"`
	State      string     `json:"state"`
	CreatedAt  time.Time  `json:"createdAt"`
	MergedAt   *time.Time `json:"mergedAt"`
	Author     *who       `json:"author"`
	Repository struct {
		NameWithOwner string `json:"nameWithOwner"`
	} `json:"repository"`
}

func (n prNode) pr(cites bool) PR {
	return PR{Repo: n.Repository.NameWithOwner, Number: n.Number, Title: n.Title, URL: n.URL, State: n.State,
		Author: n.Author.name(), Bot: n.Author.bot(), CreatedAt: n.CreatedAt, MergedAt: n.MergedAt, Cites: cites}
}

type searchNodes struct {
	Nodes []prNode `json:"nodes"`
}

type issueNode struct {
	Number      int        `json:"number"`
	Title       string     `json:"title"`
	State       string     `json:"state"`
	StateReason string     `json:"stateReason"`
	ClosedAt    *time.Time `json:"closedAt"`
	Assignees   struct {
		Nodes []struct {
			Login string `json:"login"`
		} `json:"nodes"`
	} `json:"assignees"`
	Linked   searchNodes `json:"closedByPullRequestsReferences"`
	Timeline struct {
		Nodes []struct {
			Typename  string    `json:"__typename"`
			CreatedAt time.Time `json:"createdAt"`
			Source    *prNode   `json:"source"`
			Assignee  *who      `json:"assignee"`
			Actor     *who      `json:"actor"`
			Closer    *prNode   `json:"closer"`
		} `json:"nodes"`
	} `json:"timelineItems"`
	Comments struct {
		Nodes []struct {
			URL       string    `json:"url"`
			CreatedAt time.Time `json:"createdAt"`
			Body      string    `json:"body"`
			Author    *who      `json:"author"`
		} `json:"nodes"`
	} `json:"comments"`
}

func (n *issueNode) facts(repo string) Facts {
	f := Facts{Repo: repo, Number: n.Number, Title: n.Title, State: n.State, StateReason: n.StateReason,
		ClosedAt: n.ClosedAt, AssignedAt: map[string]time.Time{}}
	for _, a := range n.Assignees.Nodes {
		f.Assignees = append(f.Assignees, a.Login)
	}
	for _, p := range n.Linked.Nodes {
		f.PRs = addPR(f.PRs, p.pr(true))
	}
	for _, e := range n.Timeline.Nodes {
		switch e.Typename {
		case "CrossReferencedEvent":
			if e.Source != nil && e.Source.Typename == "PullRequest" {
				f.PRs = addPR(f.PRs, e.Source.pr(true))
			}
		case "AssignedEvent":
			if e.Assignee != nil && e.Assignee.Login != "" {
				f.AssignedAt[strings.ToLower(e.Assignee.Login)] = e.CreatedAt
			}
		case "ClosedEvent":
			f.ClosedBy, f.Closer = "", nil
			if e.Actor != nil {
				f.ClosedBy = e.Actor.Login
			}
			if e.Closer != nil && e.Closer.Typename == "PullRequest" {
				p := e.Closer.pr(true)
				f.Closer = &p
			}
		}
	}
	for _, c := range n.Comments.Nodes {
		f.Comments = append(f.Comments, Comment{Author: c.Author.name(), Bot: c.Author.bot(), Body: c.Body, URL: c.URL, At: c.CreatedAt})
	}
	return f
}
