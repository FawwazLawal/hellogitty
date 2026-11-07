package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The two read-only extras the React Settings page needs from
// /app/api/settings.json: the maintain list and the hasPipeline flag.
//
// Both land in the document ALWAYS (as `[]` and `false` respectively when
// absent), so the client's zod schema can require them. A nullable or
// conditionally-omitted field is a trap — a reader with `optional` would fall
// back to a default that reads the same as "the server didn't configure this",
// which is exactly the "unknown is not zero" rule applied to configuration.

func TestSettingsAPICarriesMaintainAndHasPipelineByDefault(t *testing.T) {
	h := handler(fakeSource{})
	rec := httptest.NewRecorder()
	h.serveSettingsAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/settings.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200", rec.Code)
	}

	// Raw first — a MISSING `maintain` on the wire coerces to undefined in
	// JavaScript, which `maintain?.length ?? 0` reads as 0, which is the same
	// number as a configured-but-empty list. The zod schema requires the
	// field so the signal cannot be lost that way; this test guards the
	// signal is on the wire to begin with.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	cfgRaw, ok := raw["config"]
	if !ok {
		t.Fatal("no config block in /app/api/settings.json")
	}
	var cfg map[string]json.RawMessage
	if err := json.Unmarshal(cfgRaw, &cfg); err != nil {
		t.Fatalf("bad config JSON: %v", err)
	}
	if _, ok := cfg["maintain"]; !ok {
		t.Error(`no config.maintain in /app/api/settings.json — the React Repositories panel cannot gate the "Maintain list" section on what is not there`)
	}
	if string(cfg["maintain"]) == "null" {
		t.Error("config.maintain is null; must be [] so the client iterates and gates on length without a guard")
	}
	if _, ok := raw["hasPipeline"]; !ok {
		t.Error(`no hasPipeline at the document root — the React Server panel gates the "Pipeline targets" row on this flag so a dashboard with no pipeline doesn't read as "0 targets"`)
	}

	var doc SettingsAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	// fakeSource{} has no pipeline configured; hasPipeline must come back
	// false, and the maintain list empty rather than nil.
	if doc.HasPipeline {
		t.Error("hasPipeline = true on a handler with no pipeline configured; the React page would render a Pipeline-targets readout for a user who has none")
	}
	if doc.Config.Maintain == nil {
		t.Error("config.maintain is nil; must be the empty slice so JSON marshals [] not null")
	}
}

// With a pipeline configured, hasPipeline flips true even when no reports
// are present, because the flag is about the CONFIG, not the data. The React
// Server panel reads only hasPipeline for its gate; the exact `inPipeline`
// number is informational and depends on reports matching the pipeline's
// targets at runtime.
func TestSettingsAPIReportsHasPipelineWhenConfigured(t *testing.T) {
	h := handler(fakeSource{pipe: pipeFixture(t)})
	rec := httptest.NewRecorder()
	h.serveSettingsAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/settings.json", nil))

	var doc SettingsAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	if !doc.HasPipeline {
		t.Fatalf("hasPipeline = false with pipeFixture configured; the React page gates its Pipeline-targets row on this and would hide the line")
	}
}
