package store

import (
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS repos (
    id          INTEGER PRIMARY KEY,
    owner       TEXT NOT NULL,
    name        TEXT NOT NULL,
    upstream    TEXT NOT NULL,
    status      TEXT DEFAULT 'active',
    last_poll   DATETIME,
    last_commit DATETIME,
    UNIQUE(owner, name)
);

CREATE TABLE IF NOT EXISTS issues (
    id              INTEGER PRIMARY KEY,
    repo_id         INTEGER REFERENCES repos(id),
    number          INTEGER NOT NULL,
    title           TEXT,
    state           TEXT,
    labels          TEXT,
    assignees       TEXT,
    body            TEXT,
    created_at      DATETIME,
    updated_at      DATETIME,
    closed_at       DATETIME,
    claim_signal    TEXT,
    claim_detail    TEXT,
    UNIQUE(repo_id, number)
);

CREATE TABLE IF NOT EXISTS pull_requests (
    id                  INTEGER PRIMARY KEY,
    repo_id             INTEGER REFERENCES repos(id),
    number              INTEGER NOT NULL,
    title               TEXT,
    state               TEXT,
    merged              INTEGER,
    merged_at           DATETIME,
    closed_at           DATETIME,
    author_association  TEXT,
    body                TEXT,
    closing_comment     TEXT,
    review_verdict      TEXT,
    UNIQUE(repo_id, number)
);

CREATE TABLE IF NOT EXISTS watch_list (
    id                  INTEGER PRIMARY KEY,
    repo_id             INTEGER REFERENCES repos(id),
    issue_number        INTEGER NOT NULL,
    added_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    status              TEXT DEFAULT 'open',
    status_changed_at   DATETIME,
    UNIQUE(repo_id, issue_number)
);
`

const schemaVersion = 1

type Store struct {
	db *sql.DB
}

type Repo struct {
	ID         int64
	Owner      string
	Name       string
	Upstream   string
	Status     string
	LastPoll   *time.Time
	LastCommit *time.Time
}

type Issue struct {
	RepoID      int64
	Number      int
	Title       string
	State       string
	Labels      string
	Assignees   string
	Body        string
	CreatedAt   *time.Time
	UpdatedAt   *time.Time
	ClosedAt    *time.Time
	ClaimSignal string
	ClaimDetail string
}

type PullRequest struct {
	RepoID            int64
	Number            int
	Title             string
	State             string
	Merged            bool
	MergedAt          *time.Time
	ClosedAt          *time.Time
	AuthorAssociation string
	Body              string
}

type WatchItem struct {
	ID              int64
	RepoID          int64
	IssueNumber     int
	Status          string
	StatusChangedAt *time.Time
}

func Open(path string) (*Store, error) {
	dsn := "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	if v >= schemaVersion {
		return nil
	}
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	_, err := s.db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, schemaVersion))
	return err
}

func (s *Store) UpsertRepo(owner, name, upstream string) (int64, error) {
	_, err := s.db.Exec(`INSERT INTO repos (owner, name, upstream) VALUES (?, ?, ?)
		ON CONFLICT(owner, name) DO UPDATE SET upstream = excluded.upstream`, owner, name, upstream)
	if err != nil {
		return 0, err
	}
	var id int64
	err = s.db.QueryRow(`SELECT id FROM repos WHERE owner = ? AND name = ?`, owner, name).Scan(&id)
	return id, err
}

func (s *Store) RepoByName(owner, name string) (*Repo, error) {
	r := &Repo{}
	var lp, lc nullTime
	err := s.db.QueryRow(`SELECT id, owner, name, upstream, COALESCE(status, 'active'), last_poll, last_commit
		FROM repos WHERE owner = ? COLLATE NOCASE AND name = ? COLLATE NOCASE`, owner, name).
		Scan(&r.ID, &r.Owner, &r.Name, &r.Upstream, &r.Status, &lp, &lc)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.LastPoll, r.LastCommit = lp.ptr(), lc.ptr()
	return r, nil
}

func (s *Store) Repos() ([]Repo, error) {
	rows, err := s.db.Query(`SELECT id, owner, name, upstream, COALESCE(status, 'active'), last_poll, last_commit
		FROM repos ORDER BY owner, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Repo
	for rows.Next() {
		var r Repo
		var lp, lc nullTime
		if err := rows.Scan(&r.ID, &r.Owner, &r.Name, &r.Upstream, &r.Status, &lp, &lc); err != nil {
			return nil, err
		}
		r.LastPoll, r.LastCommit = lp.ptr(), lc.ptr()
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) SetRepoPoll(repoID int64, polledAt time.Time, lastCommit *time.Time, status string) error {
	_, err := s.db.Exec(`UPDATE repos SET last_poll = ?, last_commit = COALESCE(?, last_commit), status = ? WHERE id = ?`,
		ts(&polledAt), ts(lastCommit), status, repoID)
	return err
}

func (s *Store) UpsertIssue(i Issue) error {
	_, err := s.db.Exec(`INSERT INTO issues
		(repo_id, number, title, state, labels, assignees, body, created_at, updated_at, closed_at, claim_signal, claim_detail)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(repo_id, number) DO UPDATE SET
			title = excluded.title, state = excluded.state, labels = excluded.labels,
			assignees = excluded.assignees, body = excluded.body, created_at = excluded.created_at,
			updated_at = excluded.updated_at, closed_at = excluded.closed_at,
			claim_signal = excluded.claim_signal, claim_detail = excluded.claim_detail`,
		i.RepoID, i.Number, i.Title, i.State, i.Labels, i.Assignees, i.Body,
		ts(i.CreatedAt), ts(i.UpdatedAt), ts(i.ClosedAt), nullStr(i.ClaimSignal), nullStr(i.ClaimDetail))
	return err
}

// MarkMissingIssuesClosed closes stored open issues absent from a complete open-issue fetch.
func (s *Store) MarkMissingIssuesClosed(repoID int64, openNumbers []int) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE TEMP TABLE IF NOT EXISTS seen (n INTEGER PRIMARY KEY)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM seen`); err != nil {
		return err
	}
	for _, n := range openNumbers {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO seen (n) VALUES (?)`, n); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE issues SET state = 'closed'
		WHERE repo_id = ? AND state = 'open' AND number NOT IN (SELECT n FROM seen)`, repoID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UpsertPR(p PullRequest) error {
	_, err := s.db.Exec(`INSERT INTO pull_requests
		(repo_id, number, title, state, merged, merged_at, closed_at, author_association, body)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(repo_id, number) DO UPDATE SET
			title = excluded.title, state = excluded.state, merged = excluded.merged,
			merged_at = excluded.merged_at, closed_at = excluded.closed_at,
			author_association = excluded.author_association, body = excluded.body`,
		p.RepoID, p.Number, p.Title, p.State, boolInt(p.Merged), ts(p.MergedAt), ts(p.ClosedAt),
		p.AuthorAssociation, p.Body)
	return err
}

// PRDetailFetched reports whether the closing comment for a PR has been looked up. An empty
// string means it was looked up and nothing was found; NULL means it was never looked up.
func (s *Store) PRDetailFetched(repoID int64, number int) (bool, error) {
	var c sql.NullString
	err := s.db.QueryRow(`SELECT closing_comment FROM pull_requests WHERE repo_id = ? AND number = ?`,
		repoID, number).Scan(&c)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return c.Valid, err
}

func (s *Store) SetPRDetail(repoID int64, number int, closingComment, reviewVerdict string) error {
	_, err := s.db.Exec(`UPDATE pull_requests SET closing_comment = ?, review_verdict = ? WHERE repo_id = ? AND number = ?`,
		closingComment, nullStr(reviewVerdict), repoID, number)
	return err
}

func (s *Store) AddWatch(repoID int64, issueNumber int) error {
	_, err := s.db.Exec(`INSERT OR IGNORE INTO watch_list (repo_id, issue_number) VALUES (?, ?)`, repoID, issueNumber)
	return err
}

func (s *Store) WatchList(repoID int64) ([]WatchItem, error) {
	rows, err := s.db.Query(`SELECT id, repo_id, issue_number, COALESCE(status, 'open'), status_changed_at
		FROM watch_list WHERE repo_id = ? ORDER BY issue_number`, repoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WatchItem
	for rows.Next() {
		var w WatchItem
		var sc nullTime
		if err := rows.Scan(&w.ID, &w.RepoID, &w.IssueNumber, &w.Status, &sc); err != nil {
			return nil, err
		}
		w.StatusChangedAt = sc.ptr()
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *Store) SetWatchStatus(id int64, status string, at time.Time) error {
	_, err := s.db.Exec(`UPDATE watch_list SET status = ?, status_changed_at = ? WHERE id = ?`, status, ts(&at), id)
	return err
}

// Report types are the read model shared by the snapshot writer and the dashboard.

type RepoReport struct {
	Repo
	OpenIssuesTotal      int
	OpenIssuesGFI        int
	OpenIssuesUnassigned int
	Watch                []WatchReport
	DeniedPRs            []DeniedPR
	DeniedPRsTotal       int
}

type WatchReport struct {
	Number          int
	Title           string
	Status          string
	ClaimDetail     string
	StatusChangedAt *time.Time
}

type DeniedPR struct {
	Number            int
	Title             string
	AuthorAssociation string
	ClosingComment    string
	ReviewVerdict     string
	ClosedAt          *time.Time
}

// outsideAssociations excludes the maintainers' own PRs, which say nothing about how
// outside contributions are received.
const outsideAssociations = `('CONTRIBUTOR','FIRST_TIME_CONTRIBUTOR','FIRST_TIMER','NONE','MANNEQUIN')`

func (s *Store) Report(deniedLimit int) ([]RepoReport, error) {
	repos, err := s.Repos()
	if err != nil {
		return nil, err
	}
	out := make([]RepoReport, 0, len(repos))
	for _, r := range repos {
		rr := RepoReport{Repo: r}
		err := s.db.QueryRow(`SELECT
				COUNT(*),
				COALESCE(SUM(CASE WHEN lower(labels) LIKE '%good first issue%' OR lower(labels) LIKE '%good-first-issue%'
					OR lower(labels) LIKE '%good_first_issue%' THEN 1 ELSE 0 END), 0),
				COALESCE(SUM(CASE WHEN assignees IS NULL OR assignees = '[]' THEN 1 ELSE 0 END), 0)
			FROM issues WHERE repo_id = ? AND state = 'open'`, r.ID).
			Scan(&rr.OpenIssuesTotal, &rr.OpenIssuesGFI, &rr.OpenIssuesUnassigned)
		if err != nil {
			return nil, err
		}
		if rr.Watch, err = s.watchReport(r.ID); err != nil {
			return nil, err
		}
		if rr.DeniedPRs, rr.DeniedPRsTotal, err = s.deniedPRs(r.ID, deniedLimit); err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, nil
}

func (s *Store) watchReport(repoID int64) ([]WatchReport, error) {
	rows, err := s.db.Query(`SELECT w.issue_number, COALESCE(i.title, ''), COALESCE(w.status, 'open'),
			COALESCE(i.claim_detail, ''), w.status_changed_at
		FROM watch_list w LEFT JOIN issues i ON i.repo_id = w.repo_id AND i.number = w.issue_number
		WHERE w.repo_id = ? ORDER BY w.issue_number`, repoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WatchReport
	for rows.Next() {
		var w WatchReport
		var sc nullTime
		if err := rows.Scan(&w.Number, &w.Title, &w.Status, &w.ClaimDetail, &sc); err != nil {
			return nil, err
		}
		w.StatusChangedAt = sc.ptr()
		out = append(out, w)
	}
	return out, rows.Err()
}

// mergedByHand matches a maintainer saying the PR's change landed outside GitHub's merge
// button, which leaves the PR closed and unmerged. Deliberately narrow: a real rejection must
// never be hidden, so only explicit wording counts.
var mergedByHand = regexp.MustCompile(`(?i)\b(merged|landed|applied)\s+(it\s+|this\s+)?(manually|by hand|locally)\b|\b(merged|landed|applied|cherry[- ]?picked)\s+(it\s+|this\s+)?(as|in|via)\s+(commit\s+)?[0-9a-f]{7,40}\b`)

// MergedByHand reports whether a closing comment says the change was merged outside GitHub.
func MergedByHand(closingComment string) bool { return mergedByHand.MatchString(closingComment) }

// deniedPRs returns the most recent denied outside PRs (up to limit) and the total count,
// leaving out PRs whose closing comment says they were merged by hand.
func (s *Store) deniedPRs(repoID int64, limit int) ([]DeniedPR, int, error) {
	rows, err := s.db.Query(`SELECT number, COALESCE(title, ''), COALESCE(author_association, ''),
			COALESCE(closing_comment, ''), COALESCE(review_verdict, ''), closed_at
		FROM pull_requests WHERE repo_id = ? AND merged = 0 AND state = 'closed'
			AND author_association IN `+outsideAssociations+`
		ORDER BY closed_at DESC`, repoID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []DeniedPR
	total := 0
	for rows.Next() {
		var d DeniedPR
		var ca nullTime
		if err := rows.Scan(&d.Number, &d.Title, &d.AuthorAssociation, &d.ClosingComment, &d.ReviewVerdict, &ca); err != nil {
			return nil, 0, err
		}
		if MergedByHand(d.ClosingComment) {
			continue
		}
		total++
		if len(out) < limit {
			d.ClosedAt = ca.ptr()
			out = append(out, d)
		}
	}
	return out, total, rows.Err()
}

// HealthLabel is the uppercase health in the snapshot and dashboard. A repo never polled successfully is
// UNKNOWN rather than defaulting to ACTIVE.
func HealthLabel(r Repo) string {
	if r.LastPoll == nil {
		return "UNKNOWN"
	}
	return strings.ToUpper(r.Status)
}

func WatchLabel(status string) string {
	switch status {
	case "claimed":
		return "CLAIMED"
	case "closed_fixed":
		return "CLOSED_FIXED"
	case "closed_wont":
		return "CLOSED_WONT"
	default:
		return "STILL_OPEN"
	}
}

const timeFormat = time.RFC3339

func ts(t *time.Time) any {
	if t == nil || t.IsZero() {
		return nil
	}
	return t.UTC().Format(timeFormat)
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// nullTime accepts both the time.Time the driver produces for DATETIME columns and raw text.
type nullTime struct {
	t     time.Time
	valid bool
}

func (n *nullTime) Scan(v any) error {
	switch x := v.(type) {
	case nil:
		n.valid = false
	case time.Time:
		n.t, n.valid = x.UTC(), true
	case string:
		return n.parse(x)
	case []byte:
		return n.parse(string(x))
	default:
		return fmt.Errorf("nullTime: unsupported type %T", v)
	}
	return nil
}

func (n *nullTime) parse(s string) error {
	s = strings.TrimSpace(s)
	if s == "" {
		n.valid = false
		return nil
	}
	for _, f := range []string{time.RFC3339Nano, "2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
		if t, err := time.Parse(f, s); err == nil {
			n.t, n.valid = t.UTC(), true
			return nil
		}
	}
	return fmt.Errorf("nullTime: cannot parse %q", s)
}

func (n nullTime) ptr() *time.Time {
	if !n.valid {
		return nil
	}
	t := n.t
	return &t
}
