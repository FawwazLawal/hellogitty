// Package docs holds the user guide and its screenshot, compiled into the binary for the Help page.
package docs

import _ "embed"

// Guide is docs/GUIDE.md, the user guide.
//
//go:embed GUIDE.md
var Guide string

// Screenshot is docs/screenshot.png, the picture the guide opens with.
//
//go:embed screenshot.png
var Screenshot []byte
