package work

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

// maxMissing caps how many missed pull requests one refresh looks up.
const maxMissing = 10

var safeRepo = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

// addMissing looks up pull requests the searches didn't return, in one request, and adds the ones
// you opened that are open or closed within the window. GitHub's search can miss a brand-new pull
// request for a while, and leaves out some altogether; the notifications inbox doesn't.
//
// skip remembers pull requests already found not to be yours (or not to exist), so they are looked up
// once, not on every refresh; addMissing adds to it.
func addMissing(ctx context.Context, gh *github.Client, b *Board, login string, refs []IssueRef, since time.Time, skip map[string]bool) error {
	have := map[string]bool{}
	for _, it := range b.Sent {
		have[strings.ToLower(it.Repo)+"#"+fmt.Sprint(it.Number)] = true
	}
	var want []IssueRef
	for _, r := range refs {
		k := strings.ToLower(r.Repo) + "#" + fmt.Sprint(r.Number)
		if have[k] || skip[k] || r.Number <= 0 || !safeRepo.MatchString(r.Repo) || len(want) == maxMissing {
			continue
		}
		have[k] = true
		want = append(want, r)
	}
	if len(want) == 0 {
		return nil
	}
	var q strings.Builder
	q.WriteString(prFragments + "query {\n  rateLimit { cost remaining }\n")
	for i, r := range want {
		owner, name, _ := strings.Cut(r.Repo, "/")
		fmt.Fprintf(&q, "  x%d: repository(owner: %q, name: %q) { pullRequest(number: %d) { __typename ...pr ...detail } }\n", i, owner, name, r.Number)
	}
	q.WriteString("}\n")
	var data map[string]json.RawMessage
	err := gh.GraphQL(ctx, q.String(), nil, &data)
	var ge *github.GraphQLError
	if err != nil && !errors.As(err, &ge) {
		return err // a missing pull request comes back as a partial error; anything else is real
	}
	for i := range want {
		var repo struct {
			PullRequest *node `json:"pullRequest"`
		}
		json.Unmarshal(data[fmt.Sprintf("x%d", i)], &repo)
		n := repo.PullRequest
		if n == nil || !strings.EqualFold(n.Author.name(), login) {
			if skip != nil {
				skip[strings.ToLower(want[i].Repo)+"#"+fmt.Sprint(want[i].Number)] = true
			}
			continue
		}
		if n.State != "OPEN" && (n.ClosedAt == nil || n.ClosedAt.Before(since)) {
			continue
		}
		b.Sent = append(b.Sent, toItem(*n, RoleAuthor, login))
	}
	var rl struct {
		Cost int `json:"cost"`
	}
	json.Unmarshal(data["rateLimit"], &rl)
	b.Cost += rl.Cost
	return nil
}

// prFragments is the board query's pull request fragments, shared by the lookups above.
var prFragments = boardQuery[:strings.Index(boardQuery, "fragment issue")]
