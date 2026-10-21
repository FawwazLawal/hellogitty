package work

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

func TestMissedPullRequestsAreLookedUp(t *testing.T) {
	var asked string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var req struct{ Query string }
		json.Unmarshal(b, &req)
		asked = req.Query
		io.WriteString(w, `{"data":{"rateLimit":{"cost":2,"remaining":4990},
		 "x0":{"pullRequest":{"__typename":"PullRequest","number":2821,"title":"test: port PySpark Catalog.listFunctions doctest","url":"https://github.com/lakehq/sail/pull/2821","state":"OPEN","createdAt":"2026-10-21T08:00:00Z","updatedAt":"2026-10-21T08:00:00Z","repository":{"nameWithOwner":"lakehq/sail"},"author":{"login":"FawwazLawal","__typename":"User"},"headRefName":"doctest-listfunctions"}},
		 "x1":{"pullRequest":{"__typename":"PullRequest","number":8530,"title":"Fix Accept-Encoding","url":"https://github.com/hapifhir/hapi-fhir/pull/8530","state":"CLOSED","closedAt":"2026-10-20T12:00:00Z","repository":{"nameWithOwner":"hapifhir/hapi-fhir"},"author":{"login":"fawwazlawal","__typename":"User"}}},
		 "x2":{"pullRequest":{"__typename":"PullRequest","number":5,"title":"Someone else's","url":"u","state":"OPEN","repository":{"nameWithOwner":"o/r"},"author":{"login":"other","__typename":"User"}}},
		 "x3":{"pullRequest":null}},"errors":[{"message":"Could not resolve to a PullRequest with the number of 99."}]}`)
	}))
	defer srv.Close()
	gh := github.New("t")
	gh.BaseURL = srv.URL
	b := &Board{Sent: []Item{{PR: true, Repo: "golang/go", Number: 82377}}, Cost: 43}
	refs := []IssueRef{{"lakehq/sail", 2821}, {"hapifhir/hapi-fhir", 8530}, {"o/r", 5}, {"o/r", 99}, {"golang/go", 82377}, {"bad repo", 1}}
	skip := map[string]bool{}
	err := addMissing(context.Background(), gh, b, "FawwazLawal", refs, time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC), skip)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(asked, "82377") || strings.Contains(asked, "bad repo") || !strings.Contains(asked, "fragment detail") {
		t.Errorf("only the missing, well-formed ones are asked for, with the board's own fragments:\n%s", asked)
	}
	var got []string
	for _, it := range b.Sent {
		got = append(got, it.Repo+"#"+strings.TrimSpace(strings.Split(it.URL, "/pull/")[len(strings.Split(it.URL, "/pull/"))-1]))
	}
	if len(b.Sent) != 3 || b.Sent[1].Number != 2821 || b.Sent[1].Role != RoleAuthor || b.Sent[1].Head != "doctest-listfunctions" || b.Sent[2].Number != 8530 {
		t.Errorf("yours, open or closed in the window, are added; someone else's and missing ones are not: %v", got)
	}
	if !skip["o/r#5"] || !skip["o/r#99"] || skip["lakehq/sail#2821"] {
		t.Errorf("someone else's and missing ones are remembered so they aren't looked up again: %v", skip)
	}
	if b.Cost != 45 {
		t.Errorf("the lookup's cost is counted: %d", b.Cost)
	}
}
