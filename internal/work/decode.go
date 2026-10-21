package work

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

// Request returns the board query and its variables for a client that sends the request itself,
// such as the browser extension, plus the label for the repositories counted as yours. since is
// how far back finished work is fetched.
func Request(login string, maintain []string, since time.Time) (query string, vars map[string]any, scope string) {
	vars, scope = queries(login, maintain, since)
	return boardQuery, vars, scope
}

// Decode builds and classifies the board from the body of a GraphQL response to Request's query.
// Like a refresh, a response that carries errors alongside data still yields a board when any of
// the main searches came back, together with the error.
func Decode(body []byte, login string, maintain []string, scope string, now time.Time) (*Board, error) {
	var res struct {
		Data   *boardData `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("github graphql: decode: %w", err)
	}
	var err error
	if len(res.Errors) > 0 {
		e := &github.GraphQLError{}
		for _, m := range res.Errors {
			e.Messages = append(e.Messages, m.Message)
		}
		err = e
	}
	d := res.Data
	if d == nil {
		d = &boardData{}
	}
	if err != nil && len(d.PRsOpen.Nodes)+len(d.Issues.Nodes)+len(d.Incoming.Nodes) == 0 {
		return nil, err
	}
	b := assemble(d, login, maintain, scope)
	b.Cost, b.Remaining = d.RateLimit.Cost, d.RateLimit.Remaining
	b.FetchedAt = now
	Classify(b, now)
	return b, err
}
