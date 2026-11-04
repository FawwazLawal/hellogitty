package main

import (
	"os"
	"regexp"
	"testing"
)

// TestInboxWriterUsesWorkRefresh is the caller half of the refresh-vs-poll rename: inboxWriter
// has to pass workRefresh (the 5-minute work-board cadence that actually rewrites the file) into
// the inbox.File field, not cfg.PollInterval (the 60-minute poll cadence that already has its own
// place in snapshot.json). inbox.Write's own test proves the field serialises under the right key;
// this one proves the right value reaches it. Checked textually because inboxWriter builds a real
// source that pulls store/poller/overlap/pipeline into its loop — the caller call site is the one
// line under test, so the test reads that line.
func TestInboxWriterUsesWorkRefresh(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	// RefreshIntervalMinutes: int(workRefresh / time.Minute) — spacing left loose so a gofmt-style
	// rewrite is tolerated, but the identifiers must be exactly these.
	re := regexp.MustCompile(`RefreshIntervalMinutes:\s*int\(\s*workRefresh\s*/\s*time\.Minute\s*\)`)
	if !re.Match(src) {
		t.Fatalf("inboxWriter must pass workRefresh (the work-board cadence) into RefreshIntervalMinutes;\n" +
			"the file is the work-board refresh, so cfg.PollInterval would write the wrong loop's value")
	}
}
