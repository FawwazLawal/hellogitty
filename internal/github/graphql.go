package github

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// GraphQLError is an error GitHub reported inside a 200 response.
type GraphQLError struct {
	Messages []string
}

func (e *GraphQLError) Error() string {
	return "github graphql: " + strings.Join(e.Messages, "; ")
}

// GraphQL runs one query against GitHub's GraphQL API and decodes its data into out. GraphQL has
// its own points budget, separate from the hourly REST quota the dashboard reports.
func (c *Client) GraphQL(ctx context.Context, query string, vars map[string]any, out any) error {
	payload, err := json.Marshal(map[string]any{"query": query, "variables": vars})
	if err != nil {
		return err
	}
	var res struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if _, err := c.do(ctx, http.MethodPost, c.url("/graphql", nil), payload, &res); err != nil {
		return err
	}
	if len(res.Errors) > 0 {
		e := &GraphQLError{}
		for _, m := range res.Errors {
			e.Messages = append(e.Messages, m.Message)
		}
		// Partial data still decodes; the caller decides whether a partial board is useful.
		if len(res.Data) > 0 && string(res.Data) != "null" {
			if err := json.Unmarshal(res.Data, out); err != nil {
				return fmt.Errorf("github graphql: decode: %w", err)
			}
		}
		return e
	}
	if err := json.Unmarshal(res.Data, out); err != nil {
		return fmt.Errorf("github graphql: decode: %w", err)
	}
	return nil
}
