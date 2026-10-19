package snapshot

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/store"
)

// DeniedSampleSize is how many recent denied outside PRs each repo carries in the snapshot.
const DeniedSampleSize = 10

type Snapshot struct {
	GeneratedAt         string `json:"generated_at"`
	PollIntervalMinutes int    `json:"poll_interval_minutes"`
	Repos               []Repo `json:"repos"`
}

type Repo struct {
	Owner                string     `json:"owner"`
	Name                 string     `json:"name"`
	Health               string     `json:"health"`
	LastCommit           *string    `json:"last_commit"`
	OpenIssuesTotal      int        `json:"open_issues_total"`
	OpenIssuesGFI        int        `json:"open_issues_gfi"`
	OpenIssuesUnassigned int        `json:"open_issues_unassigned"`
	WatchList            []Watch    `json:"watch_list"`
	DeniedPRsSample      []DeniedPR `json:"denied_prs_sample"`
}

type Watch struct {
	Number      int     `json:"number"`
	Title       string  `json:"title"`
	Status      string  `json:"status"`
	LastChecked *string `json:"last_checked"`
}

type DeniedPR struct {
	Number            int     `json:"number"`
	Title             string  `json:"title"`
	AuthorAssociation string  `json:"author_association"`
	ClosingComment    string  `json:"closing_comment"`
	ClosedAt          *string `json:"closed_at"`
}

type Key struct{ Owner, Name string }

// Filter keeps only repos still configured, so a repo removed from the config drops out of
// the snapshot without deleting its history. A nil keep list keeps everything.
func Filter(reports []store.RepoReport, keep []Key) []store.RepoReport {
	if keep == nil {
		return reports
	}
	want := map[string]bool{}
	for _, k := range keep {
		want[strings.ToLower(k.Owner+"/"+k.Name)] = true
	}
	var out []store.RepoReport
	for _, r := range reports {
		if want[strings.ToLower(r.Owner+"/"+r.Name)] {
			out = append(out, r)
		}
	}
	return out
}

func Build(reports []store.RepoReport, generatedAt time.Time, pollInterval time.Duration) Snapshot {
	s := Snapshot{
		GeneratedAt:         generatedAt.UTC().Format(time.RFC3339),
		PollIntervalMinutes: int(pollInterval / time.Minute),
		Repos:               make([]Repo, 0, len(reports)),
	}
	for _, r := range reports {
		repo := Repo{
			Owner:                r.Owner,
			Name:                 r.Name,
			Health:               store.HealthLabel(r.Repo),
			LastCommit:           stamp(r.LastCommit),
			OpenIssuesTotal:      r.OpenIssuesTotal,
			OpenIssuesGFI:        r.OpenIssuesGFI,
			OpenIssuesUnassigned: r.OpenIssuesUnassigned,
			WatchList:            make([]Watch, 0, len(r.Watch)),
			DeniedPRsSample:      make([]DeniedPR, 0, len(r.DeniedPRs)),
		}
		for _, w := range r.Watch {
			repo.WatchList = append(repo.WatchList, Watch{
				Number:      w.Number,
				Title:       w.Title,
				Status:      store.WatchLabel(w.Status),
				LastChecked: stamp(r.LastPoll),
			})
		}
		for _, d := range r.DeniedPRs {
			repo.DeniedPRsSample = append(repo.DeniedPRsSample, DeniedPR{
				Number:            d.Number,
				Title:             d.Title,
				AuthorAssociation: d.AuthorAssociation,
				ClosingComment:    d.ClosingComment,
				ClosedAt:          stamp(d.ClosedAt),
			})
		}
		s.Repos = append(s.Repos, repo)
	}
	return s
}

// Write replaces path atomically so a reader never sees a half-written file.
func Write(path string, s Snapshot) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".snapshot-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(b, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func stamp(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
