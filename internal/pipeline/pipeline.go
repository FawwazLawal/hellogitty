// Package pipeline shows where each repository sits in the user's own workflow. HelloGitty
// does not know that workflow; an optional command reports it as JSON:
//
//	{
//	  "stages": ["triage", "build", "review"],              // or [{"name": "triage", "abbr": "TRI"}]
//	  "labels": {"status": "Check", "flagged": "Repo flagged", "failed": "Stage failed", "notes": "Notes"},
//	  "repos": {
//	    "owner/name": {"stage": "build", "done": ["triage"], "failed": [],
//	                   "label": "PASS", "level": "ok", "notes": "/path/to/notes.md"}
//	  },
//	  "watch": [{"repo": "owner/name", "number": 123, "title": "..."}],
//	  "glossary": {"PASS": "what PASS means, shown when you hover it"}
//	}
//
// level is "ok" or "caution"; a caution repo lights the flagged cell. notes, when set, is a
// local text file served read-only at /notes/owner/name. watch, optional, lists issues you plan to
// work on, which HelloGitty checks for someone else getting there first.
package pipeline

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type StageState string

const (
	Done    StageState = "done"
	Current StageState = "current"
	Failed  StageState = "failed"
	Todo    StageState = "todo"
)

type Stage struct {
	Name string
	Abbr string
}

type Labels struct {
	Status, Flagged, Failed, Notes string
}

type Repo struct {
	Stage  string   `json:"stage"`
	Done   []string `json:"done"`
	Failed []string `json:"failed"`
	Label  string   `json:"label"`
	Level  string   `json:"level"`
	Notes  string   `json:"notes"`
}

// WatchIssue is an issue the user plans to work on.
type WatchIssue struct {
	Repo   string `json:"repo"`
	Number int    `json:"number"`
	Title  string `json:"title"`
}

type State struct {
	Stages []Stage
	Labels Labels
	Watch  []WatchIssue
	// Glossary explains the command's own words (its stages and verdicts) in the page's hover help.
	Glossary map[string]string
	repos    map[string]Repo
}

// Repo returns the entry for owner/name, matched without regard to case.
func (s *State) Repo(owner, name string) (Repo, bool) {
	if s == nil {
		return Repo{}, false
	}
	r, ok := s.repos[strings.ToLower(owner+"/"+name)]
	return r, ok
}

func (s *State) Len() int {
	if s == nil {
		return 0
	}
	return len(s.repos)
}

// Phases returns one state per stage, in stage order.
func (s *State) Phases(r Repo) []StageState {
	done, failed := set(r.Done), set(r.Failed)
	out := make([]StageState, len(s.Stages))
	for i, st := range s.Stages {
		switch {
		case done[st.Name]:
			out[i] = Done
		case st.Name == r.Stage && failed[st.Name]:
			out[i] = Failed
		case st.Name == r.Stage:
			out[i] = Current
		default:
			out[i] = Todo
		}
	}
	return out
}

// StageIndex is the position of name in the stage list, or -1.
func (s *State) StageIndex(name string) int {
	for i, st := range s.Stages {
		if st.Name == name {
			return i
		}
	}
	return -1
}

func Parse(b []byte) (*State, error) {
	var raw struct {
		Stages []json.RawMessage `json:"stages"`
		Labels struct {
			Status  string `json:"status"`
			Flagged string `json:"flagged"`
			Failed  string `json:"failed"`
			Notes   string `json:"notes"`
		} `json:"labels"`
		Repos    map[string]Repo   `json:"repos"`
		Watch    []WatchIssue      `json:"watch"`
		Glossary map[string]string `json:"glossary"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, fmt.Errorf("pipeline output: %w", err)
	}
	if len(raw.Stages) == 0 {
		return nil, errors.New("pipeline output lists no stages")
	}
	st := &State{repos: map[string]Repo{}, Glossary: raw.Glossary, Labels: Labels{
		Status: or(raw.Labels.Status, "Status"), Flagged: or(raw.Labels.Flagged, "Repo flagged"),
		Failed: or(raw.Labels.Failed, "Stage failed"), Notes: or(raw.Labels.Notes, "Notes"),
	}}
	for _, m := range raw.Stages {
		var name string
		var obj struct{ Name, Abbr string }
		if json.Unmarshal(m, &name) != nil {
			if err := json.Unmarshal(m, &obj); err != nil || obj.Name == "" {
				return nil, fmt.Errorf("pipeline output: bad stage %s", m)
			}
			name = obj.Name
		}
		abbr := obj.Abbr
		if abbr == "" {
			abbr = strings.ToUpper(name)
			if len(abbr) > 3 {
				abbr = abbr[:3]
			}
		}
		st.Stages = append(st.Stages, Stage{Name: name, Abbr: strings.ToUpper(abbr)})
	}
	for k, r := range raw.Repos {
		if r.Stage != "" && st.StageIndex(r.Stage) < 0 {
			return nil, fmt.Errorf("pipeline output: %s is in unknown stage %q", k, r.Stage)
		}
		st.repos[strings.ToLower(k)] = r
	}
	for _, w := range raw.Watch {
		if w.Number <= 0 || strings.Count(w.Repo, "/") != 1 {
			return nil, fmt.Errorf("pipeline output: bad watch entry %s#%d", w.Repo, w.Number)
		}
		st.Watch = append(st.Watch, w)
	}
	return st, nil
}

// Provider runs the pipeline command and caches its answer briefly, so page loads do not
// each spawn a process.
type Provider struct {
	Command []string
	Dir     string
	TTL     time.Duration
	Timeout time.Duration

	mu      sync.Mutex
	last    *State
	lastErr error
	at      time.Time
}

// Get returns nil, nil when no command is configured. On failure it returns the last good
// state, if any, together with the error.
func (p *Provider) Get(ctx context.Context) (*State, error) {
	if p == nil || len(p.Command) == 0 {
		return nil, nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	ttl := p.TTL
	if ttl == 0 {
		ttl = time.Minute
	}
	if !p.at.IsZero() && time.Since(p.at) < ttl {
		return p.last, p.lastErr
	}
	st, err := p.run(ctx)
	p.at = time.Now()
	if err != nil {
		p.lastErr = err
		return p.last, err
	}
	p.last, p.lastErr = st, nil
	return st, nil
}

func (p *Provider) run(ctx context.Context) (*State, error) {
	timeout := p.Timeout
	if timeout == 0 {
		timeout = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, p.Command[0], p.Command[1:]...)
	cmd.Dir = p.Dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		if msg != "" {
			return nil, fmt.Errorf("pipeline command: %v: %s", err, msg)
		}
		return nil, fmt.Errorf("pipeline command: %v", err)
	}
	return Parse(stdout.Bytes())
}

func set(xs []string) map[string]bool {
	m := make(map[string]bool, len(xs))
	for _, x := range xs {
		m[x] = true
	}
	return m
}

func or(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
