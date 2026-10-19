package snapshot

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/store"
)

// Key sets of the documented snapshot.json format; tools that read the snapshot parse these names.
var (
	topKeys    = []string{"generated_at", "poll_interval_minutes", "repos"}
	repoKeys   = []string{"owner", "name", "health", "last_commit", "open_issues_total", "open_issues_gfi", "open_issues_unassigned", "watch_list", "denied_prs_sample"}
	watchKeys  = []string{"number", "title", "status", "last_checked"}
	deniedKeys = []string{"number", "title", "author_association", "closing_comment", "closed_at"}
)

func keys(m map[string]any) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sorted(s []string) []string {
	c := append([]string(nil), s...)
	sort.Strings(c)
	return c
}

func TestSnapshotShapeMatchesSpec(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	id, _ := st.UpsertRepo("example", "Formatter", "https://github.com/example/Formatter")
	now := time.Date(2026, 10, 18, 14, 0, 0, 0, time.UTC)
	commit := now.Add(-29 * time.Hour)
	st.SetRepoPoll(id, now, &commit, "active")
	st.UpsertIssue(store.Issue{RepoID: id, Number: 1523, Title: "Incorrect formatting of multiline string", State: "open", Labels: `[]`, Assignees: `[]`})
	st.AddWatch(id, 1523)
	closed := now.Add(-8 * 24 * time.Hour)
	st.UpsertPR(store.PullRequest{RepoID: id, Number: 1489, Title: "Add option to sort imports", State: "closed", ClosedAt: &closed, AuthorAssociation: "NONE"})
	st.SetPRDetail(id, 1489, "This would break existing configs. Closing.", "")
	other, _ := st.UpsertRepo("someone", "removed", "https://github.com/someone/removed")
	_ = other

	reports, err := st.Report(DeniedSampleSize)
	if err != nil {
		t.Fatal(err)
	}
	reports = Filter(reports, []Key{{"Example", "formatter"}})
	path := filepath.Join(dir, "snapshot.json")
	if err := Write(path, Build(reports, now, time.Hour)); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	check := func(what string, got map[string]any, want []string) {
		if !reflect.DeepEqual(keys(got), sorted(want)) {
			t.Errorf("%s keys\n got  %v\n want %v", what, keys(got), sorted(want))
		}
	}
	check("top", doc, topKeys)
	repos := doc["repos"].([]any)
	if len(repos) != 1 {
		t.Fatalf("filter should leave 1 repo, got %d", len(repos))
	}
	repo := repos[0].(map[string]any)
	check("repo", repo, repoKeys)
	check("watch", repo["watch_list"].([]any)[0].(map[string]any), watchKeys)
	check("denied", repo["denied_prs_sample"].([]any)[0].(map[string]any), deniedKeys)

	if doc["generated_at"] != "2026-10-18T14:00:00Z" || doc["poll_interval_minutes"] != float64(60) {
		t.Errorf("header: %v %v", doc["generated_at"], doc["poll_interval_minutes"])
	}
	if repo["health"] != "ACTIVE" || repo["watch_list"].([]any)[0].(map[string]any)["status"] != "STILL_OPEN" {
		t.Errorf("labels: health=%v", repo["health"])
	}
}

func TestEmptyListsAreArraysNotNull(t *testing.T) {
	s := Build([]store.RepoReport{{Repo: store.Repo{Owner: "a", Name: "b"}}}, time.Now(), time.Hour)
	b, _ := json.Marshal(s)
	var doc struct {
		Repos []map[string]json.RawMessage `json:"repos"`
	}
	json.Unmarshal(b, &doc)
	for _, k := range []string{"watch_list", "denied_prs_sample"} {
		if string(doc.Repos[0][k]) != "[]" {
			t.Errorf("%s = %s, want []", k, doc.Repos[0][k])
		}
	}
	if string(doc.Repos[0]["health"]) != `"UNKNOWN"` {
		t.Errorf("never-polled repo health = %s, want UNKNOWN", doc.Repos[0]["health"])
	}
}
