package config

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// A repos file written by another tool keeps every repository it has ever known and marks the
// ones it stopped working on. Those marks mean "do not poll": a retired or pruned repository may
// no longer exist on GitHub, and polling it is a 404 every cycle.
func TestReadReposFileSkipsInactiveRetiredAndPruned(t *testing.T) {
	cases := []struct {
		name  string
		entry string
		ref   string // what ReadReposFile returns for the entry when it keeps it
		keep  bool
	}{
		{"plain string", `"a/plain"`, "a/plain", true},
		{"object without flags", `{"upstream":"https://github.com/a/noflags"}`, "https://github.com/a/noflags", true},
		{"active true", `{"upstream":"https://github.com/a/active","active":true}`, "https://github.com/a/active", true},
		{"active false", `{"upstream":"https://github.com/a/inactive","active":false}`, "https://github.com/a/inactive", false},
		{"retired bool true", `{"upstream":"https://github.com/a/retired-bool","retired":true}`, "https://github.com/a/retired-bool", false},
		{"retired bool false", `{"upstream":"https://github.com/a/not-retired","retired":false}`, "https://github.com/a/not-retired", true},
		{"retired dated note", `{"upstream":"https://github.com/a/retired-note","retired":"2026-11-06 archived whole, clones kept"}`, "https://github.com/a/retired-note", false},
		{"retired empty string", `{"upstream":"https://github.com/a/retired-empty","retired":""}`, "https://github.com/a/retired-empty", true},
		{"retired null", `{"upstream":"https://github.com/a/retired-null","retired":null}`, "https://github.com/a/retired-null", true},
		{"pruned note", `{"upstream":"https://github.com/a/pruned","active":true,"pruned_note":"PRUNED 2026-10-31. 0 open PRs."}`, "https://github.com/a/pruned", false},
		{"pruned note blank", `{"upstream":"https://github.com/a/pruned-blank","pruned_note":"   "}`, "https://github.com/a/pruned-blank", true},
		{"pruned note empty", `{"upstream":"https://github.com/a/pruned-empty","pruned_note":""}`, "https://github.com/a/pruned-empty", true},
		{"inactive with repo key", `{"repo":"a/inactive-repo","active":false}`, "a/inactive-repo", false},
		{"inactive with url key", `{"url":"https://github.com/a/inactive-url","active":false}`, "https://github.com/a/inactive-url", false},
		{"retired yet active true", `{"upstream":"https://github.com/a/contradiction","active":true,"retired":"2026-11-06"}`, "https://github.com/a/contradiction", false},
	}
	var entries, want []string
	byRef := map[string]string{}
	for _, c := range cases {
		entries = append(entries, c.entry)
		byRef[c.ref] = c.name
		if c.keep {
			want = append(want, c.name)
		}
	}
	path := filepath.Join(t.TempDir(), "list.json")
	write(t, path, `{"repos":[`+strings.Join(entries, ",\n")+`]}`)

	got, err := ReadReposFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var kept []string
	for _, ref := range got {
		name, ok := byRef[ref]
		if !ok {
			t.Fatalf("unexpected reference %q", ref)
		}
		kept = append(kept, name)
	}
	if !reflect.DeepEqual(kept, want) {
		t.Errorf("kept entries:\n got %v\nwant %v", kept, want)
	}
}

// The same rule holds through Targets, which is what the poller calls.
func TestTargetsDoesNotPollInactiveEntries(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "list.json"), `{"repos":[
		{"upstream":"https://github.com/c/live","active":true},
		{"upstream":"https://github.com/c/gone","active":false,"retired":"2026-11-06 archived","pruned_note":"PRUNED 2026-10-31"},
		{"upstream":"https://github.com/c/never-started","active":false}]}`)
	write(t, filepath.Join(dir, "hellogitty.json"), `{"repos":["a/b"],"repos_file":"list.json"}`)
	c, err := Load(filepath.Join(dir, "hellogitty.json"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.Targets()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, r := range got {
		names = append(names, r.String())
	}
	if want := []string{"a/b", "c/live"}; !reflect.DeepEqual(names, want) {
		t.Errorf("targets %v, want %v", names, want)
	}
}

// A repos file whose every entry is marked inactive contributes nothing, and with no other
// repositories that is still "no repositories configured", not a silent empty poll.
func TestTargetsAllInactiveIsNoRepositories(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "list.json"), `[{"upstream":"https://github.com/c/gone","active":false}]`)
	write(t, filepath.Join(dir, "hellogitty.json"), `{"repos_file":"list.json"}`)
	c, err := Load(filepath.Join(dir, "hellogitty.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Targets(); err == nil {
		t.Error("an all-inactive repos file with no other repos should be an error")
	}
}
