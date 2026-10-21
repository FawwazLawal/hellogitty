package work

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

func TestDecodeMatchesAssembleAndClassify(t *testing.T) {
	b, err := Decode([]byte(`{"data":`+fixture+`}`), "me", nil, "repos owned by me", now)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Sent) != 2 || len(b.Incoming) != 1 || !b.FetchedAt.Equal(now) {
		t.Fatalf("sent %d incoming %d fetched %v", len(b.Sent), len(b.Incoming), b.FetchedAt)
	}
	for _, it := range b.Sent {
		if it.Number == 7 && it.Status != "Changes requested by @lead" {
			t.Errorf("classified pr: %q", it.Status)
		}
	}
	if b.Incoming[0].Move != MoveYou {
		t.Errorf("unanswered issue in my repo should be my move: %+v", b.Incoming[0])
	}
}

func TestDecodeErrors(t *testing.T) {
	_, err := Decode([]byte(`{"data":null,"errors":[{"message":"Bad credentials"}]}`), "me", nil, "", now)
	var ge *github.GraphQLError
	if !errors.As(err, &ge) || !strings.Contains(err.Error(), "Bad credentials") {
		t.Fatalf("want the GraphQL error, got %v", err)
	}
	b, err := Decode([]byte(`{"data":`+fixture+`,"errors":[{"message":"timeout"}]}`), "me", nil, "", now)
	if b == nil || err == nil {
		t.Fatalf("partial data should still give a board and the error: %v %v", b, err)
	}
	if _, err := Decode([]byte(`not json`), "me", nil, "", now); err == nil {
		t.Fatal("want a decode error")
	}
}

func TestRequestCarriesTheBoardQuery(t *testing.T) {
	q, vars, scope := Request("me", []string{"org"}, time.Date(2026, 9, 19, 0, 0, 0, 0, time.UTC))
	if q != boardQuery || len(vars) != 8 || scope != "repos owned by me + org" {
		t.Fatalf("vars %v scope %q", vars, scope)
	}
	if vars["prsDone"] != "is:pr is:closed author:@me closed:>=2026-09-19 sort:updated-desc" {
		t.Errorf("prsDone %q", vars["prsDone"])
	}
}
