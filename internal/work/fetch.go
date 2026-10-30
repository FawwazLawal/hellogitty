package work

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

// The board draws from eight searches. They used to ride in one request as aliases of a single
// GraphQL query, which was cheap in points but ran them against one shared resource budget:
// when it tipped over, GitHub returned the rows and silently nulled expensive nested fields
// — one error per casualty, 167 on a worked example — including the statusCheckRollup that tells
// the user whether checks passed. Each search alone, with the same page sizes and fragments,
// returns the same rows with zero errors.
//
// So the server sends one request per search. The board is reassembled from eight responses.
// Request / Decode are the extension's single-request contract and keep the old shape; the
// extension still hits the shared budget until it is updated in a follow-up.
//
// Fragments the board queries compose. Each fragment is a complete `fragment X on T { ... }`
// definition. A sub-query includes only the fragments its one search spreads, because GraphQL
// rejects a query that defines a fragment it doesn't use.
const fragWho = `fragment who on Actor { login __typename }`

const fragPR = `fragment pr on PullRequest {
  number title url state isDraft createdAt updatedAt closedAt
  repository { nameWithOwner }
  author { ...who }
  mergedBy { login }
  reviewDecision mergeable mergeStateStatus baseRefName headRefName
  labels(first: 10) { nodes { name } }
  reviewRequests(first: 5) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Bot { login } ... on Mannequin { login } } } }
  latestOpinionatedReviews(first: 10) { nodes { author { ...who } state submittedAt } }
  reviews(last: 1) { nodes { author { ...who } state body submittedAt url authorAssociation } }
  comments(last: 3) { totalCount nodes { author { ...who } body createdAt url authorAssociation } }
  commits(last: 1) { nodes { commit { oid committedDate statusCheckRollup { state } } } }
}`

const fragDetail = `fragment detail on PullRequest {
  botReviews: reviews(last: 10) { nodes { author { ...who } state body submittedAt url authorAssociation } }
  closingIssuesReferences(first: 5) { nodes { number repository { nameWithOwner } } }
  reviewThreads(first: 30) { nodes { isResolved isOutdated path
    comments(first: 1) { nodes { author { ...who } body url createdAt authorAssociation } }
    latest: comments(last: 1) { nodes { author { ...who } } } } }
  checks: commits(last: 1) { nodes { commit {
    checkSuites(first: 20) { nodes { app { name } conclusion workflowRun { workflow { name } } } }
    statusCheckRollup { contexts(first: 40) { nodes { __typename
      ... on CheckRun { name status conclusion title completedAt }
      ... on StatusContext { context state description createdAt } } } } } } }
}`

const fragMine = `fragment mine on PullRequest {
  events: timelineItems(last: 10, itemTypes: [CLOSED_EVENT, LABELED_EVENT]) { nodes { __typename
    ... on ClosedEvent { createdAt actor { login } }
    ... on LabeledEvent { createdAt actor { login } label { name } } } }
}`

const fragIssue = `fragment issue on Issue {
  number title url state stateReason createdAt updatedAt closedAt
  repository { nameWithOwner }
  author { ...who }
  assignees(first: 5) { nodes { login } }
  labels(first: 10) { nodes { name } }
  comments(last: 3) { totalCount nodes { author { ...who } body createdAt url authorAssociation } }
}`

// boardSearches names each search in the board, its page size, the fragments its nodes carry,
// and the fragment definitions those spreads reach. The order is the one the UI's assemble()
// walks, so sub-responses can be merged in place without reorder.
var boardSearches = []struct {
	Name  string   // the data alias and the variable name
	First int      // search page size
	Body  string   // fragment spreads in the node selection
	Frags []string // fragment definitions the spreads reach, transitively
}{
	{"prsOpen", 50, "...pr ...detail ...mine", []string{fragWho, fragPR, fragDetail, fragMine}},
	{"prsDone", 20, "...pr ...mine", []string{fragWho, fragPR, fragMine}},
	{"issues", 40, "...issue", []string{fragWho, fragIssue}},
	{"issuesDone", 10, "...issue", []string{fragWho, fragIssue}},
	{"requested", 20, "...pr", []string{fragWho, fragPR}},
	{"reviewed", 20, "...pr", []string{fragWho, fragPR}},
	{"incoming", 30, "...pr", []string{fragWho, fragPR}},
	{"triage", 30, "...issue", []string{fragWho, fragIssue}},
}

// subQuery is the self-contained GraphQL body for one search. It declares only the variable
// that search reads and asks GitHub for the rate-limit cost of this request, so the sum across
// the eight calls is the refresh's real cost.
func subQuery(name string, first int, body string, frags []string) string {
	return strings.Join(frags, "\n") + fmt.Sprintf(
		`
query($%s: String!) {
  %s: search(type: ISSUE, query: $%s, first: %d) { nodes { __typename %s } }
  rateLimit { cost remaining }
}`, name, name, name, first, body)
}

// boardQuery is the all-in-one query Request() still returns to the Chrome extension. It is kept
// in step with the per-search queries by using the same fragments and page sizes.
const boardQuery = fragWho + "\n" + fragPR + "\n" + fragDetail + "\n" + fragMine + "\n" + fragIssue + `
query($prsOpen: String!, $prsDone: String!, $issues: String!, $issuesDone: String!,
      $requested: String!, $reviewed: String!, $incoming: String!, $triage: String!) {
  prsOpen:    search(type: ISSUE, query: $prsOpen, first: 50)    { nodes { __typename ...pr ...detail ...mine } }
  prsDone:    search(type: ISSUE, query: $prsDone, first: 20)    { nodes { __typename ...pr ...mine } }
  issues:     search(type: ISSUE, query: $issues, first: 40)     { nodes { __typename ...issue } }
  issuesDone: search(type: ISSUE, query: $issuesDone, first: 10) { nodes { __typename ...issue } }
  requested:  search(type: ISSUE, query: $requested, first: 20)  { nodes { __typename ...pr } }
  reviewed:   search(type: ISSUE, query: $reviewed, first: 20)   { nodes { __typename ...pr } }
  incoming:   search(type: ISSUE, query: $incoming, first: 30)   { nodes { __typename ...pr } }
  triage:     search(type: ISSUE, query: $triage, first: 30)     { nodes { __typename ...issue } }
  rateLimit { cost remaining }
}`

type actor struct {
	Login    string `json:"login"`
	Typename string `json:"__typename"`
}

func (a *actor) name() string {
	if a == nil {
		return "ghost"
	}
	return a.Login
}

// botName catches automation that runs from an ordinary user account, such as gopherbot or
// k8s-ci-robot, which GitHub reports as a User.
var botName = regexp.MustCompile(`(?i)(bot|robot)$`)

func (a *actor) bot() bool {
	return a != nil && (a.Typename == "Bot" || strings.HasSuffix(a.Login, "[bot]") || botName.MatchString(a.Login))
}

// automated reports a comment written by a machine: a bot, or a body that opens with a hidden
// marker such as "<!-- impeccable-pr-policy:v1 -->", which policy checks and review tools post
// from a maintainer's own account. People do not start a comment that way.
func automated(c comment) bool {
	return c.Author.bot() || strings.HasPrefix(strings.TrimSpace(c.Body), "<!--")
}

type comment struct {
	Author             *actor     `json:"author"`
	Body               string     `json:"body"`
	CreatedAt          *time.Time `json:"createdAt"`
	URL                string     `json:"url"`
	State              string     `json:"state"`
	Submitted          *time.Time `json:"submittedAt"`
	AuthorAssociation  string     `json:"authorAssociation"`
}

func timeVal(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

type node struct {
	Typename    string     `json:"__typename"`
	Number      int        `json:"number"`
	Title       string     `json:"title"`
	URL         string     `json:"url"`
	State       string     `json:"state"`
	StateReason string     `json:"stateReason"`
	IsDraft     bool       `json:"isDraft"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	ClosedAt    *time.Time `json:"closedAt"`
	Repository  struct {
		NameWithOwner string `json:"nameWithOwner"`
	} `json:"repository"`
	Author         *actor `json:"author"`
	MergedBy       *actor `json:"mergedBy"`
	ReviewDecision string `json:"reviewDecision"`
	Mergeable      string `json:"mergeable"`
	MergeState     string `json:"mergeStateStatus"`
	BaseRef        string `json:"baseRefName"`
	HeadRef        string `json:"headRefName"`
	Labels         struct {
		Nodes []struct {
			Name string `json:"name"`
		} `json:"nodes"`
	} `json:"labels"`
	ReviewThreads struct {
		Nodes []struct {
			IsResolved bool   `json:"isResolved"`
			IsOutdated bool   `json:"isOutdated"`
			Path       string `json:"path"`
			Comments   struct {
				Nodes []comment `json:"nodes"`
			} `json:"comments"`
			Latest struct {
				Nodes []comment `json:"nodes"`
			} `json:"latest"`
		} `json:"nodes"`
	} `json:"reviewThreads"`
	Checks struct {
		Nodes []struct {
			Commit struct {
				CheckSuites struct {
					Nodes []struct {
						App *struct {
							Name string `json:"name"`
						} `json:"app"`
						Conclusion  string `json:"conclusion"`
						WorkflowRun *struct {
							Workflow struct {
								Name string `json:"name"`
							} `json:"workflow"`
						} `json:"workflowRun"`
					} `json:"nodes"`
				} `json:"checkSuites"`
				StatusCheckRollup *struct {
					Contexts struct {
						Nodes []struct {
							Typename    string     `json:"__typename"`
							Name        string     `json:"name"`
							Status      string     `json:"status"`
							Conclusion  string     `json:"conclusion"`
							Title       string     `json:"title"`
							Context     string     `json:"context"`
							State       string     `json:"state"`
							Description string     `json:"description"`
							CompletedAt *time.Time `json:"completedAt"`
							CreatedAt   *time.Time `json:"createdAt"`
						} `json:"nodes"`
					} `json:"contexts"`
				} `json:"statusCheckRollup"`
			} `json:"commit"`
		} `json:"nodes"`
	} `json:"checks"`
	ReviewRequests struct {
		Nodes []struct {
			RequestedReviewer *struct {
				Login string `json:"login"`
				Name  string `json:"name"`
			} `json:"requestedReviewer"`
		} `json:"nodes"`
	} `json:"reviewRequests"`
	LatestOpinionatedReviews struct {
		Nodes []comment `json:"nodes"`
	} `json:"latestOpinionatedReviews"`
	Reviews struct {
		Nodes []comment `json:"nodes"`
	} `json:"reviews"`
	Comments struct {
		TotalCount int       `json:"totalCount"`
		Nodes      []comment `json:"nodes"`
	} `json:"comments"`
	Commits struct {
		Nodes []struct {
			Commit struct {
				OID               string     `json:"oid"`
				CommittedDate     *time.Time `json:"committedDate"`
				StatusCheckRollup *struct {
					State string `json:"state"`
				} `json:"statusCheckRollup"`
			} `json:"commit"`
		} `json:"nodes"`
	} `json:"commits"`
	Assignees struct {
		Nodes []struct {
			Login string `json:"login"`
		} `json:"nodes"`
	} `json:"assignees"`
	BotReviews struct {
		Nodes []comment `json:"nodes"`
	} `json:"botReviews"`
	Events struct {
		Nodes []struct {
			Typename  string    `json:"__typename"`
			CreatedAt time.Time `json:"createdAt"`
			Actor     *actor    `json:"actor"`
			Label     *struct {
				Name string `json:"name"`
			} `json:"label"`
		} `json:"nodes"`
	} `json:"events"`
	ClosingIssuesReferences struct {
		Nodes []struct {
			Number     int `json:"number"`
			Repository struct {
				NameWithOwner string `json:"nameWithOwner"`
			} `json:"repository"`
		} `json:"nodes"`
	} `json:"closingIssuesReferences"`
}

type search struct {
	Nodes []node `json:"nodes"`
}

type boardData struct {
	PRsOpen    search `json:"prsOpen"`
	PRsDone    search `json:"prsDone"`
	Issues     search `json:"issues"`
	IssuesDone search `json:"issuesDone"`
	Requested  search `json:"requested"`
	Reviewed   search `json:"reviewed"`
	Incoming   search `json:"incoming"`
	Triage     search `json:"triage"`
	RateLimit  struct {
		Cost      int `json:"cost"`
		Remaining int `json:"remaining"`
	} `json:"rateLimit"`
}

func viewerLogin(ctx context.Context, gh *github.Client) (string, error) {
	var res struct {
		Viewer struct {
			Login string `json:"login"`
		} `json:"viewer"`
	}
	if err := gh.GraphQL(ctx, `query { viewer { login } }`, nil, &res); err != nil {
		return "", fmt.Errorf("resolve account: %w", err)
	}
	if res.Viewer.Login == "" {
		return "", fmt.Errorf("resolve account: empty login")
	}
	return res.Viewer.Login, nil
}

// scope is the search qualifier for repositories that count as yours.
func scope(login string, maintain []string) (qualifier, label string) {
	parts := []string{"user:" + login}
	labels := []string{"repos owned by " + login}
	for _, m := range maintain {
		m = strings.TrimSpace(m)
		switch {
		case m == "":
			continue
		case strings.Contains(m, "/"):
			parts = append(parts, "repo:"+m)
		default:
			parts = append(parts, "org:"+m)
		}
		labels = append(labels, m)
	}
	return strings.Join(parts, " "), strings.Join(labels, " + ")
}

func queries(login string, maintain []string, since time.Time) (map[string]any, string) {
	d := since.UTC().Format("2006-01-02")
	mine, label := scope(login, maintain)
	return map[string]any{
		"prsOpen":    "is:pr is:open author:@me archived:false sort:updated-desc",
		"prsDone":    "is:pr is:closed author:@me closed:>=" + d + " sort:updated-desc",
		"issues":     "is:issue is:open involves:@me archived:false sort:updated-desc",
		"issuesDone": "is:issue is:closed author:@me closed:>=" + d + " sort:updated-desc",
		"requested":  "is:pr is:open review-requested:@me archived:false sort:updated-desc",
		"reviewed":   "is:pr is:open reviewed-by:@me -author:@me archived:false sort:updated-desc",
		"incoming":   "is:pr is:open -author:@me archived:false sort:updated-desc " + mine,
		"triage":     "is:issue is:open -author:@me archived:false sort:updated-desc " + mine,
	}, label
}

func fetch(ctx context.Context, gh *github.Client, login string, maintain []string, since time.Time) (*Board, error) {
	vars, label := queries(login, maintain, since)
	var data boardData
	var msgs []string
	for _, s := range boardSearches {
		var sub boardData
		q := subQuery(s.Name, s.First, s.Body, s.Frags)
		v := map[string]any{s.Name: vars[s.Name]}
		// A failed sub-request still leaves the other seven useful, so the board is partial, not
		// absent. The errors are collected and returned so a caller can log them.
		if err := gh.GraphQL(ctx, q, v, &sub); err != nil {
			msgs = append(msgs, fmt.Sprintf("%s: %s", s.Name, err.Error()))
		}
		mergeSubData(&data, &sub, s.Name)
	}
	if len(data.PRsOpen.Nodes)+len(data.Issues.Nodes)+len(data.Incoming.Nodes) == 0 && len(msgs) > 0 {
		return nil, &github.GraphQLError{Messages: msgs}
	}
	b := assemble(&data, login, maintain, label)
	b.Cost, b.Remaining = data.RateLimit.Cost, data.RateLimit.Remaining
	if len(msgs) > 0 {
		return b, &github.GraphQLError{Messages: msgs}
	}
	return b, nil
}

// mergeSubData copies the one populated search field, and the rate-limit totals, from a sub-
// response into the aggregate. remaining comes from the last call that reported one, so it
// reflects the state after the whole refresh; cost is summed across calls.
func mergeSubData(dst, src *boardData, name string) {
	switch name {
	case "prsOpen":
		dst.PRsOpen = src.PRsOpen
	case "prsDone":
		dst.PRsDone = src.PRsDone
	case "issues":
		dst.Issues = src.Issues
	case "issuesDone":
		dst.IssuesDone = src.IssuesDone
	case "requested":
		dst.Requested = src.Requested
	case "reviewed":
		dst.Reviewed = src.Reviewed
	case "incoming":
		dst.Incoming = src.Incoming
	case "triage":
		dst.Triage = src.Triage
	}
	dst.RateLimit.Cost += src.RateLimit.Cost
	if src.RateLimit.Remaining != 0 {
		dst.RateLimit.Remaining = src.RateLimit.Remaining
	}
}

// assemble turns the raw searches into the two lists, dropping duplicates. An item in a
// repository you maintain goes to Incoming unless you opened it.
func assemble(d *boardData, login string, maintain []string, label string) *Board {
	b := &Board{Login: login, Scope: label}
	seen := map[string]bool{}
	add := func(list *[]Item, n node, role string) {
		if n.URL == "" || seen[n.URL] {
			return
		}
		seen[n.URL] = true
		*list = append(*list, toItem(n, role, login))
	}
	maintained := func(repo string) bool {
		owner, _, _ := strings.Cut(repo, "/")
		if strings.EqualFold(owner, login) {
			return true
		}
		for _, m := range maintain {
			if strings.EqualFold(m, repo) || strings.EqualFold(m, owner) {
				return true
			}
		}
		return false
	}

	for _, n := range append(d.PRsOpen.Nodes, d.PRsDone.Nodes...) {
		add(&b.Sent, n, RoleAuthor)
	}
	for _, n := range append(d.Issues.Nodes, d.IssuesDone.Nodes...) {
		mine := strings.EqualFold(n.Author.name(), login)
		if !mine && maintained(n.Repository.NameWithOwner) {
			continue // shown under Incoming
		}
		role := RoleInvolved
		switch {
		case mine:
			role = RoleAuthor
		case assignedTo(n, login):
			role = RoleAssigned
		}
		add(&b.Sent, n, role)
	}
	for _, n := range append(d.Requested.Nodes, d.Reviewed.Nodes...) {
		add(&b.Incoming, n, RoleReviewer)
	}
	for _, n := range append(d.Incoming.Nodes, d.Triage.Nodes...) {
		add(&b.Incoming, n, RoleMaintains)
	}
	return b
}

func assignedTo(n node, login string) bool {
	for _, a := range n.Assignees.Nodes {
		if strings.EqualFold(a.Login, login) {
			return true
		}
	}
	return false
}

func toItem(n node, role, login string) Item {
	it := Item{
		PR: n.Typename == "PullRequest", Repo: n.Repository.NameWithOwner, Number: n.Number,
		Title: n.Title, URL: n.URL, Author: n.Author.name(), Role: role, State: n.State,
		Draft: n.IsDraft, CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt, ClosedAt: n.ClosedAt,
		ReviewDecision: n.ReviewDecision, Conflict: n.Mergeable == "CONFLICTING",
		StateReason: n.StateReason, Comments: n.Comments.TotalCount,
		MergeState: n.MergeState, Base: n.BaseRef, Head: n.HeadRef,
	}
	for _, l := range n.Labels.Nodes {
		it.Labels = append(it.Labels, l.Name)
	}
	for _, t := range n.ReviewThreads.Nodes {
		if t.IsResolved || len(t.Comments.Nodes) == 0 {
			continue
		}
		c := t.Comments.Nodes[0]
		th := Thread{Author: c.Author.name(), Bot: c.Author.bot(), Body: strings.TrimSpace(c.Body),
			URL: c.URL, Path: t.Path, Outdated: t.IsOutdated, At: timeVal(c.CreatedAt),
			AuthorAssociation: c.AuthorAssociation}
		if l := t.Latest.Nodes; len(l) > 0 {
			th.RepliedLast = strings.EqualFold(l[0].Author.name(), login)
		}
		it.Threads = append(it.Threads, th)
	}
	if c := n.Checks.Nodes; len(c) > 0 {
		for _, s := range c[0].Commit.CheckSuites.Nodes {
			if s.Conclusion != "ACTION_REQUIRED" {
				continue
			}
			name := "a workflow"
			if s.WorkflowRun != nil && s.WorkflowRun.Workflow.Name != "" {
				name = s.WorkflowRun.Workflow.Name
			} else if s.App != nil {
				name = s.App.Name
			}
			it.AwaitingApproval = append(it.AwaitingApproval, name)
		}
		if r := c[0].Commit.StatusCheckRollup; r != nil {
			for _, x := range r.Contexts.Nodes {
				ch := Check{Name: x.Name, Detail: x.Title, At: x.CompletedAt}
				if x.Typename == "StatusContext" {
					ch.Name, ch.Detail, ch.State, ch.At = x.Context, x.Description, statusState(x.State), x.CreatedAt
				} else {
					ch.State = runState(x.Status, x.Conclusion)
				}
				it.CheckList = append(it.CheckList, ch)
			}
		}
	}
	if n.MergedBy != nil {
		it.MergedBy = n.MergedBy.Login
	}
	for _, r := range n.ReviewRequests.Nodes {
		if r.RequestedReviewer == nil {
			continue
		}
		name := r.RequestedReviewer.Login
		if name == "" {
			name = r.RequestedReviewer.Name
		}
		if name != "" {
			it.Requested = append(it.Requested, name)
		}
	}
	for _, e := range n.Events.Nodes {
		switch e.Typename {
		case "ClosedEvent":
			it.ClosedBy = e.Actor.name()
		case "LabeledEvent":
			if e.Label != nil {
				if it.LabeledBy == nil {
					it.LabeledBy = map[string]LabelEvent{}
				}
				it.LabeledBy[e.Label.Name] = LabelEvent{Actor: e.Actor.name(), At: e.CreatedAt}
			}
		}
	}
	for _, r := range n.BotReviews.Nodes {
		if r.Author.bot() && r.Submitted != nil {
			it.BotReviews = append(it.BotReviews, Activity{Author: r.Author.name(), Body: strings.TrimSpace(r.Body),
				URL: r.URL, At: *r.Submitted, Review: r.State, Bot: true, AuthorAssociation: r.AuthorAssociation})
		}
	}
	for _, r := range n.LatestOpinionatedReviews.Nodes {
		if r.Author.bot() {
			if r.State == "CHANGES_REQUESTED" {
				it.BotChanges = append(it.BotChanges, r.Author.name())
			}
			continue
		}
		switch r.State {
		case "APPROVED":
			it.ApprovedBy = append(it.ApprovedBy, r.Author.name())
		case "CHANGES_REQUESTED":
			it.ChangesBy = append(it.ChangesBy, r.Author.name())
			if r.Submitted != nil && (it.ChangesAt == nil || r.Submitted.After(*it.ChangesAt)) {
				t := *r.Submitted
				it.ChangesAt = &t
			}
		}
		if strings.EqualFold(r.Author.name(), login) && r.Submitted != nil {
			t := *r.Submitted
			it.ReviewedByMeAt = &t
		}
	}
	if c := n.Commits.Nodes; len(c) > 0 {
		it.LastCommitAt, it.HeadOID = c[0].Commit.CommittedDate, c[0].Commit.OID
		if c[0].Commit.StatusCheckRollup != nil {
			it.Checks = c[0].Commit.StatusCheckRollup.State
		}
	}
	for _, a := range n.Assignees.Nodes {
		it.Assignees = append(it.Assignees, a.Login)
	}
	for _, r := range n.ClosingIssuesReferences.Nodes {
		it.Fixes = append(it.Fixes, IssueRef{Repo: r.Repository.NameWithOwner, Number: r.Number})
	}
	it.Last = latest(n)
	it.Recent = recent(n, it.Threads, login)
	if it.Last != nil && it.Last.Review != "" && strings.EqualFold(it.Last.Author, login) {
		t := it.Last.At
		if it.ReviewedByMeAt == nil || t.After(*it.ReviewedByMeAt) {
			it.ReviewedByMeAt = &t
		}
	}
	sort.Strings(it.Requested)
	return it
}

// statusState maps a commit status (SUCCESS, PENDING, FAILURE, ERROR, EXPECTED) to a check state.
func statusState(s string) string {
	switch s {
	case "SUCCESS":
		return CheckPassed
	case "FAILURE", "ERROR":
		return CheckFailed
	}
	return CheckPending
}

// runState maps a check run's status and conclusion to a check state. Skipped and neutral runs
// count as passed: they never block a merge.
func runState(status, conclusion string) string {
	if status != "COMPLETED" {
		return CheckPending
	}
	switch conclusion {
	case "SUCCESS", "NEUTRAL", "SKIPPED":
		return CheckPassed
	case "ACTION_REQUIRED":
		return CheckPending
	}
	return CheckFailed
}

// recent lists every comment and review from someone else that the board fetched: the last three
// comments, the latest review, and the opening comment of each unresolved review thread. Your own
// words and bot comments on the conversation are left out. It feeds the inbox file, so nothing here costs another request.
func recent(n node, threads []Thread, login string) []Activity {
	var out []Activity
	mine := func(a *actor) bool { return a.bot() || strings.EqualFold(a.name(), login) }
	for _, c := range n.Comments.Nodes {
		if !mine(c.Author) && !automated(c) {
			out = append(out, Activity{Author: c.Author.name(), Body: strings.TrimSpace(c.Body), URL: c.URL, At: timeVal(c.CreatedAt),
				AuthorAssociation: c.AuthorAssociation})
		}
	}
	for _, c := range n.Reviews.Nodes {
		if mine(c.Author) || c.Submitted == nil || c.State == "PENDING" || (c.State == "COMMENTED" && strings.TrimSpace(c.Body) == "") {
			continue
		}
		out = append(out, Activity{Author: c.Author.name(), Body: strings.TrimSpace(c.Body), URL: c.URL, At: *c.Submitted, Review: c.State,
			AuthorAssociation: c.AuthorAssociation})
	}
	// Review bots count here: their inline comments block a merge as surely as a person's.
	for _, t := range threads {
		if !strings.EqualFold(t.Author, login) {
			out = append(out, Activity{Author: t.Author, Body: t.Body, URL: t.URL, At: t.At, Path: t.Path, Bot: t.Bot,
				AuthorAssociation: t.AuthorAssociation})
		}
	}
	return out
}

// latest picks the newest comment or review written by a person. A bare approval or "changes
// requested" with no text still counts; an empty plain comment-review does not.
func latest(n node) *Activity {
	var best *Activity
	consider := func(c comment, review bool) {
		if automated(c) {
			return
		}
		at := timeVal(c.CreatedAt)
		if review {
			if c.Submitted == nil || (c.State == "COMMENTED" && strings.TrimSpace(c.Body) == "") || c.State == "PENDING" {
				return
			}
			at = *c.Submitted
		}
		if best != nil && !at.After(best.At) {
			return
		}
		a := &Activity{Author: c.Author.name(), Body: strings.TrimSpace(c.Body), URL: c.URL, At: at}
		if review {
			a.Review = c.State
		}
		best = a
	}
	for _, c := range n.Comments.Nodes {
		consider(c, false)
	}
	for _, c := range n.Reviews.Nodes {
		consider(c, true)
	}
	return best
}
