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

// TestUnrepliedWriter_SkipsPartialBoard is the real red for this fix: the writer takes a
// *work.Tracker directly and reaches no nil-store landmine, so on the unfixed tree it genuinely
// overwrites the seeded file and this assertion genuinely fails. partialBoardServer drives the
// tracker through one clean refresh and one partial refresh (prsOpen errors, `issues` still
// populated), leaving Snapshot().partial = true.
func TestUnrepliedWriter_SkipsPartialBoard(t *testing.T) {
	srv := partialBoardServer(t)
	defer srv.Close()

	tracker := trackerAfterCompleteRefresh(t, srv)
	if err := tracker.Refresh(context.Background()); err == nil {
		t.Fatalf("second Refresh: expected error from prsOpen, got nil")
	}
	if _, _, partial := tracker.Snapshot(); !partial {
		t.Fatalf("second Refresh: partial = false, want true")
	}

	dir := t.TempDir()
	path := filepath.Join(dir, "unreplied.json")
	seeded := []byte(`{"seeded":"full","our_open_prs":18}`)
	if err := os.WriteFile(path, seeded, 0o644); err != nil {
		t.Fatal(err)
	}

	unrepliedWriter(path, tracker, newWriteRecorder())()

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(seeded) {
		t.Errorf("unreplied.json was overwritten on partial\n have: %s\n want: %s", got, seeded)
	}
}

// TestUnrepliedWriter_ReplacesCompleteBoard proves the guard is a filter, not an off switch.
// Without this case, swapping the fix for `if true { return }` would still pass the skip test
// and ship a regression worse than the one being fixed: files silently never written again.
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
}

// inboxWriter is not covered by a machine test here. The guard is two functions up, identical
// in shape to unrepliedWriter's and consulting the same Snapshot flag. Exercising it end-to-end
// would require wiring a real *store.Store, *poller.Poller, *pipeline.Provider and
// *overlap.Watcher so that source.entries() both reaches past its own early-returns AND produces
// entries worth writing; without that last part, the unfixed writer would see ok=false and
// return anyway, giving a false green. That wiring runs well past the 20-line budget set for
// this PR, so the inbox guard is covered by reading the diff against unrepliedWriter's and
// noted here on purpose, rather than left under a panic that was proving nothing.
