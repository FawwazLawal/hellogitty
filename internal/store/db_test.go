package store

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

var specColumns = map[string][]string{
	"repos":         {"id", "owner", "name", "upstream", "status", "last_poll", "last_commit"},
	"issues":        {"id", "repo_id", "number", "title", "state", "labels", "assignees", "body", "created_at", "updated_at", "closed_at", "claim_signal", "claim_detail"},
	"pull_requests": {"id", "repo_id", "number", "title", "state", "merged", "merged_at", "closed_at", "author_association", "body", "closing_comment", "review_verdict"},
	"watch_list":    {"id", "repo_id", "issue_number", "added_at", "status", "status_changed_at"},
}

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestSchemaMatchesSpec(t *testing.T) {
	s := openTemp(t)
	for table, want := range specColumns {
		rows, err := s.db.Query(`SELECT name FROM pragma_table_info(?) ORDER BY cid`, table)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for rows.Next() {
			var n string
			rows.Scan(&n)
			got = append(got, n)
		}
		rows.Close()
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s columns\n got  %v\n want %v", table, got, want)
		}
	}
}

func TestMigrateIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "re.db")
	for i := 0; i < 2; i++ {
		s, err := Open(path)
		if err != nil {
			t.Fatalf("open %d: %v", i, err)
		}
		s.Close()
	}
}

func TestWriteReadRoundTrip(t *testing.T) {
	s := openTemp(t)
	id, err := s.UpsertRepo("example", "Formatter", "https://github.com/example/Formatter")
	if err != nil {
		t.Fatal(err)
	}
	commit := time.Date(2026, 10, 17, 9, 23, 0, 0, time.UTC)
	if err := s.SetRepoPoll(id, time.Now(), &commit, "active"); err != nil {
		t.Fatal(err)
	}
	r, err := s.RepoByName("EXAMPLE", "formatter")
	if err != nil || r == nil {
		t.Fatalf("RepoByName: %v %v", r, err)
	}
	if r.LastCommit == nil || !r.LastCommit.Equal(commit) {
		t.Errorf("last_commit round trip: got %v want %v", r.LastCommit, commit)
	}

	issues := []Issue{
		{RepoID: id, Number: 1523, Title: "Multiline string", State: "open", Labels: `["good first issue"]`, Assignees: `[]`},
		{RepoID: id, Number: 1600, Title: "Taken", State: "open", Labels: `["bug"]`, Assignees: `["someone"]`, ClaimSignal: "assigned", ClaimDetail: "someone"},
		{RepoID: id, Number: 1700, Title: "Gone", State: "open", Labels: `[]`, Assignees: `[]`},
	}
	for _, i := range issues {
		if err := s.UpsertIssue(i); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.MarkMissingIssuesClosed(id, []int{1523, 1600}); err != nil {
		t.Fatal(err)
	}
	closed := time.Date(2026, 10, 10, 11, 0, 0, 0, time.UTC)
	if err := s.UpsertPR(PullRequest{RepoID: id, Number: 1489, Title: "Sort imports", State: "closed", ClosedAt: &closed, AuthorAssociation: "NONE"}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertPR(PullRequest{RepoID: id, Number: 1490, Title: "Maintainer PR", State: "closed", ClosedAt: &closed, AuthorAssociation: "OWNER"}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.PRDetailFetched(id, 1489); got {
		t.Error("detail should not be fetched yet")
	}
	if err := s.SetPRDetail(id, 1489, "This would break existing configs. Closing.", "CHANGES_REQUESTED"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.PRDetailFetched(id, 1489); !got {
		t.Error("detail should be fetched")
	}
	if err := s.AddWatch(id, 1523); err != nil {
		t.Fatal(err)
	}

	rep, err := s.Report(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep) != 1 {
		t.Fatalf("report repos: %d", len(rep))
	}
	rr := rep[0]
	if rr.OpenIssuesTotal != 2 || rr.OpenIssuesGFI != 1 || rr.OpenIssuesUnassigned != 1 {
		t.Errorf("counts total=%d gfi=%d unassigned=%d, want 2/1/1", rr.OpenIssuesTotal, rr.OpenIssuesGFI, rr.OpenIssuesUnassigned)
	}
	if len(rr.DeniedPRs) != 1 || rr.DeniedPRs[0].ClosingComment == "" || rr.DeniedPRs[0].ReviewVerdict != "CHANGES_REQUESTED" {
		t.Errorf("denied PRs should hold only the outside PR with detail: %+v", rr.DeniedPRs)
	}
	if len(rr.Watch) != 1 || rr.Watch[0].Title != "Multiline string" || rr.Watch[0].Status != "open" {
		t.Errorf("watch report: %+v", rr.Watch)
	}
}

func TestMergedByHandLeavesTheDeniedList(t *testing.T) {
	s := openTemp(t)
	id, _ := s.UpsertRepo("o", "r", "https://github.com/o/r")
	closed := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	for n, comment := range map[int]string{
		1: "Merged manually due to the conflicts - thanks!",
		2: "Cherry-picked as 9f3a2b1c, thanks.",
		3: "Closing as a duplicate of #1742, which we are going to merge instead.",
		4: "Thanks, but we won't take this. See commit abc1234 for the direction we chose.",
		5: "",
	} {
		s.UpsertPR(PullRequest{RepoID: id, Number: n, Title: "pr", State: "closed", ClosedAt: &closed, AuthorAssociation: "NONE"})
		s.SetPRDetail(id, n, comment, "")
	}
	rep, err := s.Report(10)
	if err != nil {
		t.Fatal(err)
	}
	got := map[int]bool{}
	for _, d := range rep[0].DeniedPRs {
		got[d.Number] = true
	}
	if got[1] || got[2] {
		t.Errorf("hand-merged PRs should not count as denied: %v", got)
	}
	if !got[3] || !got[4] || !got[5] {
		t.Errorf("real rejections must stay: %v", got)
	}
	if rep[0].DeniedPRsTotal != 3 {
		t.Errorf("denied total %d, want 3", rep[0].DeniedPRsTotal)
	}
}
