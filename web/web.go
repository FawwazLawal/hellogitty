// Package web holds the dashboard template, compiled into the binary.
package web

import _ "embed"

//go:embed index.html
var Index string
