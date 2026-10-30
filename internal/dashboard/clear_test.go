package dashboard

import (
	"reflect"
	"sort"
	"testing"
)

func TestApplyCleared(t *testing.T) {
	present := []clearedState{
		{Key: "watch-claimed", Items: []string{"SwiftFormat#2437"}},                 // still lit; a cleared id for it stays
		{Key: "watch-closed", Items: []string{"audioflux#120", "fastapi#999"}},      // one id is gone and will be forgotten
		{Key: "data-stale", Items: []string{"anything"}},                            // not clearable; ignored
		{Key: "stage-failed", Items: nil},                                           // every cleared id for the key is stale
	}
	cleared := map[string]bool{
		ClearedID("watch-claimed", "SwiftFormat#2437"): true,
		ClearedID("watch-closed", "audioflux#120"):     true,
		ClearedID("watch-closed", "ghost#404"):         true, // not in present → forget
		ClearedID("stage-failed", "meshery"):           true, // key not in present → forget
		ClearedID("data-stale", "anything"):            true, // key not clearable → never considered
	}

	got := applyCleared(present, cleared, true)
	sort.Strings(got)
	want := []string{
		ClearedID("stage-failed", "meshery"),
		ClearedID("watch-closed", "ghost#404"),
	}
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("applyCleared forget = %v, want %v", got, want)
	}

	// data-stale is not clearable, so a cleared id against it must survive the sweep.
	if got := applyCleared(present, cleared, true); contains(got, ClearedID("data-stale", "anything")) {
		t.Errorf("applyCleared swept a non-clearable key: %v", got)
	}

	// Before the first check nothing is forgotten, however empty the states look.
	if got := applyCleared(present, cleared, false); got != nil {
		t.Errorf("applyCleared unsettled forget = %v, want nil", got)
	}
}

func contains(xs []string, x string) bool {
	for _, s := range xs {
		if s == x {
			return true
		}
	}
	return false
}
