package dashboard

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/store"
)

// WatchSource is optional: a Source that lets you watch any issue from the page with the eye.
type WatchSource interface {
	// WatchedKeys lists watched issues as "owner/name#123" in lower case.
	WatchedKeys() map[string]bool
	// SetWatch starts or stops watching an issue; note is worth saying when it started.
	SetWatch(ctx context.Context, repo string, number int, on bool) (note string, err error)
	// OtherWatched returns watched issues in repositories you don't track.
	OtherWatched() []store.RepoReport
}

// splitKey reads "owner/name#123".
func splitKey(k string) (repo string, n int, ok bool) {
	repo, num, found := strings.Cut(k, "#")
	n, err := strconv.Atoi(num)
	return repo, n, found && err == nil && n > 0 && strings.Count(repo, "/") == 1
}

func (h *Handler) serveWatch(w http.ResponseWriter, r *http.Request) {
	ws, ok := h.Source.(WatchSource)
	switch {
	case !ok:
		http.NotFound(w, r)
		return
	case r.Method != http.MethodPost:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	case !sameOrigin(r) || r.Header.Get("X-HelloGitty-Token") != h.token():
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	var req struct {
		Key string `json:"key"`
		On  bool   `json:"on"`
	}
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req)
	repo, n, ok := splitKey(req.Key)
	if err != nil || !ok {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	var out struct {
		On    bool   `json:"on"`
		Note  string `json:"note,omitempty"`
		Error string `json:"error,omitempty"`
	}
	out.On = req.On
	if out.Note, err = ws.SetWatch(ctx, repo, n, req.On); err != nil {
		out.On, out.Error = !req.On, err.Error()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(out)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// markWatched sets the eye on every issue row the page shows.
func markWatched(p *page, keys map[string]bool) {
	for _, list := range []*[]workRow{&p.Work.You, &p.Work.Them, &p.Work.Done, &p.Work.InYou, &p.Work.InThem, &p.Work.ConvYou, &p.Work.ConvThem} {
		for i := range *list {
			(*list)[i].Watched = keys[(*list)[i].K]
			(*list)[i].Eye = (*list)[i].Kind == "Issue"
		}
	}
	for i := range p.Rows {
		for j := range p.Rows[i].Issues {
			p.Rows[i].Issues[j].Watched = keys[p.Rows[i].Issues[j].K]
			p.Rows[i].Issues[j].Eye = true
		}
	}
	for i := range p.Feed.Rows {
		p.Feed.Rows[i].Watched = keys[p.Feed.Rows[i].Key]
		p.Feed.Rows[i].Eye = issueKind(p.Feed.Rows[i].Kind)
	}
}

// issueKind says a feed row is about an issue (the eye watches issues, not pull requests).
func issueKind(kind string) bool {
	return kind == "new-issue" || kind == "issue" || kind == "watch" || kind == "overlap"
}
