// Package work builds the "your work" board: every pull request and issue the account has in
// flight on GitHub, and the pull requests and issues waiting on it in repositories it maintains,
// each sorted by whose move it is.
package work

import (
	"context"
	"sync"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

// Whose move an item is.
const (
	MoveYou  = "you"
	MoveThem = "them"
	MoveDone = "done"
)

// Why an item is on the board.
const (
	RoleAuthor    = "author"    // you opened it
	RoleAssigned  = "assigned"  // it is assigned to you
	RoleInvolved  = "involved"  // you commented on it or were mentioned
	RoleReviewer  = "reviewer"  // your review was requested, or you reviewed it
	RoleMaintains = "maintains" // it is in a repository you maintain
)

// Check states.
const (
	CheckPassed  = "passed"
	CheckFailed  = "failed"
	CheckPending = "pending"
)

// Check is one named status check on a pull request's latest commit.
type Check struct {
	Name   string
	State  string // CheckPassed, CheckFailed or CheckPending
	Detail string // the check's own one-line description, e.g. "CLA signature required"
	At     *time.Time
}

// Thread is an unresolved review thread: an inline comment someone expects answered before merge.
type Thread struct {
	Author   string
	Bot      bool
	Body     string
	URL      string
	Path     string
	At       time.Time
	Outdated bool // the code it points at has changed since
	// RepliedLast is set when the newest comment in the thread is yours: you answered and the
	// reviewer has yet to resolve it.
	RepliedLast bool
}

// Activity is the most recent comment or review on an item from a person (bots are skipped).
type Activity struct {
	Author string
	Body   string
	URL    string
	At     time.Time
	// Review holds the review state (APPROVED, CHANGES_REQUESTED, COMMENTED) when the activity
	// was a review rather than a comment.
	Review string
	// Path is set for an inline review comment: the file it is on.
	Path string
	// Bot marks an inline comment from a review bot; such threads still block a merge.
	Bot bool
}

// Item is one pull request or issue, with a plain-language status.
type Item struct {
	PR        bool
	Repo      string
	Number    int
	Title     string
	URL       string
	Author    string
	Role      string
	State     string // OPEN, CLOSED or MERGED
	Draft     bool
	CreatedAt time.Time
	UpdatedAt time.Time
	ClosedAt  *time.Time

	// Pull request detail.
	ReviewDecision string   // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or ""
	Checks         string   // SUCCESS, FAILURE, ERROR, PENDING, EXPECTED or ""
	Conflict       bool     // GitHub reports a merge conflict
	Requested      []string // reviewers still asked to review
	ApprovedBy     []string
	ChangesBy      []string
	ChangesAt      *time.Time // latest changes-requested review
	ReviewedByMeAt *time.Time // your latest review, for pull requests you review
	LastCommitAt   *time.Time
	MergedBy       string
	StateReason    string // issues: COMPLETED, NOT_PLANNED, DUPLICATE
	MergeState     string // BEHIND, BLOCKED, CLEAN, DIRTY, DRAFT, HAS_HOOKS, UNKNOWN, UNSTABLE
	Base           string // the branch it merges into
	Labels         []string

	// Detail fetched for your own open pull requests only.
	HeadOID          string // the latest commit
	Recent           []Activity
	Threads          []Thread // unresolved review threads
	CheckList        []Check
	AwaitingApproval []string   // workflows a maintainer must approve before they run
	Fixes            []IssueRef // issues this pull request closes when merged

	Assignees []string
	Comments  int
	Last      *Activity

	// Set by Classify.
	Move   string
	Status string   // one sentence: "Changes requested by @alice"
	Notes  []string // extra facts worth a glance: "Checks failing", "Merge conflict"
	Level  string   // "caution" or "ok" for a coloured marker; "" for neutral
	Since  time.Time
	// Personal is set when the next step is one only you can take (sign a CLA, answer a reviewer
	// in your own words), as opposed to a fix anyone with the branch could make.
	Personal string
	// Quote, when set, is the comment most worth reading before acting, if it is not Last.
	Quote *Activity
}

// IssueRef names an issue anywhere on GitHub.
type IssueRef struct {
	Repo   string
	Number int
}

// Board is everything the dashboard shows about your own work.
type Board struct {
	Login string
	// Sent is the work you sent out: your pull requests and the issues you opened, were assigned
	// or joined. Incoming is what waits on you as a maintainer or reviewer.
	Sent      []Item
	Incoming  []Item
	FetchedAt time.Time
	// Scope describes the repositories counted as yours, e.g. "repos owned by alice + org/name".
	Scope string
	// Cost and Remaining are the GraphQL points the last refresh used and the points left this hour.
	Cost, Remaining int
}

// Tracker refreshes the board and keeps the last good one when a refresh fails.
type Tracker struct {
	GH *github.Client
	// Maintain lists extra repositories ("owner/name") or organisations ("org") whose incoming
	// pull requests and issues count as yours. Repositories your account owns always count.
	Maintain []string
	// FinishedWindow is how far back merged and closed work is shown.
	FinishedWindow time.Duration
	Now            func() time.Time

	mu      sync.Mutex
	login   string
	board   *Board
	err     string
	errAt   time.Time
	running bool
}

// Snapshot returns the last good board (nil before the first success) and the last error, if the
// most recent refresh failed.
func (t *Tracker) Snapshot() (*Board, string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.board, t.err
}

// Refresh fetches the board once. Concurrent calls collapse into one.
func (t *Tracker) Refresh(ctx context.Context) error {
	t.mu.Lock()
	if t.running {
		t.mu.Unlock()
		return nil
	}
	t.running = true
	login := t.login
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		t.running = false
		t.mu.Unlock()
	}()

	now := t.now()
	if login == "" {
		l, err := viewerLogin(ctx, t.GH)
		if err != nil {
			t.fail(err, now)
			return err
		}
		login = l
	}
	window := t.FinishedWindow
	if window <= 0 {
		window = 30 * 24 * time.Hour
	}
	b, err := fetch(ctx, t.GH, login, t.Maintain, now.Add(-window))
	if b != nil {
		b.FetchedAt = now
		Classify(b, now)
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.login = login
	if b != nil && (err == nil || len(b.Sent)+len(b.Incoming) > 0) {
		t.board = b
	}
	if err != nil {
		t.err, t.errAt = err.Error(), now
		return err
	}
	t.err = ""
	return nil
}

func (t *Tracker) fail(err error, at time.Time) {
	t.mu.Lock()
	t.err, t.errAt = err.Error(), at
	t.mu.Unlock()
}

func (t *Tracker) now() time.Time {
	if t.Now != nil {
		return t.Now().UTC()
	}
	return time.Now().UTC()
}
