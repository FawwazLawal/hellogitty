// Package web holds the dashboard template and the banner mascot clips, compiled into the binary.
package web

import (
	"embed"
	"strings"
)

//go:embed index.html
var Index string

// ThemePacks is the pack-and-appearance token cascade. The templated pages
// pull it in via the themePacksMarker inside their <style> blocks, and the
// Vite bundle imports the same file so React resolves the same values
// through the same cascade. See frontend/src/index.css for the bridge that
// maps template token names (--bg, --panel, --text…) to React's own
// (--hg-canvas, --hg-surface, --hg-text…).
//
//go:embed themes.css
var ThemePacks string

// themePacksMarker is where init() splices ThemePacks into Index. The name
// is a constant so the string exists in exactly one place; a marker typo in
// index.html would otherwise silently de-theme every pack.
const themePacksMarker = "/*!THEME-PACKS!*/"

// DO NOT REPLACE THIS SPLICE WITH {{template "theme-packs"}}.
//
// The obvious shape — {{define "theme-packs"}}…{{end}} plus a {{template}}
// call from base-css — hits html/template's CSS-context clone-depth guard.
// The engine creates a per-context clone of every sub-template reached
// from a <style> block, and base-css → theme-packs blows past the limit.
// This splice is a build-time concatenation of content we control; no
// escaping is needed, and bypassing the escaper is what makes it work.
//
// strings.Replace returns the string unchanged when the marker is absent,
// which would silently de-theme every pack if someone reformatted
// index.html and dropped the marker. That failure mode is this file's
// failure class, so init() refuses to leave in that state: it panics with
// the marker name and the file. Startup failure is loud and correct for a
// packaging error; a running binary with no packs is not.
func init() {
	if !strings.Contains(Index, themePacksMarker) {
		panic("web: " + themePacksMarker + " not found in web/index.html; every theme pack would silently fall back to the base cascade. Put the marker back in the <style> block.")
	}
	Index = strings.Replace(Index, themePacksMarker, ThemePacks, 1)
}

// Help is the Help page. It shares index.html's base styles and theme switch, so it is parsed
// together with it.
//
//go:embed help.html
var Help string

// Feed is the live activity feed on a page of its own, for a small window. Parsed with index.html.
//
//go:embed feed.html
var Feed string

// List is what a Pipeline number counts, on a page of its own. Parsed with index.html.
//
//go:embed list.html
var List string

// Issues is all open issues across tracked repos, on a page of its own. Parsed with index.html.
//
//go:embed issues.html
var Issues string

// Repos is the tracked repos on a page of its own. Parsed with index.html.
//
//go:embed repos.html
var Repos string

// Pipeline is the pipeline on a page of its own. Parsed with index.html.
//
//go:embed pipeline.html
var Pipeline string

// Conversations is the conversations on a page of its own. Parsed with index.html.
//
//go:embed conversations.html
var Conversations string

// YourRepos is your repositories on a page of its own. Parsed with index.html.
//
//go:embed your-repos.html
var YourRepos string

// Work is your work on a page of its own. Parsed with index.html.
//
//go:embed work.html
var Work string

//go:embed settings.html
var Settings string

//go:embed alert-your-move.html
var AlertYourMove string

//go:embed alert-watched-claimed.html
var AlertWatchedClaimed string

//go:embed alert-watched-closed.html
var AlertWatchedClosed string

//go:embed alert-check-failed.html
var AlertCheckFailed string

//go:embed alert-repo-health.html
var AlertRepoHealth string

//go:embed alert-unresolved-threads.html
var AlertUnresolvedThreads string

//go:embed alert-data-stale.html
var AlertDataStale string

//go:embed alert-repo-flagged.html
var AlertRepoFlagged string

//go:embed alert-stage-failed.html
var AlertStageFailed string

//go:embed alert-api-low.html
var AlertAPILow string

// Mascot holds the banner clips (kitten-routine-*.mp4, kitten-news-*.mp4) and the rest still
// (rest.png) under mascot/.
//
//go:embed favicon.svg
var Favicon []byte

//go:embed mascot
var Mascot embed.FS

// Art holds the scenic assets a visual pack paints with: wide header bands, empty-state scenes
// and ornamental pieces, under art/.
//
// These are raster rather than vector on purpose. The packs before this one drew their scenery
// as inline SVG, and the result was flat: a painted horizon with atmospheric depth is not a
// thing a few hundred path commands reach, and four rounds of trying established that at some
// cost. A 24 KB WebP carries more of the intended look than the 7 KB of SVG it replaces, and it
// is still smaller than one screenshot in docs/.
//
// Served from the binary like the mascot clips, so the offline-first guarantee is unchanged:
// no CDN, no network fetch, and the existing CSP (img-src 'self') already permits it.
//
// App is the built React application: the Vite output, compiled into the binary.
//
// `all:` so Vite's hashed asset directory is included — the default embed
// pattern skips files and directories beginning with _ or ., and a build can
// legitimately produce either.
//
// web/app holds a committed placeholder page, which is why this compiles in a
// checkout where nobody has run `pnpm build`. //go:embed fails on a missing
// directory, so without the placeholder the Go build would depend on a Node
// build having happened first — exactly the coupling §7 says to avoid.
//
// App also carries the scenic art under `app/art/` — Vite copies the
// contents of `frontend/public/art/` into its build output, which this
// embed picks up with every bundle rebuild. There is no parallel
// //go:embed for `web/art/` any more; that mirror was hand-maintained
// and has been removed in favour of this single source. The handler's
// /art/ route reads from App at the `art/` sub-FS and keeps its own
// (shorter) Cache-Control, since those filenames are not fingerprinted.
//
//go:embed all:app
var App embed.FS
