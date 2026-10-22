package dashboard

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// RepoSource is optional: a Source that can add and remove tracked repositories from the dashboard.
type RepoSource interface {
	// AddRepo starts tracking a repository given as owner/name or a GitHub address, and returns
	// GitHub's spelling of it and anything worth saying about it.
	AddRepo(ctx context.Context, raw string) (full, note string, err error)
	RemoveRepo(full string) error
	// Removed lists config-file repositories you removed here.
	Removed() []string
	// Ready reports whether a repository's first check has finished, so the page can show it.
	Ready(full string) bool
}

// serveRepoReady answers whether a just-added repository has been checked yet.
func (h *Handler) serveRepoReady(w http.ResponseWriter, r *http.Request) {
	rs, ok := h.Source.(RepoSource)
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(struct {
		Ready bool `json:"ready"`
	}{rs.Ready(r.URL.Query().Get("repo"))})
}

func (h *Handler) serveRepos(w http.ResponseWriter, r *http.Request, add bool) {
	rs, ok := h.Source.(RepoSource)
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
		Repo string `json:"repo"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil || req.Repo == "" || len(req.Repo) > 300 {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	var out struct {
		Repo  string `json:"repo,omitempty"`
		Note  string `json:"note,omitempty"`
		Error string `json:"error,omitempty"`
	}
	if add {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		var err error
		if out.Repo, out.Note, err = rs.AddRepo(ctx, req.Repo); err != nil {
			out.Error = err.Error()
		}
	} else if err := rs.RemoveRepo(req.Repo); err != nil {
		out.Error = err.Error()
	} else {
		out.Repo = req.Repo
	}
	w.Header().Set("Content-Type", "application/json")
	if out.Error != "" {
		w.WriteHeader(http.StatusUnprocessableEntity)
	}
	json.NewEncoder(w).Encode(out)
}
