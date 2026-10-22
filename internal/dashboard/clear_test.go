package dashboard

import (
	"reflect"
	"testing"
)

func TestApplyCleared(t *testing.T) {
	cells := []cell{
		counter("repo-dormant", "Repo dormant", 2, "caution", []string{"audioFlux", "fisher"}, false),
		counter("watch-claimed", "Watched issue claimed", 1, "warn", []string{"SwiftFormat#2437"}, true),
		counter("stage-failed", "Task failed", 1, "caution", []string{"fastapi"}, false),
		{Key: "data-stale", Label: "Data is stale", Lit: true},
	}
	cleared := map[string]bool{
		ClearedID("watch-claimed", "SwiftFormat#2437"): true, // everything cleared: goes dark
		ClearedID("repo-dormant", "audioflux"):         true, // one of two: stays lit for the new one
		ClearedID("stage-failed", "meshery"):           true, // no longer failing: forgotten
	}
	forget := applyCleared(cells, cleared, true)

	if c := cells[1]; c.Lit || c.Cleared != 1 || c.Value != "0" || !c.Clearable {
		t.Errorf("fully cleared cell: lit=%v cleared=%d value=%q clearable=%v", c.Lit, c.Cleared, c.Value, c.Clearable)
	}
	if c := cells[0]; !c.Lit || c.Value != "1" || c.Detail != "fisher" || c.Cleared != 1 {
		t.Errorf("partly cleared cell: lit=%v value=%q detail=%q cleared=%d", c.Lit, c.Value, c.Detail, c.Cleared)
	}
	if c := cells[2]; !c.Lit || c.Cleared != 0 || c.ItemsAttr != "fastapi" {
		t.Errorf("uncleared cell changed: %+v", c)
	}
	if cells[3].Clearable {
		t.Error("data-stale must not be clearable")
	}
	if want := []string{ClearedID("stage-failed", "meshery")}; !reflect.DeepEqual(forget, want) {
		t.Errorf("forget = %v, want %v", forget, want)
	}
	// Before the first check nothing is forgotten, however empty the cells look.
	if f := applyCleared([]cell{counter("stage-failed", "Task failed", 0, "caution", nil, false)}, cleared, false); len(f) != 0 {
		t.Errorf("unsettled forget = %v", f)
	}
}
