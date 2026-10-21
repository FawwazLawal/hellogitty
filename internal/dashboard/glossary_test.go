package dashboard

import (
	"os"
	"strings"
	"testing"
)

// The page and the guide must say the same things: every hover term names something the guide
// explains, and every entry says what it means.
func TestEveryTermIsInTheGuide(t *testing.T) {
	b, err := os.ReadFile("../../docs/GUIDE.md")
	if err != nil {
		t.Fatal(err)
	}
	guide := strings.ToLower(string(b))
	for id, term := range glossary {
		if term.Label == "" || term.Means == "" {
			t.Errorf("%s: a term needs a label and a meaning", id)
		}
		if !strings.Contains(guide, strings.ToLower(term.Label)) {
			t.Errorf("%s: %q is not in docs/GUIDE.md", id, term.Label)
		}
	}
}

func TestNoteChipsHaveTerms(t *testing.T) {
	for text, want := range map[string]string{
		"Failing: lint, test": "checks-failing", "Waiting on: build": "checks-running", "Behind main": "behind",
		"2 unresolved threads": "threads", "CI awaiting maintainer approval": "ci-approval", "Something else": "",
	} {
		if got := noteTerm(text); got != want {
			t.Errorf("%q: got %q want %q", text, got, want)
		}
		if want != "" {
			if _, ok := glossary[want]; !ok {
				t.Errorf("%s is not in the glossary", want)
			}
		}
	}
}
