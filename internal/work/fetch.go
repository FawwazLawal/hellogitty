package work

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

// One request fetches the whole board: eight searches as aliases of a single GraphQL query.
const boardQuery = `
fragment who on Actor { login __typename }
fragment pr on PullRequest {
  number title url state isDraft createdAt updatedAt closedAt
  repository { nameWithOwner }
  author { ...who }
  mergedBy { login }
  reviewDecision mergeable
  reviewRequests(first: 5) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Bot { login } ... on Mannequin { login } } } }
  latestOpinionatedReviews(first: 10) { nodes { author { ...who } state submittedAt } }
  reviews(last: 1) { nodes { author { ...who } state body submittedAt url } }
  comments(last: 3) { totalCount nodes { author { ...who } body createdAt url } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
}
fragment issue on Issue {
  number title url state stateReason createdAt updatedAt closedAt
  repository { nameWithOwner }
  author { ...who }
  assignees(first: 5) { nodes { login } }
  comments(last: 3) { totalCount nodes { author { ...who } body createdAt url } }
}
query($prsOpen: String!, $prsDone: String!, $issues: String!, $issuesDone: String!,
      $requested: String!, $reviewed: String!, $incoming: String!, $triage: String!) {
  prsOpen:    search(type: ISSUE, query: $prsOpen, first: 50)    { nodes { __typename ...pr } }
  prsDone:    search(type: ISSUE, query: $prsDone, first: 20)    { nodes { __typename ...pr } }
  issues:     search(type: ISSUE, query: $issues, first: 40)     { nodes { __typename ...issue } }
  issuesDone: search(type: ISSUE, query: $issuesDone, first: 10) { nodes { __typename ...issue } }
  requested:  search(type: ISSUE, query: $requested, first: 20)  { nodes { __typename ...pr } }
  reviewed:   search(type: ISSUE, query: $reviewed, first: 20)   { nodes { __typename ...pr } }
  incoming:   search(type: ISSUE, query: $incoming, first: 30)   { nodes { __typename ...pr } }
  triage:     search(type: ISSUE, query: $triage, first: 30)     { nodes { __typename ...issue } }
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

func (a *actor) bot() bool {
	return a != nil && (a.Typename == "Bot" || strings.HasSuffix(a.Login, "[bot]"))
}

type comment struct {
	Author    *actor     `json:"author"`
	Body      string     `json:"body"`
	CreatedAt time.Time  `json:"createdAt"`
	URL       string     `json:"url"`
	State     string     `json:"state"`
	Submitted *time.Time `json:"submittedAt"`
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
	err := gh.GraphQL(ctx, boardQuery, vars, &data)
	if err != nil && len(data.PRsOpen.Nodes)+len(data.Issues.Nodes)+len(data.Incoming.Nodes) == 0 {
		return nil, err
	}
	return assemble(&data, login, maintain, label), err
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
	for _, r := range n.LatestOpinionatedReviews.Nodes {
		if r.Author.bot() {
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
		it.LastCommitAt = c[0].Commit.CommittedDate
		if c[0].Commit.StatusCheckRollup != nil {
			it.Checks = c[0].Commit.StatusCheckRollup.State
		}
	}
	for _, a := range n.Assignees.Nodes {
		it.Assignees = append(it.Assignees, a.Login)
	}
	it.Last = latest(n)
	if it.Last != nil && it.Last.Review != "" && strings.EqualFold(it.Last.Author, login) {
		t := it.Last.At
		if it.ReviewedByMeAt == nil || t.After(*it.ReviewedByMeAt) {
			it.ReviewedByMeAt = &t
		}
	}
	sort.Strings(it.Requested)
	return it
}

// latest picks the newest comment or review written by a person. A bare approval or "changes
// requested" with no text still counts; an empty plain comment-review does not.
func latest(n node) *Activity {
	var best *Activity
	consider := func(c comment, review bool) {
		if c.Author.bot() {
			return
		}
		at := c.CreatedAt
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
