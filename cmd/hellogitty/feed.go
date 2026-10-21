package main

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/dashboard"
	"github.com/FawwazLawal/hellogitty/internal/feed"
	"github.com/FawwazLawal/hellogitty/internal/inbox"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

// entries is what the inbox file and the activity feed share: events on your own work, overlap
// reports, and new issues worth a decision. ok is false until the work board and the overlap watcher
// have each run once, so nothing half-built is written.
func (s source) entries(now time.Time) ([]inbox.Entry, bool) {
	b, _ := s.board.Snapshot()
	if b == nil {
		return nil, false
	}
	reports, err := tracked(s.st, s.p)
	if err != nil {
		log.Printf("inbox: %v", err)
		return nil, false
	}
	seen := func(id string) time.Time {
		t, err := s.st.FirstSeen(id, now)
		if err != nil {
			return now
		}
		return t
	}
	entries := inbox.Build(b, reports, seen)
	watching, ready := s.ov.Watching()
	if !ready {
		return nil, false
	}
	if rows, err := s.st.Overlaps(); err != nil {
		log.Printf("inbox: overlap reports left out: %v", err) // the rest of the inbox still matters
	} else {
		entries = inbox.WithOverlaps(entries, rows, watching)
	}
	if issues, err := s.st.RecentIssues(now.Add(-inbox.NewIssueWindow)); err != nil {
		log.Printf("inbox: new issues left out: %v", err)
	} else {
		entries = inbox.Sorted(append(entries, inbox.NewIssues(issues, s.planning(reports), now)...))
	}
	return entries, true
}

// planning lists the repositories where you are planning work, "owner/name" in lower case: those
// with an issue on the pipeline's watch list or on your own watch list.
func (s source) planning(reports []store.RepoReport) map[string]bool {
	out := map[string]bool{}
	if ps, _ := s.pipe.Get(context.Background()); ps != nil {
		for _, w := range ps.Watch {
			out[strings.ToLower(w.Repo)] = true
		}
	}
	for _, r := range reports {
		if len(r.Watch) > 0 {
			out[strings.ToLower(r.Owner+"/"+r.Name)] = true
		}
	}
	return out
}

// Feed builds the live activity feed from what HelloGitty already holds.
func (s source) Feed() []feed.Row {
	now := time.Now().UTC()
	in := feed.Input{Now: now, Notes: s.feed.Snapshot().Items}
	in.Entries, _ = s.entries(now)
	if issues, err := s.st.RecentIssues(now.Add(-feed.Window)); err == nil {
		in.Issues = issues
	}
	in.Acked, _ = s.st.Acked()
	in.Health = s.healthChanges(now)
	return feed.Build(in)
}

// healthChanges lists tracked repositories that went slow or dormant since the feed began. The
// first time a state is seen is its time; states already true when the feed first ran are not
// news.
func (s source) healthChanges(now time.Time) []feed.HealthChange {
	reports, err := tracked(s.st, s.p)
	if err != nil {
		return nil
	}
	epoch, err := s.st.FirstSeen("feed-epoch", now)
	if err != nil {
		return nil
	}
	var out []feed.HealthChange
	for _, r := range reports {
		state := store.HealthLabel(r.Repo)
		if state != "SLOW" && state != "DORMANT" {
			continue
		}
		repo := r.Owner + "/" + r.Name
		at, err := s.st.FirstSeen("health-"+strings.ToLower(repo)+"-"+strings.ToLower(state), now)
		if err == nil && at.After(epoch) {
			out = append(out, feed.HealthChange{Repo: repo, State: state, At: at})
		}
	}
	return out
}

// Ack acknowledges feed rows. A row with a GitHub notification behind it is also marked read on
// GitHub, which is HelloGitty's only write there; any other row is acknowledged here only.
func (s source) Ack(ctx context.Context, ids []string) []dashboard.AckResult {
	rows := map[string]feed.Row{}
	for _, r := range s.Feed() {
		rows[r.ID] = r
	}
	now := time.Now().UTC()
	var out []dashboard.AckResult
	for _, id := range ids {
		r, ok := rows[id]
		if !ok {
			out = append(out, dashboard.AckResult{ID: id, GitHub: "unknown row"})
			continue
		}
		res := dashboard.AckResult{ID: id, GitHub: "local"}
		if err := s.st.Ack(id, now); err != nil {
			res.GitHub = "failed: " + err.Error()
			out = append(out, res)
			continue
		}
		if r.Thread != "" {
			if err := s.gh.MarkThreadRead(ctx, r.Thread); err != nil {
				res.GitHub = "failed: " + err.Error()
			} else {
				s.feed.MarkRead(r.Thread)
				res.GitHub = "marked"
			}
		}
		out = append(out, res)
	}
	return out
}
