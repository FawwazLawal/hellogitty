package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/config"
	"github.com/FawwazLawal/hellogitty/internal/dashboard"
	"github.com/FawwazLawal/hellogitty/internal/github"
	"github.com/FawwazLawal/hellogitty/internal/poller"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

// targets is what HelloGitty tracks: the config file's repositories, minus the ones you removed on
// the dashboard, plus the ones you added there.
func targets(cfg *config.Config, st *store.Store) ([]config.Repo, error) {
	added, removed, err := st.RepoChoices()
	if err != nil {
		return nil, err
	}
	base, err := cfg.Targets()
	if err != nil && len(added) == 0 {
		return nil, err
	}
	gone := map[string]bool{}
	for _, r := range removed {
		gone[strings.ToLower(r)] = true
	}
	var out []config.Repo
	seen := map[string]bool{}
	for _, r := range base {
		k := strings.ToLower(r.String())
		if !gone[k] && !seen[k] {
			seen[k] = true
			out = append(out, r)
		}
	}
	for _, raw := range added {
		r, err := config.ParseRepo(raw)
		if err != nil {
			continue // written by AddRepo, which parsed it; never worth stopping the poll over
		}
		if k := strings.ToLower(r.String()); !seen[k] {
			seen[k] = true
			out = append(out, r)
		}
	}
	return out, nil
}

// inConfig reports whether the config file itself lists a repository.
func inConfig(cfg *config.Config, full string) bool {
	base, _ := cfg.Targets()
	for _, r := range base {
		if strings.EqualFold(r.String(), full) {
			return true
		}
	}
	return false
}

// repoManager adds and removes tracked repositories for the dashboard.
type repoManager struct {
	cfg *config.Config
	st  *store.Store
	gh  *github.Client
	p   *poller.Poller
}

// AddRepo checks a repository exists, starts tracking it and polls it straight away. note is
// something worth saying about a repository that was added.
func (m repoManager) AddRepo(ctx context.Context, raw string) (full, note string, err error) {
	r, err := config.ParseRepo(strings.TrimSpace(raw))
	if err != nil {
		return "", "", errors.New("type it as owner/name, or paste its GitHub address")
	}
	info, err := m.gh.Repo(ctx, r.Owner, r.Name)
	var se *github.StatusError
	switch {
	case errors.As(err, &se) && se.Code == 404:
		return "", "", fmt.Errorf("GitHub has no repository %s that your token can see", r)
	case err != nil:
		return "", "", fmt.Errorf("couldn't reach GitHub to check %s: %v", r, err)
	}
	full = info.FullName // GitHub's own spelling, and where a renamed repository went
	if full == "" {
		full = r.String()
	}
	cur, err := targets(m.cfg, m.st)
	if err != nil {
		return "", "", err
	}
	for _, t := range cur {
		if strings.EqualFold(t.String(), full) {
			return "", "", fmt.Errorf("already tracking %s", full)
		}
	}
	if inConfig(m.cfg, full) {
		err = m.st.ForgetRepoChoice(full) // it was removed here; the config file lists it again
	} else {
		err = m.st.SetRepoChoice(full, store.RepoAdded, time.Now().UTC())
	}
	if err != nil {
		return "", "", err
	}
	owner, name, _ := strings.Cut(full, "/")
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := m.p.PollOne(ctx, poller.Target{Owner: owner, Name: name, Upstream: "https://github.com/" + full}); err != nil {
			log.Printf("poll %s (just added): %v", full, err)
		}
	}()
	if info.Archived {
		note = "It's archived, so nothing sent there will be reviewed."
	}
	return full, note, nil
}

// RemoveRepo stops tracking a repository. Its history stays in the database, so adding it back
// later picks up where it left off.
func (m repoManager) RemoveRepo(full string) error {
	r, err := config.ParseRepo(full)
	if err != nil {
		return err
	}
	if inConfig(m.cfg, r.String()) {
		err = m.st.SetRepoChoice(r.String(), store.RepoRemoved, time.Now().UTC())
	} else {
		err = m.st.ForgetRepoChoice(r.String())
	}
	if err != nil {
		return err
	}
	m.p.Drop(r.Owner, r.Name)
	return nil
}

// Removed lists the config file's repositories you removed here, which can come back with one click.
func (m repoManager) Removed() []string {
	_, removed, err := m.st.RepoChoices()
	if err != nil {
		return nil
	}
	var out []string
	for _, r := range removed {
		if inConfig(m.cfg, r) {
			out = append(out, r)
		}
	}
	return out
}

// Ready reports whether a repository is among those last checked.
func (m repoManager) Ready(full string) bool {
	for _, t := range m.p.Status().Targets {
		if strings.EqualFold(t.Owner+"/"+t.Name, full) {
			return true
		}
	}
	return false
}

var _ dashboard.RepoSource = repoManager{}
