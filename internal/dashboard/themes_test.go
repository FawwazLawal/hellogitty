package dashboard

import (
	"fmt"
	"math"
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

	// Each entry is `<id>: { ... }`. The inner body may itself be empty. The key may be a
	// bareword identifier (pink, muertos) OR a quoted string ("muertos-v2") — the latter is
	// valid JS and is the only option when the id carries a hyphen, which the data attribute
	// and localStorage both do. The earlier parser matched barewords only and silently skipped
	// quoted-key packs, which made this test and its two neighbours give passing readings on an
	// incomplete pack list.
	entryRe := regexp.MustCompile(`(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*\{([^{}]*)\}`)
	amoledRe := regexp.MustCompile(`\bamoled\s*:\s*true\b`)

	var ids []string
	amoled := map[string]bool{}
	for _, m := range entryRe.FindAllStringSubmatch(body, -1) {
		id := m[1]
		if id == "" {
			id = m[2]
		}
		ids = append(ids, id)
		if amoledRe.MatchString(m[3]) {
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

// A pack is colour and ornament. It is not allowed to move the furniture: `.site-head` is
// `position: sticky` in the base stylesheet so the header stays pinned while the board scrolls,
// and a pack rule that sets `position` on it wins on specificity and silently un-pins the
// header for everyone who picks that pack. This shipped: the muertos-v2 pack set
// `position: relative` on `.site-head` to get a containing block it did not need — `sticky` is
// itself a positioned value and already provides one — and the header scrolled away. Nothing
// else caught it, because the pack's colours, registries and AMOLED block were all correct and
// the only symptom was a header that stopped sticking.
//
// `display` and `overflow` are banned alongside `position` as the other two properties that
// turn a recolour into a layout change.
//
// The pseudo-elements are deliberately exempt: `.site-head::after` is a pack's own overlay and
// `position: absolute` is correct there. They still serve as this test's vacuity anchor, since
// a stylesheet where no pack targets the header at all would make the check meaningless.
func TestNoPackOverridesSiteHeadLayout(t *testing.T) {
	// Comments first: the prose in this stylesheet names both `.site-head` and `position`, and
	// a naive selector/body split would read a comment as a selector and flag it.
	css := regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(web.Index, "")

	var anchors int
	var bodies []string
	for _, m := range regexp.MustCompile(`([^{}]*)\{([^{}]*)\}`).FindAllStringSubmatch(css, -1) {
		for _, part := range strings.Split(m[1], ",") {
			part = strings.TrimSpace(part)
			if !strings.Contains(part, "data-visual-theme=") || !strings.Contains(part, ".site-head") {
				continue
			}
			anchors++
			if strings.HasSuffix(part, ".site-head") {
				bodies = append(bodies, m[2])
			}
			break
		}
	}
	if anchors == 0 {
		t.Fatal("no pack-scoped rule in web/index.html targets .site-head at all — this guard is " +
			"matching nothing and would pass a regression by default")
	}

	banned := regexp.MustCompile(`(?m)^\s*(position|display|overflow)\s*:`)
	for _, body := range bodies {
		if m := banned.FindString(body); m != "" {
			t.Errorf("a visual-theme pack sets %q on the .site-head element in web/index.html.\n"+
				"That overrides the base stylesheet's `position: sticky` (or its display/overflow) "+
				"and un-pins the header for everyone using that pack.\nRule body:\n%s",
				strings.TrimSpace(strings.Trim(m, " :")), strings.TrimSpace(body))
		}
	}
	t.Logf("%d pack-scoped .site-head rules found, %d of them on the element itself", anchors, len(bodies))
}

// relLuminance is the WCAG 2.x relative luminance of an #rrggbb colour.
// Calibrated against the reference pair #767676 on #ffffff, which is 4.54:1.
// A :root token block and the colour tokens it declares.
type tokenBlock struct {
	selector string
	tokens   map[string]string
}

// tokenBlocks returns every :root{...} declaration block in the template, base
// appearances included — the existing pack parser matches only blocks carrying
// [data-visual-theme=...], which skips the two base blocks where the focus
// indicator defect actually lived.
//
// Comments are stripped first. A guard in the oni pack work matched commentary
// as if it were CSS because it did not, so this does it before parsing rather
// than filtering afterwards. The `{` must follow the attribute selectors
// immediately, so descendant rules like `:root[...] .panel { }` are not blocks.
func tokenBlocks(t *testing.T) []tokenBlock {
	t.Helper()
	src := regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(web.Index, "")
	blockRe := regexp.MustCompile(`:root((?:\[[^\]]*\])*)\s*\{([^{}]*)\}`)
	tokenRe := regexp.MustCompile(`--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})`)

	var out []tokenBlock
	for _, m := range blockRe.FindAllStringSubmatch(src, -1) {
		toks := map[string]string{}
		for _, tm := range tokenRe.FindAllStringSubmatch(m[2], -1) {
			toks[tm[1]] = tm[2]
		}
		if len(toks) == 0 {
			continue
		}
		sel := ":root" + m[1]
		out = append(out, tokenBlock{selector: sel, tokens: toks})
	}
	return out
}

func relLuminance(hex string) float64 {
	hex = strings.TrimPrefix(hex, "#")
	ch := make([]float64, 3)
	for i := 0; i < 3; i++ {
		var v int
		fmt.Sscanf(hex[i*2:i*2+2], "%02x", &v)
		c := float64(v) / 255
		if c <= 0.04045 {
			ch[i] = c / 12.92
		} else {
			ch[i] = math.Pow((c+0.055)/1.055, 2.4)
		}
	}
	return 0.2126*ch[0] + 0.7152*ch[1] + 0.0722*ch[2]
}

func contrastRatio(a, b string) float64 {
	la, lb := relLuminance(a), relLuminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

// The azure packs state in their own comments that --rule-hi carries the panel boundary on a
// true-black canvas, where --rule is deliberately too soft to do it. WCAG 2.2 SC 1.4.11 puts
// non-text UI indicators at 3:1, and --rule-hi is also the scrollbar thumb, so that claim has
// a number attached and this test holds them to it.
//
// WHY ONLY THE AZURE PACKS. Measured across every pack, --rule-hi clears 3:1 in azure-oni and
// azure-oni-v2 only. It does not in six shipped blocks:
//
//	pink       dark   #55304a on #1a0a12   1.74:1
//	pink       light  #e8a0be on #fff0f5   1.87:1
//	muertos    dark   #3d3350 on #0b0a10   1.68:1
//	muertos    light  #b9a988 on #f2ece0   1.96:1
//	muertos-v2 dark   #6b4e82 on #170f21   2.70:1
//	muertos-v2 light  #b89aa8 on #fff3df   2.33:1
//
// Those are real findings and they are recorded here rather than dropped, but raising them
// means recolouring three themes the owner designed, which is a decision for the owner and not
// a side effect of adding a pack. Widen the allow-list below once that call is made; do not
// widen it by lowering the threshold.
//
// The companion claim about --rule was simply false. Three AMOLED comments said --rule was
// "raised to clear 3:1 against #000"; measured, muertos is 3.16 but muertos-v2 is 1.63 and
// azure-oni is 1.84. The comments now say what is true. Prose cannot be checked, which is why
// the token that actually carries the requirement is measured here instead.
func TestRuleHiClearsThreeToOne(t *testing.T) {
	held := map[string]bool{"azure-oni": true, "azure-oni-v2": true}
	block := regexp.MustCompile(`:root(?:\[data-theme="(\w+)"\])?\[data-visual-theme="([^"]+)"\]\s*\{([^{}]*)\}`)
	tok := func(body, name string) string {
		m := regexp.MustCompile(`--` + name + `:\s*(#[0-9a-fA-F]{6})`).FindStringSubmatch(body)
		if m == nil {
			return ""
		}
		return m[1]
	}
	checked := 0
	for _, m := range block.FindAllStringSubmatch(web.Index, -1) {
		appearance, pack, body := m[1], m[2], m[3]
		if appearance == "" {
			appearance = "dark"
		}
		bg, hi := tok(body, "bg"), tok(body, "rule-hi")
		if bg == "" || hi == "" {
			continue // not a full token block; the pack inherits these
		}
		if !held[pack] {
			continue // see the allow-list note above
		}
		checked++
		if r := contrastRatio(hi, bg); r < 3.0 {
			t.Errorf("pack %q (%s): --rule-hi %s on --bg %s is %.2f:1, below the 3:1 that "+
				"WCAG 2.2 SC 1.4.11 requires of a non-text UI boundary.\n"+
				"--rule-hi is the separator that has to be seen; if this edge is meant to be "+
				"soft, use --rule for it and give --rule-hi a value that clears 3:1.",
				pack, appearance, hi, bg, r)
		}
	}
	if checked < 4 {
		t.Fatalf("only %d held pack token blocks were measured; expected at least 4 (two azure "+
			"packs x dark/amoled/light minus inherited blocks). This guard is barely matching "+
			"anything and would pass a regression by default", checked)
	}
	t.Logf("measured --rule-hi against --bg in %d pack token blocks", checked)
}

// --head-accent draws the keyboard focus indicator, so it is held to a floor.
//
// `.statrail a.stat:focus-visible` takes its border-color from --head-accent.
// That border IS the focus indicator for the stat tiles, which means WCAG SC
// 1.4.11 applies and 3:1 against the adjacent surface is the floor, not a
// preference. The same token also colours `.hclock.clock-led .hclock-date`,
// which is ordinary text and so carries the 4.5 floor on --head.
//
// Both base appearances shipped under those floors: dark at 2.87:1 against
// --panel and light at 2.08:1, meaning a keyboard user tabbing through the
// stat rail could barely see where focus was. The token reads as "a quiet
// accent", and quiet is a reasonable thing to want from a decorative border,
// which is how it got this pale — but the same token is doing a job where
// quiet is a defect.
//
// Every one of the thirteen pack blocks already cleared, so this has no
// allow-list and no exemptions. If one is ever needed, that is a signal the
// pack is wrong rather than the test.
func TestHeadAccentCarriesAVisibleFocusIndicator(t *testing.T) {
	blocks := tokenBlocks(t)
	if len(blocks) == 0 {
		t.Fatal("parsed no :root token blocks from web/index.html — the parser has drifted and this test would pass vacuously")
	}

	checked := 0
	for _, b := range blocks {
		accent, ok := b.tokens["head-accent"]
		if !ok {
			continue
		}
		// The focus ring is drawn on tiles sitting on --panel, over a page of
		// --bg; both are adjacent surfaces, so both carry the 3:1 floor.
		for _, surface := range []string{"panel", "bg"} {
			against, ok := b.tokens[surface]
			if !ok {
				continue
			}
			checked++
			if got := contrastRatio(accent, against); got < 3.0 {
				t.Errorf("%s: --head-accent %s on --%s %s is %.2f:1, below the 3:1 WCAG 1.4.11 floor for a focus indicator — a keyboard user cannot see which stat tile has focus",
					b.selector, accent, surface, against, got)
			}
		}
		// The led clock's date paints in this token, and that is text.
		//
		// No exemptions. Pink light used to miss this by a hundredth and a half
		// at 4.33:1 and was carried as a documented exception, on the precedent
		// the --rule-hi guard sets: record the finding, leave the owner's palette
		// alone. The owner then asked for it fixed, so the exception is gone and
		// every shipped block clears both floors on its own. Do not reintroduce a
		// skip list to make a new pack pass; a block that cannot clear 4.5:1 here
		// is painting unreadable text.
		if head, ok := b.tokens["head"]; ok {
			checked++
			if got := contrastRatio(accent, head); got < 4.5 {
				t.Errorf("%s: --head-accent %s on --head %s is %.2f:1, below 4.5:1 — `.hclock.clock-led .hclock-date` paints text in this token",
					b.selector, accent, head, got)
			}
		}
	}
	t.Logf("checked %d pairs across %d token blocks", checked, len(blocks))
}
