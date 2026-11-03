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

// TestWritersSkipOnPartialBoard proves the regression this PR fixes: after a refresh that
// Tracker records as partial, inboxWriter and unrepliedWriter must leave the on-disk files
// untouched. Before the fix they overwrite both with a near-empty partial board; the test
// goes red by design on main and green once the writers consult Snapshot's partial flag.
func TestWritersSkipOnPartialBoard(t *testing.T) {
	srv := partialBoardServer(t)
	defer srv.Close()

	gh := github.New("test-token")
	gh.BaseURL = srv.URL
	tracker := &work.Tracker{GH: gh}

	// Refresh once: a clean board, partial should be false.
	if err := tracker.Refresh(context.Background()); err != nil {
		t.Fatalf("first Refresh: unexpected error: %v", err)
	}
	if _, _, partial := tracker.Snapshot(); partial {
		t.Fatalf("first Refresh: partial = true, want false")
	}

	// Refresh again: prsOpen fails, other lanes still hand back a node, so the board is
	// replaced with a partial one and Snapshot reports partial = true.
	if err := tracker.Refresh(context.Background()); err == nil {
		t.Fatalf("second Refresh: expected error from prsOpen, got nil")
	}
	b, _, partial := tracker.Snapshot()
	if !partial {
		t.Fatalf("second Refresh: partial = false, want true")
	}
	if b == nil {
		t.Fatalf("second Refresh: board = nil, want partial board")
	}

	// Seed known-good files whose bytes we expect to survive the partial write.
	dir := t.TempDir()
	inboxPath := filepath.Join(dir, "inbox.json")
	unrepliedPath := filepath.Join(dir, "unreplied.json")
	inboxBytes := []byte(`{"seeded":"full","entries":18}`)
	unrepliedBytes := []byte(`{"seeded":"full","our_open_prs":18}`)
	if err := os.WriteFile(inboxPath, inboxBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(unrepliedPath, unrepliedBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	// Build the two writers and call each once while the tracker reports partial. Neither
	// file should change. inboxWriter's source is only consulted past the partial check, so
	// the other fields can stay zero-valued for this test.
	writeInbox := inboxWriter(inboxPath, source{board: tracker})
	writeUnreplied := unrepliedWriter(unrepliedPath, tracker)
	writeInbox()
	writeUnreplied()

	got, err := os.ReadFile(inboxPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(inboxBytes) {
		t.Errorf("inbox.json was overwritten on partial\n have: %s\n want: %s", got, inboxBytes)
	}
	got, err = os.ReadFile(unrepliedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(unrepliedBytes) {
		t.Errorf("unreplied.json was overwritten on partial\n have: %s\n want: %s", got, unrepliedBytes)
	}
}
