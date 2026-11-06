// Package web holds the dashboard template and the banner mascot clips, compiled into the binary.
package web

import "embed"

//go:embed index.html
var Index string

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
//go:embed art
var Art embed.FS
