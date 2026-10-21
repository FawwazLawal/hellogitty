package main

import (
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
)

// Set at build time for release builds:
//
//	go build -ldflags "-X main.version=v0.1.0" ./cmd/hellogitty
//
// codename overrides the table below; it is rarely needed.
var (
	version  = ""
	codename = ""
)

// codenames maps each major version line to its codename. A codename owns one major line:
// it is a baby until the owner graduates it at X.0.0. Black Bombay alone also owns the 0.x
// line, its baby phase. Only the owner adds an entry here.
var codenames = map[int]string{
	0: "Black Bombay",
	1: "Black Bombay",
}

// Go pseudo-versions, as from `go install ...@main`, end in a timestamp and a commit hash.
var pseudoVersion = regexp.MustCompile(`-(0\.)?\d{14}-[0-9a-f]{12}$`)

type buildInfo struct {
	Version  string // "dev", or a semver tag such as v0.1.0
	Codename string // "" when unknown
	Baby     bool
}

func currentBuild() buildInfo {
	v := version
	if v == "" {
		if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
			v = info.Main.Version
		}
	}
	return describe(v, codename)
}

// describe applies the naming scheme to a version string.
func describe(v, nameOverride string) buildInfo {
	if v == "" || v == "dev" || pseudoVersion.MatchString(v) {
		return buildInfo{Version: "dev"}
	}
	major, minor, patch, pre, ok := parseSemver(v)
	if !ok {
		return buildInfo{Version: v, Codename: nameOverride}
	}
	name := nameOverride
	if name == "" {
		name = codenames[major]
	}
	// 0.x exists once, so only the first codename's baby phase lives there. Every later
	// codename is a baby only in the prereleases of its own X.0.0.
	baby := major == 0 || (pre != "" && minor == 0 && patch == 0)
	return buildInfo{Version: v, Codename: name, Baby: baby && name != ""}
}

func parseSemver(v string) (major, minor, patch int, pre string, ok bool) {
	core, pre, _ := strings.Cut(strings.TrimPrefix(v, "v"), "-")
	core, _, _ = strings.Cut(core, "+")
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return 0, 0, 0, "", false
	}
	n := make([]int, 3)
	for i, p := range parts {
		x, err := strconv.Atoi(p)
		if err != nil || x < 0 {
			return 0, 0, 0, "", false
		}
		n[i] = x
	}
	return n[0], n[1], n[2], pre, true
}

// title is the human name of a build, the same form as a release title:
// "v0.1.0 - Black Bombay (baby)".
func (b buildInfo) title() string {
	if b.Version == "dev" {
		return "dev (unreleased build)"
	}
	if b.Codename == "" {
		return b.Version
	}
	t := b.Version + " - " + b.Codename
	if b.Baby {
		t += " (baby)"
	}
	return t
}

// versionLine is the -version output.
func versionLine() string { return "hellogitty " + currentBuild().title() }

// dashboardVersion is the header label; the baby marker is returned separately so the page can
// set it apart.
func dashboardVersion() (label string, baby bool) {
	b := currentBuild()
	if b.Version == "dev" {
		return "dev build", false
	}
	if b.Codename == "" {
		return b.Version, false
	}
	return b.Version + " · " + b.Codename, b.Baby
}
