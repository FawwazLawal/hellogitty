package config

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func write(t *testing.T, path, body string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestParseRepo(t *testing.T) {
	for in, want := range map[string]string{
		"owner/name":                        "owner/name",
		"github.com/owner/name":             "owner/name",
		"https://github.com/Owner/Name.git": "Owner/Name",
		"https://github.com/owner/name/":    "owner/name",
	} {
		r, err := ParseRepo(in)
		if err != nil || r.String() != want {
			t.Errorf("%q -> %v %v, want %s", in, r, err, want)
		}
	}
	for _, bad := range []string{"", "owner", "https://gitlab.com/a/b", "a/b/c"} {
		if _, err := ParseRepo(bad); err == nil {
			t.Errorf("%q should fail", bad)
		}
	}
}

func TestLoadDefaultsAndRelativePaths(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "conf", "hellogitty.json"), `{"repos":["a/b"],"interval":"30m","pipeline_command":["./tools/stages","--x"]}`)
	c, err := Load(filepath.Join(dir, "conf", "hellogitty.json"))
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != DefaultListen || c.Database != DefaultDatabase || c.PollInterval != 30*time.Minute {
		t.Errorf("defaults: %+v", c)
	}
	if got := c.Path(c.Database); got != filepath.Join(dir, "conf", DefaultDatabase) {
		t.Errorf("database path %s", got)
	}
	if got := c.PipelineCommand(); got[0] != filepath.Join(dir, "conf", "tools", "stages") || got[1] != "--x" {
		t.Errorf("pipeline command %v", got)
	}
}

func TestLoadRejectsBadInput(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"typo.json":     `{"repo":["a/b"]}`,
		"interval.json": `{"repos":["a/b"],"interval":"10s"}`,
		"repo.json":     `{"repos":["not-a-repo"]}`,
	}
	for name, body := range cases {
		write(t, filepath.Join(dir, name), body)
		if _, err := Load(filepath.Join(dir, name)); err == nil {
			t.Errorf("%s should fail", name)
		}
	}
	if _, err := Load(filepath.Join(dir, "missing.json")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("missing file should be ErrNotExist, got %v", err)
	}
}

func TestTargetsMergesReposFile(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "list.json"), `{"repos":[
		{"upstream":"https://github.com/c/d"},
		{"repo":"e/f"},
		"https://github.com/A/B",
		{"folder":"no-url-here"}]}`)
	write(t, filepath.Join(dir, "plain.json"), `["g/h"]`)
	write(t, filepath.Join(dir, "hellogitty.json"), `{"repos":["a/b"],"repos_file":"list.json"}`)
	c, err := Load(filepath.Join(dir, "hellogitty.json"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.Targets()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, r := range got {
		names = append(names, r.String())
	}
	if want := []string{"a/b", "c/d", "e/f"}; !reflect.DeepEqual(names, want) {
		t.Errorf("targets %v, want %v (A/B is a duplicate of a/b)", names, want)
	}
	if l, err := ReadReposFile(filepath.Join(dir, "plain.json")); err != nil || len(l) != 1 || l[0] != "g/h" {
		t.Errorf("plain list: %v %v", l, err)
	}

	empty, _ := Default(dir)
	if _, err := empty.Targets(); err == nil {
		t.Error("no repositories should be an error")
	}
}
