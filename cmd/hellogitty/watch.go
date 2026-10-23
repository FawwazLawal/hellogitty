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
	"github.com/FawwazLawal/hellogitty/internal/store"
)

// The eye on an issue: watch it for someone claiming it or it closing, in any repository. Issues in
// repositories you track are checked with them; others are looked up one by one each check.

func watchKey(owner, name string, n int) string {
	return strings.ToLower(owner+"/"+name) + "#" + fmt.Sprint(n)
}

// WatchedKeys lists every watched issue as "owner/name#123" in lower case.
func (m repoManager) WatchedKeys() map[string]bool {
	all, err := m.st.AllWatches()
	if err != nil {
		log.Printf("watch list: %v", err)
		return nil
	}
	out := map[string]bool{}
	for _, w := range all {
		out[watchKey(w.Owner, w.Name, w.IssueNumber)] = true
	}
	return out
}

// SetWatch starts or stops watching an issue.
func (m repoManager) SetWatch(ctx context.Context, repo string, number int, on bool) (string, error) {
	r, err := config.ParseRepo(repo)
	if err != nil || number <= 0 {
		return "", errors.New("that isn't an issue HelloGitty can find")
	}
	if !on {
		removed, err := m.st.RemoveWatchByName(r.Owner, r.Name, number)
		if err == nil && !removed {
			return "", fmt.Errorf("%s#%d wasn't on your watch list", r, number)
		}
		return "", err
	}
	gi, err := m.gh.Issue(ctx, r.Owner, r.Name, number)
	var se *github.StatusError
	switch {
	case errors.As(err, &se) && se.Code == 404:
		return "", fmt.Errorf("GitHub has no issue %s#%d that your token can see", r, number)
	case err != nil:
		return "", fmt.Errorf("couldn't reach GitHub to check %s#%d: %v", r, number, err)
	case gi.PullRequest != nil:
		return "", errors.New("that's a pull request; the eye watches issues (pull requests you're part of already show under Your work or Conversations)")
	}
	// The eye sends names in lower case; store GitHub's own spelling ("nicklockwood/SwiftFormat"),
	// which is how the dashboard and the inbox show it. A repository already stored keeps its row.
	if info, err := m.gh.Repo(ctx, r.Owner, r.Name); err == nil && info.FullName != "" {
		if c, err := config.ParseRepo(info.FullName); err == nil {
			r = c
		}
	}
	id, err := m.st.UpsertRepo(r.Owner, r.Name, "https://github.com/"+r.String())
	if err != nil {
		return "", err
	}
	if err := m.st.AddWatch(id, number); err != nil {
		return "", err
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := m.p.CheckWatch(ctx, r.Owner, r.Name, number); err != nil {
			log.Printf("watch %s#%d (just added): %v", r, number, err)
		}
	}()
	if gi.State == "closed" {
		return "It's already closed.", nil
	}
	return "", nil
}

// OtherWatched returns watched issues in repositories you don't track, grouped by repository.
func (m repoManager) OtherWatched() []store.RepoReport {
	all, err := m.st.Report(0)
	if err != nil {
		return nil
	}
	tracked := map[string]bool{}
	for _, t := range m.p.Status().Targets {
		tracked[strings.ToLower(t.Owner+"/"+t.Name)] = true
	}
	var out []store.RepoReport
	for _, r := range all {
		if len(r.Watch) > 0 && !tracked[strings.ToLower(r.Owner+"/"+r.Name)] {
			out = append(out, r)
		}
	}
	return out
}

var _ dashboard.WatchSource = repoManager{}
