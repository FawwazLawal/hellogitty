package main

import "testing"

func TestDescribeFollowsTheCodenameCycle(t *testing.T) {
	codenames[2] = "Calico Blue"
	defer delete(codenames, 2)

	cases := []struct {
		in, title string
	}{
		{"", "dev (unreleased build)"},
		{"dev", "dev (unreleased build)"},
		{"v0.1.1-0.20261019081530-abcdef012345", "dev (unreleased build)"},
		{"v0.1.0", "v0.1.0 - Black Bombay (baby)"},
		{"v0.9.3", "v0.9.0 (3) - Black Bombay (baby)"},
		{"v1.0.0", "v1.0.0 - Black Bombay"},
		{"v1.2.0", "v1.2.0 - Black Bombay"},
		{"v2.0.0-beta.1", "v2.0.0-beta.1 - Calico Blue (baby)"},
		{"v2.0.0", "v2.0.0 - Calico Blue"},
		{"v2.1.0-rc.1", "v2.1.0-rc.1 - Calico Blue"},
		{"v3.0.0", "v3.0.0"},
		{"not-semver", "not-semver"},
	}
	for _, c := range cases {
		if got := describe(c.in, "").title(); got != c.title {
			t.Errorf("describe(%q) = %q, want %q", c.in, got, c.title)
		}
	}
	if got := describe("v0.1.0", "Override Cat").title(); got != "v0.1.0 - Override Cat (baby)" {
		t.Errorf("ldflags codename override: %q", got)
	}
}

func TestDashboardVersionCarriesBabySeparately(t *testing.T) {
	old, rec := version, releaseRecord
	defer func() { version, releaseRecord = old, rec }()
	releaseRecord = ""

	version = "v0.1.0"
	if label, baby := dashboardVersion(); label != "v0.1.0 · Black Bombay" || !baby {
		t.Errorf("v0.1.0: %q baby=%v", label, baby)
	}
	if line := versionLine(); line != "hellogitty v0.1.0 - Black Bombay (baby)" {
		t.Errorf("-version: %q", line)
	}
	version = "v1.0.0"
	if label, baby := dashboardVersion(); label != "v1.0.0 · Black Bombay" || baby {
		t.Errorf("v1.0.0: %q baby=%v", label, baby)
	}
	version = "dev"
	if label, baby := dashboardVersion(); label != "dev build" || baby {
		t.Errorf("dev: %q baby=%v", label, baby)
	}
}

func TestThePublishNumberShowsInBrackets(t *testing.T) {
	old, rec := version, releaseRecord
	defer func() { version, releaseRecord = old, rec }()
	releaseRecord = "v0.2.3\n"

	for v, want := range map[string]string{"v0.1.0": "v0.1.0", "v0.1.4": "v0.1.0 (4)", "v0.2.3": "v0.2.0 (3)",
		"v1.2.12": "v1.2.0 (12)", "v2.0.0-beta.1": "v2.0.0-beta.1", "junk": "junk"} {
		if got := shown(v); got != want {
			t.Errorf("shown(%q) = %q, want %q", v, got, want)
		}
	}
	version = "v0.2.3"
	if label, _ := dashboardVersion(); label != "v0.2.0 (3) · Black Bombay" {
		t.Errorf("release: %q", label)
	}
	if line := versionLine(); line != "hellogitty v0.2.0 (3) - Black Bombay (baby)" {
		t.Errorf("-version: %q", line)
	}
	version = "dev"
	if label, _ := dashboardVersion(); label != "dev build · after v0.2.0 (3)" {
		t.Errorf("dev: %q", label)
	}
	if line := versionLine(); line != "hellogitty dev (unreleased build, after v0.2.0 (3))" {
		t.Errorf("dev -version: %q", line)
	}
	releaseRecord = "garbage"
	if label, _ := dashboardVersion(); label != "dev build" {
		t.Errorf("no record: %q", label)
	}
}
