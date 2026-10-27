// Package config loads HelloGitty's settings from a JSON file.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	DefaultFile     = "hellogitty.json"
	DefaultListen   = "localhost:7340"
	DefaultInterval = 60 * time.Minute
	DefaultDatabase = "hellogitty.db"
	DefaultSnapshot = "snapshot.json"
)

// Config is the parsed settings file. Relative paths resolve against the file's own folder.
type Config struct {
	// Repos lists repositories as "owner/name" or GitHub URLs.
	Repos []string `json:"repos"`
	// ReposFile names a JSON file that lists more repositories. It is re-read on every poll,
	// so editing it changes what is tracked without a restart.
	ReposFile string `json:"repos_file"`
	Listen    string `json:"listen"`
	Interval  string `json:"interval"`
	Database  string `json:"database"`
	Snapshot  string `json:"snapshot"`
	// Pipeline optionally names a command that prints per-repo workflow stages as JSON.
	Pipeline []string `json:"pipeline_command"`
	// Maintain lists repositories ("owner/name") or organisations ("org") you maintain, beyond the
	// ones your account owns. Their open pull requests and issues show under "Waiting on you".
	Maintain []string `json:"maintain"`
	// Inbox optionally names a JSON file rewritten after every refresh with recent events on your
	// own pull requests and watched issues, for scripts to pick up.
	Inbox string `json:"inbox"`
	// Layout sets the starting layout for browsers that have not saved one yet.
	Layout *LayoutConfig `json:"layout,omitempty"`

	Dir          string        `json:"-"`
	PollInterval time.Duration `json:"-"`
}

// LayoutConfig is the "layout" key in hellogitty.json. Either Preset names one of the built-in
// presets ("everything", "contributor", "maintainer", "program", "focus"), or Modules lists the
// panels to show and their columns explicitly. When both are set, Preset wins.
type LayoutConfig struct {
	Preset  string          `json:"preset,omitempty"`
	Main    []string        `json:"main,omitempty"`
	Rail    []string        `json:"rail,omitempty"`
	Hidden  []string        `json:"hidden,omitempty"`
	Folded  []string        `json:"folded,omitempty"`
}

type Repo struct{ Owner, Name string }

func (r Repo) String() string { return r.Owner + "/" + r.Name }

// Load reads path. A missing file is not an error when repos are supplied another way, so the
// caller decides; it gets os.ErrNotExist wrapped.
func Load(path string) (*Config, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	c := &Config{}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(c); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	c.Dir = filepath.Dir(abs)
	return c, c.finish()
}

// Default returns settings for running from flags alone, rooted at dir.
func Default(dir string) (*Config, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	c := &Config{Dir: abs}
	return c, c.finish()
}

func (c *Config) finish() error {
	if c.Listen == "" {
		c.Listen = DefaultListen
	}
	if c.Database == "" {
		c.Database = DefaultDatabase
	}
	if c.Snapshot == "" {
		c.Snapshot = DefaultSnapshot
	}
	c.PollInterval = DefaultInterval
	if c.Interval != "" {
		d, err := time.ParseDuration(c.Interval)
		if err != nil {
			return fmt.Errorf("interval %q: %w", c.Interval, err)
		}
		if d < time.Minute {
			return fmt.Errorf("interval %s is under one minute; GitHub's rate limit will not keep up", d)
		}
		c.PollInterval = d
	}
	for _, r := range c.Repos {
		if _, err := ParseRepo(r); err != nil {
			return err
		}
	}
	for _, m := range c.Maintain {
		if strings.ContainsAny(strings.TrimSpace(m), " :") || strings.Count(m, "/") > 1 || strings.TrimSpace(m) == "" {
			return fmt.Errorf("maintain: want owner/name or an organisation name, got %q", m)
		}
	}
	return nil
}

// Path resolves p against the config file's folder.
func (c *Config) Path(p string) string {
	if p == "" || filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(c.Dir, p)
}

// PipelineCommand returns the pipeline command with a relative executable path resolved.
func (c *Config) PipelineCommand() []string {
	if len(c.Pipeline) == 0 {
		return nil
	}
	cmd := append([]string(nil), c.Pipeline...)
	if strings.ContainsRune(cmd[0], filepath.Separator) && !filepath.IsAbs(cmd[0]) {
		cmd[0] = c.Path(cmd[0])
	}
	return cmd
}

// Targets returns the tracked repositories: Repos plus whatever ReposFile lists now.
func (c *Config) Targets() ([]Repo, error) {
	var out []Repo
	seen := map[string]bool{}
	add := func(raw string) error {
		r, err := ParseRepo(raw)
		if err != nil {
			return err
		}
		key := strings.ToLower(r.String())
		if !seen[key] {
			seen[key] = true
			out = append(out, r)
		}
		return nil
	}
	for _, raw := range c.Repos {
		if err := add(raw); err != nil {
			return nil, err
		}
	}
	if c.ReposFile != "" {
		listed, err := ReadReposFile(c.Path(c.ReposFile))
		if err != nil {
			return nil, err
		}
		for _, raw := range listed {
			if err := add(raw); err != nil {
				return nil, fmt.Errorf("%s: %w", c.ReposFile, err)
			}
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no repositories configured")
	}
	return out, nil
}

// ReadReposFile accepts any of: ["owner/name", ...], {"repos": [...]}, where each entry is a
// string or an object with a "repo", "url" or "upstream" field.
func ReadReposFile(path string) ([]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw json.RawMessage = b
	var wrapped struct {
		Repos json.RawMessage `json:"repos"`
	}
	if len(b) > 0 && strings.TrimSpace(string(b))[0] == '{' {
		if err := json.Unmarshal(b, &wrapped); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		raw = wrapped.Repos
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("%s: expected a list of repositories: %w", path, err)
	}
	var out []string
	for _, e := range entries {
		var s string
		if json.Unmarshal(e, &s) == nil {
			out = append(out, s)
			continue
		}
		var obj struct{ Repo, URL, Upstream string }
		if err := json.Unmarshal(e, &obj); err != nil {
			return nil, fmt.Errorf("%s: unreadable entry %s", path, e)
		}
		for _, v := range []string{obj.Repo, obj.URL, obj.Upstream} {
			if v != "" {
				out = append(out, v)
				break
			}
		}
	}
	return out, nil
}

// ParseRepo accepts "owner/name", "github.com/owner/name" or a full GitHub URL.
func ParseRepo(raw string) (Repo, error) {
	s := strings.TrimSpace(raw)
	if strings.Contains(s, "://") {
		u, err := url.Parse(s)
		if err != nil || !strings.EqualFold(u.Host, "github.com") {
			return Repo{}, fmt.Errorf("not a github.com repository: %q", raw)
		}
		s = u.Path
	} else {
		s = strings.TrimPrefix(strings.TrimPrefix(s, "github.com/"), "www.github.com/")
	}
	parts := strings.Split(strings.Trim(strings.TrimSuffix(s, ".git"), "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return Repo{}, fmt.Errorf("want owner/name, got %q", raw)
	}
	return Repo{Owner: parts[0], Name: parts[1]}, nil
}
