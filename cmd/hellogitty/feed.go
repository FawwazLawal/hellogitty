package main

import (
	"context"
	"fmt"
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
		entries = inbox.Sorted(append(entries, inbox.NewIssues(s.trackedOnly(issues), s.planning(reports), now)...))
	}
	if refs, err := s.st.CrossReferences(); err != nil {
		log.Printf("inbox: cross-references left out: %v", err)
	} else {
		entries = inbox.Sorted(append(entries, inbox.CrossRefEntries(refs)...))
	}
	if replies := s.p.CommentReplies(); len(replies) > 0 {
		entries = inbox.Sorted(append(entries, inbox.CommentReplies(replies)...))
	}
	inbox.Enrich(entries, seen, now)
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
		in.Issues = s.trackedOnly(issues)
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

// Cleared returns the indicator items you cleared, kept with the feed's acknowledgements.
func (s source) Cleared() map[string]bool {
	acked, err := s.st.Acked()
	if err != nil {
		log.Printf("indicators: %v", err)
		return nil
	}
	out := map[string]bool{}
	for id := range acked {
		if strings.HasPrefix(id, "c:") {
			out[id] = true
		}
	}
	return out
}

// ClearCell clears what lights one indicator now; something new lights it again.
func (s source) ClearCell(key string, items []string) error {
	now := time.Now().UTC()
	for _, it := range items {
		if err := s.st.Ack(dashboard.ClearedID(key, it), now); err != nil {
			return err
		}
	}
	return nil
}

// RestoreCell forgets what you cleared on one indicator.
func (s source) RestoreCell(key string) error { return s.st.UnackPrefix("c:" + key + ":") }

// ForgetCleared drops cleared items that no longer light their indicator.
func (s source) ForgetCleared(ids []string) error { return s.st.Unack(ids...) }

// DismissedWork returns the keys of work items you dismissed from the dashboard.
func (s source) DismissedWork() map[string]bool {
	acked, err := s.st.Acked()
	if err != nil {
		log.Printf("dismiss: %v", err)
		return nil
	}
	out := map[string]bool{}
	for id := range acked {
		if strings.HasPrefix(id, "d:") {
			out[strings.TrimPrefix(id, "d:")] = true
		}
	}
	return out
}

// DismissWork hides a work item from the dashboard; the /work page still shows it.
func (s source) DismissWork(key string) error {
	return s.st.Ack(dashboard.DismissedWorkID(key), time.Now().UTC())
}

// RestoreWork brings a dismissed item back to the dashboard.
func (s source) RestoreWork(key string) error {
	return s.st.Unack(dashboard.DismissedWorkID(key))
}

// trackedOnly drops issues from repositories you no longer track; the database keeps their history.
func (s source) trackedOnly(issues []store.RecentIssue) []store.RecentIssue {
	targets := s.p.Status().Targets
	if len(targets) == 0 {
		return issues // before the first check, nothing is known to be untracked
	}
	keep := map[string]bool{}
	for _, t := range targets {
		keep[strings.ToLower(t.Owner+"/"+t.Name)] = true
	}
	out := issues[:0:0]
	for _, i := range issues {
		if keep[strings.ToLower(i.Repo)] {
			out = append(out, i)
		}
	}
	return out
}

// ClearNotification clears a notification row: kept here so it stays off the page until the thread
// changes, and marked read on GitHub (HelloGitty's one kind of write there).
func (s source) ClearNotification(ctx context.Context, threadID string) error {
	if err := s.st.Ack("n:"+threadID, time.Now().UTC()); err != nil {
		return err
	}
	for _, n := range s.feed.Snapshot().Items {
		if n.ID == threadID && n.Unread {
			if err := s.gh.MarkThreadRead(ctx, threadID); err != nil {
				return fmt.Errorf("cleared here, but GitHub didn't mark it read: %w", err)
			}
			s.feed.MarkRead(threadID)
		}
	}
	return nil
}

// ClearedNotifications returns when each notification row was cleared or acknowledged.
func (s source) ClearedNotifications() map[string]time.Time {
	acked, err := s.st.Acked()
	if err != nil {
		return nil
	}
	out := map[string]time.Time{}
	for id, at := range acked {
		if strings.HasPrefix(id, "n:") {
			out[id] = at
		}
	}
	return out
}
