package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The per-stage board in /app/api/pipeline.json.
//
// The templated page gated the Stages section on `.HasPipeline`, iterated
// `.Pipeline.Counts` for a card per stage, and hid the whole section without a
// configured pipeline. The React page can only follow the same rule if the
// document carries both, which it did not before this commit.
//
// THIS GUARDS the specific regression the gap closes: a fresh frontend with
// `Pipeline.Counts` populated but no top-level stages / hasPipeline fields.
// Without the gate below, the React page would silently render no stages and
// look identical to the previous version that was MISSING them.

func TestPipelineAPICarriesStagesAndHasPipeline(t *testing.T) {
	h := handler(fakeSource{pipe: pipeFixture(t)})
	rec := httptest.NewRecorder()
	h.servePipelineAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/pipeline.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	// Raw first — catches a MISSING key, which a struct decode would silently
	// zero-fill ("stages": null, hasPipeline: false) and lose the signal.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	for _, k := range []string{"hasPipeline", "stages"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("no %q in /app/api/pipeline.json — the React page cannot render what is not there", k)
		}
	}
	if string(raw["stages"]) == "null" {
		t.Errorf("stages is null; it must be [] so a client iterates without a guard")
	}

	var doc PipelinePageAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}

	// pipeFixture configures seven stages: recon, gate, select, build, review,
	// pr, respond. The handler must surface them in that order — a sorted or
	// reversed list would be a plausible-looking regression, which is why we
	// assert on the SEQUENCE rather than membership.
	wantNames := []string{"recon", "gate", "select", "build", "review", "pr", "respond"}
	if !doc.HasPipeline {
		t.Fatalf("hasPipeline = false with pipeFixture configured; the Stages panel on the React page is gated on this flag")
	}
	if got := stageNames(doc.Stages); !sequenceEq(got, wantNames) {
		t.Errorf("stage sequence = %v, want %v — stage order is the pipeline's own, not alphabetical", got, wantNames)
	}
}

// A dashboard with NO configured pipeline must return hasPipeline=false and
// stages=[]. The React page hides the Stages panel in that case; a true/non-
// empty combo would show a panel titled "0 stages" over an empty grid.
func TestPipelineAPIHidesStagesWithoutPipelineConfig(t *testing.T) {
	// No `pipe` on the fake source → p.HasPipeline is false in build().
	h := handler(fakeSource{})
	rec := httptest.NewRecorder()
	h.servePipelineAPI(rec, httptest.NewRequest(http.MethodGet, "/app/api/pipeline.json", nil))

	var doc PipelinePageAPI
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("bad decode: %v", err)
	}
	if doc.HasPipeline {
		t.Errorf("hasPipeline = true with no configured pipeline; the Stages panel would render for a user who never set one up")
	}
	if len(doc.Stages) != 0 {
		t.Errorf("stages has %d entries without a configured pipeline; must be empty so the React page cannot render a phantom row", len(doc.Stages))
	}
}

func stageNames(s []StageCount) []string {
	out := make([]string, 0, len(s))
	for _, c := range s {
		out = append(out, c.Name)
	}
	return out
}

func sequenceEq(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
