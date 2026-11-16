// Package unreplied writes a JSON file listing every open PR authored by the configured user that
// has review comment threads where the last commenter is not that user. The file is rewritten after
// every work board refresh so a script can read it without calling the GitHub API per PR.
package unreplied

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/work"
)

type Thread struct {
	Author    string `json:"author"`
	Bot       bool   `json:"bot"`
	Snippet   string `json:"snippet"`
	URL       string `json:"url"`
	Path      string `json:"path,omitempty"`
	CreatedAt string `json:"created_at"`
}

type PR struct {
	Repo             string   `json:"repo"`
	Number           int      `json:"number"`
	Title            string   `json:"title"`
	URL              string   `json:"url"`
	UnrepliedThreads []Thread `json:"unreplied_threads"`
}

type File struct {
	GeneratedAt string `json:"generated_at"`
	// BoardPartial is true when this file was written from a work-board refresh that GitHub refused
	// part of: OurOpenPRs is the best-available merge of the last-good set and whatever the partial
	// produced, not a claim of completeness. Omitted on a full-cycle write.
	BoardPartial bool `json:"board_partial,omitempty"`
	OurOpenPRs   []PR `json:"our_open_prs"`
}

// MergePRs returns every unique PR across prev and next, keyed by repo + "#" + number; next wins
// per key. Order is prev first (preserving its order), then any PRs new to next appended at the
// end. Nil inputs are treated as empty.
//
// A partial work-board refresh may replace OurOpenPRs with a smaller subset because the prsOpen
// sub-query errored while others succeeded; merging preserves the last complete cycle's PRs so a
// script reading the file does not watch 18 threads shrink to 0 and panic.
func MergePRs(prev, next []PR) []PR {
	if len(prev) == 0 {
		return append([]PR(nil), next...)
	}
	key := func(p PR) string { return strings.ToLower(p.Repo) + "#" + strconv.Itoa(p.Number) }
	idx := make(map[string]int, len(prev)+len(next))
	out := make([]PR, 0, len(prev)+len(next))
	for _, p := range prev {
		idx[key(p)] = len(out)
		out = append(out, p)
	}
	for _, p := range next {
		if i, ok := idx[key(p)]; ok {
			out[i] = p
			continue
		}
		idx[key(p)] = len(out)
		out = append(out, p)
	}
	return out
}

func Build(b *work.Board) File {
	f := File{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		OurOpenPRs:  []PR{},
	}
	if b == nil {
		return f
	}
	for _, it := range b.Sent {
		if !it.PR || it.State != "OPEN" {
			continue
		}
		var threads []Thread
		for _, t := range it.Threads {
			if t.RepliedLast {
				continue
			}
			snippet := t.Body
			if r := []rune(snippet); len(r) > 120 {
				snippet = strings.TrimRight(string(r[:120]), " ,.;:") + "…"
			}
			threads = append(threads, Thread{
				Author:    t.Author,
				Bot:       t.Bot,
				Snippet:   snippet,
				URL:       t.URL,
				Path:      t.Path,
				CreatedAt: t.At.UTC().Format(time.RFC3339),
			})
		}
		if threads == nil {
			threads = []Thread{}
		}
		f.OurOpenPRs = append(f.OurOpenPRs, PR{
			Repo:             it.Repo,
			Number:           it.Number,
			Title:            it.Title,
			URL:              it.URL,
			UnrepliedThreads: threads,
		})
	}
	return f
}

func Write(path string, f File) error {
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(name, 0o644); err != nil {
		return err
	}
	return os.Rename(name, path)
}
