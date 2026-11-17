package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/FawwazLawal/hellogitty/internal/github"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

// partialBoardServer returns an httptest.Server that first serves eight clean sub-queries
// (one issue node in the `issues` lane, empty elsewhere) and, after the first full fan-out,
// returns a decode-shaped error for `prsOpen` while keeping `issues` populated. That is the
// shape work.Tracker records as a partial refresh: a board that is new and incomplete.
func partialBoardServer(t *testing.T) *httptest.Server {
	t.Helper()
	var postCalls int32
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload struct {
			Query     string                 `json:"query"`
			Variables map[string]interface{} `json:"variables"`
		}
		_ = json.Unmarshal(body, &payload)

		if strings.Contains(payload.Query, "viewer { login }") {
			io.WriteString(w, `{"data":{"viewer":{"login":"FawwazLawal"}}}`)
			return
		}

		n := atomic.AddInt32(&postCalls, 1)
		alias := ""
		for k := range payload.Variables {
			alias = k
			break
		}

		// After the first full pass of eight sub-queries, prsOpen returns an error that still
		// leaves other lanes with nodes — the exact shape work.Tracker calls partial.
		if alias == "prsOpen" && n > 8 {
			io.WriteString(w, `{"data":null,"errors":[{"message":"unexpected end of JSON input"}]}`)
			return
		}

		if alias == "issues" {
			io.WriteString(w, `{"data":{"issues":{"nodes":[{"__typename":"Issue","number":1,"title":"x","url":"https://example.invalid/o/r/issues/1","state":"OPEN","repository":{"nameWithOwner":"o/r"}}]},"rateLimit":{"cost":1,"remaining":4999}}}`)
			return
		}
		io.WriteString(w, `{"data":{"rateLimit":{"cost":1,"remaining":4999}}}`)
	}))
}

// trackerAfterCompleteRefresh returns a Tracker that has had one successful refresh (partial
// = false). Shared setup for both the skip-partial and replaces-complete cases, so each test
// asserts one thing against the exact tracker state its name claims.
func trackerAfterCompleteRefresh(t *testing.T, srv *httptest.Server) *work.Tracker {
	t.Helper()
	gh := github.New("test-token")
	gh.BaseURL = srv.URL
	tracker := &work.Tracker{GH: gh}
	if err := tracker.Refresh(context.Background()); err != nil {
		t.Fatalf("first Refresh: unexpected error: %v", err)
	}
	if _, _, partial := tracker.Snapshot(); partial {
		t.Fatalf("first Refresh: partial = true, want false")
	}
	return tracker
}

// TestUnrepliedWriter_WritesBestAvailableOnPartialBoard is the red for #342: on a partial refresh
// the writer previously skipped the file, leaving it stale and flapping /health. Now it writes
// the file from the best-available board (merging the last complete cycle's PRs with whatever the
// partial produced) and marks board_partial true so a consumer can tell.
//
// partialBoardServer drives the tracker through one clean refresh and one partial refresh
// (prsOpen errors, `issues` still populated), leaving Snapshot().partial = true.
func TestUnrepliedWriter_WritesBestAvailableOnPartialBoard(t *testing.T) {
	srv := partialBoardServer(t)
	defer srv.Close()

	tracker := trackerAfterCompleteRefresh(t, srv)

	dir := t.TempDir()
	path := filepath.Join(dir, "unreplied.json")
	rec := newWriteRecorder()
	rec.register("unreplied.json")
	w := unrepliedWriter(path, tracker, rec)

	// First call: complete refresh populates the lastGood cache.
	w()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("first write after complete refresh: %v", err)
	}

	// Second refresh goes partial; the file must be rewritten (not skipped), with board_partial
	// true. We re-seed the sentinel so the "overwritten" assertion is unambiguous.
	if err := tracker.Refresh(context.Background()); err == nil {
		t.Fatalf("second Refresh: expected error from prsOpen, got nil")
	}
	if _, _, partial := tracker.Snapshot(); !partial {
		t.Fatalf("second Refresh: partial = false, want true")
	}
	seeded := []byte(`{"seeded":"stale"}`)
	if err := os.WriteFile(path, seeded, 0o644); err != nil {
		t.Fatal(err)
	}

	w()

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) == string(seeded) {
		t.Errorf("unreplied.json was NOT rewritten on partial; the writer still skips: %s", got)
	}
	var file struct {
		BoardPartial bool `json:"board_partial"`
	}
	if err := json.Unmarshal(got, &file); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, got)
	}
	if !file.BoardPartial {
		t.Errorf("board_partial = false, want true on a partial-cycle write (body: %s)", got)
	}
	// And the write recorder shows a successful "written" — so /health's file row stays current.
	for _, s := range rec.snapshot() {
		if s.Name == "unreplied.json" && s.Outcome != "written" {
			t.Errorf("recorded outcome = %q, want %q (detail: %s)", s.Outcome, "written", s.Detail)
		}
	}
}

// TestUnrepliedWriter_ReplacesCompleteBoard proves the partial branch is not a one-way door.
// Without this case, swapping the fix for `f.BoardPartial = true` unconditionally would still
// pass the partial test and ship a file that forever claimed to be partial.
func TestUnrepliedWriter_ReplacesCompleteBoard(t *testing.T) {
	srv := partialBoardServer(t)
	defer srv.Close()

	tracker := trackerAfterCompleteRefresh(t, srv)

	dir := t.TempDir()
	path := filepath.Join(dir, "unreplied.json")
	seeded := []byte(`{"seeded":"stale"}`)
	if err := os.WriteFile(path, seeded, 0o644); err != nil {
		t.Fatal(err)
	}

	unrepliedWriter(path, tracker, newWriteRecorder())()

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) == string(seeded) {
		t.Errorf("unreplied.json was NOT replaced after a complete refresh; the guard swallows the happy path")
	}
	// board_partial must be absent (omitempty) on a complete-cycle write.
	if strings.Contains(string(got), `"board_partial"`) {
		t.Errorf("board_partial should be omitted on a complete write, got: %s", got)
	}
}

// inboxWriter is covered by the inbox.MergeEntries test; a per-closure integration test would
// have to wire a real *store.Store, *poller.Poller, *pipeline.Provider and *overlap.Watcher for
// source.entries() to reach past its own early-returns. The partial-branch shape is identical
// to unrepliedWriter's above and reads from the same Snapshot flag; the merge rule itself is
// tested in internal/inbox/merge_test.go.
