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

// Mascot holds the banner clips (kitten-routine-*.mp4, kitten-news-*.mp4) and the rest still
// (rest.png) under mascot/.
//
//go:embed mascot
var Mascot embed.FS
