package help

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/work"
)

func TestGlossaryIsACopy(t *testing.T) {
	g := Glossary()
	g["dot"] = Term{Label: "changed"}
	if Glossary()["dot"].Label != "Dot" {
		t.Error("changing the returned map must not change the glossary")
	}
	if NoteTerm("Behind main") != "behind" {
		t.Error("note chips map to terms")
	}
}

func TestWorkPeekJSON(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	p := WorkPeek(work.Item{PR: true, State: "OPEN", CreatedAt: now.Add(-time.Hour), Head: "fix", Base: "main"}, "me", now)
	b, _ := json.Marshal(p)
	want := `{"head":"Pull request · open","lines":[{"label":"Opened","items":["2026-10-21, 11:00"]},{"label":"Branch","items":["fix → main"]}]}`
	if string(b) != want {
		t.Errorf("JSON for the extension\n got  %s\n want %s", b, want)
	}
}
