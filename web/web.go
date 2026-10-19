// Package web holds the dashboard template and the banner mascot clips, compiled into the binary.
package web

import "embed"

//go:embed index.html
var Index string

// Mascot holds the banner clips (kitten-routine-*.mp4, kitten-news-*.mp4) and the rest still
// (rest.png) under mascot/.
//
//go:embed mascot
var Mascot embed.FS
