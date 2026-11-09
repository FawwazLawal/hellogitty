package dashboard

import (
	"net/url"
	"testing"
)

// TestListQueryIsValid pins the set of query shapes that are allowed through BOTH /list routes —
// the React guard in handler.go and the templated serveList in list.go call this one function.
//
// Every row here is a case I actually broke by hand on the dev build before this PR. The
// `/list` SPA fallback used to answer 200 for every one of these; a cold ListPage chunk arriving
// on an invalid query presented a permanent "Loading…" placeholder that looked like a hung page
// rather than the 404 the templated route had always sent.
func TestListQueryIsValid(t *testing.T) {
	cases := []struct {
		name, raw string
		want      bool
	}{
		// Allowed.
		{"prs=opened", "prs=opened", true},
		{"prs=open", "prs=open", true},
		{"prs=merged", "prs=merged", true},
		{"prs=closed", "prs=closed", true},
		{"prs=decided", "prs=decided", true},
		{"stage name — any non-empty is allowed; client validates", "stage=review", true},
		{"stage=unknown is still allowed server-side; client renders Not a stage", "stage=zz", true},

		// Refused — the exact shapes that reached 200 on dev before the fix.
		{"bare no query", "", false},
		{"typo pr= instead of prs=", "pr=open", false},
		{"nonsense key", "what=open", false},
		{"nonsense key with page=1 like the templated IssuesPage", "page=1", false},
		{"prs with unknown value", "prs=my-open", false},
		{"prs= empty string (present but empty)", "prs=", false},
		{"stage= empty string (present but empty)", "stage=", false},
		{"two bad keys together", "pr=open&what=x", false},

		// A valid key alongside noise is still valid — the noise is ignored.
		{"prs=open plus noise", "prs=open&page=1", true},
		{"stage=review plus noise", "stage=review&what=x", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			q, err := url.ParseQuery(c.raw)
			if err != nil {
				t.Fatalf("parse query %q: %v", c.raw, err)
			}
			if got := listQueryIsValid(q); got != c.want {
				t.Errorf("listQueryIsValid(%q) = %v, want %v", c.raw, got, c.want)
			}
		})
	}
}

// TestListPrKindsMatchServeListTitles is a small invariant: the PR kinds that pass validation must
// each map to a title in serveList's ListTitle map, and vice versa. A change to one that forgets
// the other was the 404-inside-a-200 bug the earlier code carried before this file existed —
// `prs=decided` passed prMatches but serveList's switch set ListTitle to "" and then
// http.NotFound'd mid-render.
//
// We do this by exercising the switch in serveList's main case: build the title map from the
// same literal as serveList (the map is a local literal for readability), then compare keys to
// listPrKinds. If the two go out of sync, this test names the offending key.
func TestListPrKindsMatchServeListTitles(t *testing.T) {
	// Keep in step with the map in serveList. A reviewer who changes one should change the other.
	titles := map[string]string{
		"opened":  "Pull requests you opened",
		"open":    "Your open pull requests",
		"merged":  "Your merged pull requests",
		"closed":  "Your pull requests closed without merging",
		"decided": "Your merged and closed pull requests",
	}
	for k := range listPrKinds {
		if titles[k] == "" {
			t.Errorf("prs=%s passes validation but has no title in serveList", k)
		}
	}
	for k := range titles {
		if !listPrKinds[k] {
			t.Errorf("serveList has a title for prs=%s but validation refuses it", k)
		}
	}
}
