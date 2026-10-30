package dashboard

import (
	"regexp"
	"strings"
	"testing"

	"github.com/FawwazLawal/hellogitty/web"
)

// The visual-theme packs live in two registries that are hand-synced:
//
//   web/index.html     var VISUAL_THEMES = { pink: { label: "(pinky v2)" } };
//   web/settings.html  var VISUAL_THEMES = [ { id: "pink", name: "Pinky v2", ... } ];
//
// index.html's object is what the apply-script consults; settings.html's array is what the
// swatch gallery renders. A pack listed in only one half-exists: selectable but unlabelled, or
// labelled but unpickable. The tests below read the embedded templates and keep the two
// registries, and the stylesheet, in step.

// indexPackIDs returns the ids in web/index.html's VISUAL_THEMES object, with a second map that
// is true for the ids whose entry declares amoled: true.
func indexPackIDs(t *testing.T) ([]string, map[string]bool) {
	t.Helper()
	// The object is written on one line and may contain nested braces for each entry's body.
	// Scan for `var VISUAL_THEMES = {` and walk forward until the matching `}`.
	start := strings.Index(web.Index, "var VISUAL_THEMES = {")
	if start < 0 {
		t.Fatal(`web/index.html has no "var VISUAL_THEMES = {" — the registry has moved or renamed`)
	}
	rest := web.Index[start+len("var VISUAL_THEMES = {"):]
	depth := 1
	end := -1
	for i, r := range rest {
		switch r {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				end = i
			}
		}
		if end >= 0 {
			break
		}
	}
	if end < 0 {
		t.Fatal(`web/index.html's VISUAL_THEMES object is unterminated`)
	}
	body := rest[:end]

	// Each entry is `<id>: { ... }`. The inner body may itself be empty.
	entryRe := regexp.MustCompile(`([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{([^{}]*)\}`)
	amoledRe := regexp.MustCompile(`\bamoled\s*:\s*true\b`)

	var ids []string
	amoled := map[string]bool{}
	for _, m := range entryRe.FindAllStringSubmatch(body, -1) {
		id := m[1]
		ids = append(ids, id)
		if amoledRe.MatchString(m[2]) {
			amoled[id] = true
		}
	}
	return ids, amoled
}

// settingsPackIDs returns the ids declared in web/settings.html's VISUAL_THEMES array.
func settingsPackIDs(t *testing.T) []string {
	t.Helper()
	start := strings.Index(web.Settings, "var VISUAL_THEMES = [")
	if start < 0 {
		t.Fatal(`web/settings.html has no "var VISUAL_THEMES = [" — the registry has moved or renamed`)
	}
	rest := web.Settings[start+len("var VISUAL_THEMES = ["):]
	end := strings.Index(rest, "];")
	if end < 0 {
		t.Fatal(`web/settings.html's VISUAL_THEMES array is unterminated`)
	}
	body := rest[:end]

	idRe := regexp.MustCompile(`\bid\s*:\s*"([^"]+)"`)
	var ids []string
	for _, m := range idRe.FindAllStringSubmatch(body, -1) {
		ids = append(ids, m[1])
	}
	return ids
}

// The index.html registry drives the apply-script; the settings.html registry drives the swatch
// gallery. An id in only one of them means the pack is either unpickable or unlabelled. Report
// both directions because they fail differently: an index-only pack cannot be chosen; a
// settings-only pack can be chosen but keeps the default codename and no AMOLED button.
func TestVisualThemeRegistriesAgree(t *testing.T) {
	indexIDs, _ := indexPackIDs(t)
	settingsIDs := settingsPackIDs(t)
	if len(indexIDs) == 0 {
		t.Fatal(`parsed no packs from web/index.html's VISUAL_THEMES — the test's parser has drifted from the template's shape`)
	}
	if len(settingsIDs) == 0 {
		t.Fatal(`parsed no packs from web/settings.html's VISUAL_THEMES — the test's parser has drifted from the template's shape`)
	}

	inSettings := map[string]bool{}
	for _, id := range settingsIDs {
		inSettings[id] = true
	}
	for _, id := range indexIDs {
		if !inSettings[id] {
			t.Errorf(`pack %q is in web/index.html's VISUAL_THEMES but missing from web/settings.html — the swatch gallery will not offer it`, id)
		}
	}

	inIndex := map[string]bool{}
	for _, id := range indexIDs {
		inIndex[id] = true
	}
	for _, id := range settingsIDs {
		if !inIndex[id] {
			t.Errorf(`pack %q is in web/settings.html's VISUAL_THEMES but missing from web/index.html — the gallery will offer it, but the apply-script will not know the codename or whether to show the AMOLED button`, id)
		}
	}
}

// Each pack needs CSS blocks for both default-dark and Light. A pack with no light variant
// inherits default-mode colours when the viewer is on Light, which half-applies the theme.
func TestEveryVisualThemePackHasDarkAndLightBlocks(t *testing.T) {
	ids, _ := indexPackIDs(t)
	for _, id := range ids {
		dark := `:root[data-visual-theme="` + id + `"]`
		light := `:root[data-theme="light"][data-visual-theme="` + id + `"]`
		if !strings.Contains(web.Index, dark) {
			t.Errorf(`pack %q has no %s CSS block in web/index.html — it is selectable but has no colours`, id, dark)
		}
		if !strings.Contains(web.Index, light) {
			t.Errorf(`pack %q has no %s CSS block in web/index.html — the pack breaks for anyone on Light`, id, light)
		}
	}
}

// A pack declaring `amoled: true` adds an AMOLED button to the theme switch. The button without
// a matching stylesheet rule paints default-dark colours while claiming to be true black, and
// without the pre-paint accepting "amoled" the appearance resets to dark on every reload.
func TestAmoledPacksHaveAmoledBlockAndSurviveReload(t *testing.T) {
	ids, amoled := indexPackIDs(t)
	anyAmoled := false
	for _, id := range ids {
		if !amoled[id] {
			continue
		}
		anyAmoled = true
		block := `:root[data-theme="amoled"][data-visual-theme="` + id + `"]`
		if !strings.Contains(web.Index, block) {
			t.Errorf(`pack %q declares amoled: true but has no %s CSS block in web/index.html — the AMOLED button paints no tokens`, id, block)
		}
	}
	if !anyAmoled {
		return
	}

	// The pre-paint runs before first paint and sets data-theme from localStorage. It accepts a
	// short allow-list; "amoled" has to be on it or the saved true-black appearance is dropped
	// on every reload.
	prePaint := regexp.MustCompile(`localStorage\.getItem\("hellogitty-theme"\)[\s\S]*?\}\s*catch`).FindString(web.Index)
	if prePaint == "" {
		t.Fatal(`cannot locate the pre-paint try/catch that reads "hellogitty-theme" in web/index.html`)
	}
	if !strings.Contains(prePaint, `"amoled"`) {
		t.Error(`web/index.html's pre-paint script does not accept "amoled" as a saved theme — any amoled pack loses its third appearance on reload`)
	}
}
