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
//
// It builds one all-in-one query over all eight searches, which GitHub bills on a single resource
// budget — the budget tips over on a well-stocked board and the response comes back with
// expensive nested fields nulled out, check status among them. Prefer Requests + DecodeMulti,
// which splits the work into one request per search.
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

// Sub is one of the eight board searches, as a self-contained GraphQL request. Each search runs
// in its own request so GitHub bills it against its own resource budget: the all-in-one query
// shared one, which tipped over and nulled nested fields such as the check status.
type Sub struct {
	Name      string         `json:"name"`
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables"`
}

// SubResponse is one search's response body, keyed by the Sub.Name it answers.
type SubResponse struct {
	Name string `json:"name"`
	Body []byte `json:"body"`
}

// Requests returns one GraphQL request per board search, plus the scope label. The client sends
// each request on its own and feeds every response body back to DecodeMulti.
func Requests(login string, maintain []string, since time.Time) ([]Sub, string) {
	vars, scope := queries(login, maintain, since)
	reqs := make([]Sub, 0, len(boardSearches))
	for _, s := range boardSearches {
		reqs = append(reqs, Sub{
			Name:      s.Name,
			Query:     subQuery(s.Name, s.First, s.Body, s.Frags),
			Variables: map[string]any{s.Name: vars[s.Name]},
		})
	}
	return reqs, scope
}

// DecodeMulti builds and classifies the board from the response bodies to Requests' sub-queries.
// Each body is decoded on its own and merged into the aggregate; rate-limit cost is summed and
// remaining takes the latest value. A body that reports errors still contributes its rows, and
// the collected errors are returned alongside the board.
func DecodeMulti(bodies []SubResponse, login string, maintain []string, scope string, now time.Time) (*Board, error) {
	var data boardData
	var msgs []string
	for _, r := range bodies {
		var res struct {
			Data   *boardData `json:"data"`
			Errors []struct {
				Message string `json:"message"`
			} `json:"errors"`
		}
		if err := json.Unmarshal(r.Body, &res); err != nil {
			return nil, fmt.Errorf("github graphql: decode %s: %w", r.Name, err)
		}
		for _, m := range res.Errors {
			msgs = append(msgs, fmt.Sprintf("%s: %s", r.Name, m.Message))
		}
		if res.Data != nil {
			mergeSubData(&data, res.Data, r.Name)
		}
	}
	var err error
	if len(msgs) > 0 {
		err = &github.GraphQLError{Messages: msgs}
	}
	if err != nil && len(data.PRsOpen.Nodes)+len(data.Issues.Nodes)+len(data.Incoming.Nodes) == 0 {
		return nil, err
	}
	b := assemble(&data, login, maintain, scope)
	b.Cost, b.Remaining = data.RateLimit.Cost, data.RateLimit.Remaining
	b.FetchedAt = now
	Classify(b, now)
	return b, err
}
