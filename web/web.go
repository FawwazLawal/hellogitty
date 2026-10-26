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

// Mascot holds the banner clips (kitten-routine-*.mp4, kitten-news-*.mp4) and the rest still
// (rest.png) under mascot/.
//
//go:embed mascot
var Mascot embed.FS
