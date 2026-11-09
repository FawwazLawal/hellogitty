package web

import (
	"strings"
	"testing"
)

// The splice is a build-time concatenation at package init: `strings.Replace`
// returns the string unchanged when the marker is absent, which would
// silently de-theme every pack. init() now panics in that case — if that
// panic ever gets removed, the two cheapest checks that still catch the
// regression are:
//
//   1. the marker string must exist in exactly one place (the constant)
//   2. a known pack selector must be present in Index after init()
//
// Both are below.

// TestThemePacksSplicedIntoIndex asserts the pack cascade reached Index.
// Pick a selector that only appears inside themes.css so a pass can only
// mean the splice happened — matching against something that also lives in
// base-css would catch only part of the regression.
func TestThemePacksSplicedIntoIndex(t *testing.T) {
	for _, needle := range []string{
		`:root[data-visual-theme="pink"]`,
		`:root[data-visual-theme="muertos"]`,
		`:root[data-theme="amoled"][data-visual-theme="oni"]`,
		`:root[data-theme="light"][data-visual-theme="oni"]`,
	} {
		if !strings.Contains(Index, needle) {
			t.Fatalf("themes.css not spliced into Index: selector %q absent — every theme pack would fall back to the base cascade", needle)
		}
	}
}

// TestThemePacksMarkerLiterallyExists guards the `strings.Contains` check in
// init(): if the constant were spelled one way and index.html another, init()
// would panic on the correct side of a typo nobody saw. Compare against the
// actual bytes of the raw template string before init() ran — but init() has
// already stripped the marker from Index, so compare against ThemePacks + a
// substring that would not be present under a typo. Simpler: assert the
// marker does NOT appear in Index (because init() replaced it), AND the
// content it was replaced with does.
func TestThemePacksMarkerReplaced(t *testing.T) {
	if strings.Contains(Index, themePacksMarker) {
		t.Fatalf("marker %q still present in Index; init() did not splice", themePacksMarker)
	}
	// ThemePacks itself must contain the file's header comment — if it is
	// empty, embed didn't see themes.css at build time.
	if !strings.Contains(ThemePacks, "pack-and-appearance token blocks") {
		t.Fatalf("ThemePacks does not look like themes.css contents; the //go:embed may have missed the file")
	}
}
