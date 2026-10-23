package dashboard

import (
	"encoding/json"
	"net/http"
	"strings"
)

// WorkDismissSource is optional: a Source that can remember which work items you dismissed from the
// dashboard. Dismissed items stay off the dashboard panels but appear on the /work page.
type WorkDismissSource interface {
	DismissedWork() map[string]bool
	DismissWork(key string) error
	RestoreWork(key string) error
}

// DismissedWorkID is how a dismissed work item is kept.
func DismissedWorkID(key string) string { return "d:" + strings.ToLower(key) }

// filterDismissed separates rows into kept and removed based on dismiss marks.
func filterDismissed(rows []workRow, dismissed map[string]bool) (kept, removed []workRow) {
	for _, r := range rows {
		if dismissed[strings.ToLower(r.K)] {
			removed = append(removed, r)
		} else {
			kept = append(kept, r)
		}
	}
	return kept, removed
}

func (h *Handler) serveWorkDismiss(w http.ResponseWriter, r *http.Request, restore bool) {
	ds, ok := h.Source.(WorkDismissSource)
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
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil || req.Key == "" || len(req.Key) > 200 {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	var err error
	if restore {
		err = ds.RestoreWork(req.Key)
	} else {
		err = ds.DismissWork(req.Key)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
