package dashboard

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// Clearing an indicator says "I've seen these". The cell goes dark and stays dark until something
// new lights it: a repository, issue or check that wasn't among the ones you cleared. Things that
// stop lighting it are forgotten, so if they come back later they light it again.

// CellSource is optional: a Source that can remember which indicators you cleared.
type CellSource interface {
	// Cleared returns every cleared item id ("c:<cell>:<item>").
	Cleared() map[string]bool
	ClearCell(key string, items []string) error
	// RestoreCell forgets everything cleared on one cell, so it lights again.
	RestoreCell(key string) error
	// ForgetCleared drops cleared ids that no longer light their cell.
	ForgetCleared(ids []string) error
}

// clearable lists the cells you can clear: those lit by a list of named things. "Data is stale" and
// "API running low" are left out, because they say the board itself can't be trusted right now,
// and they go dark on their own.
var clearable = map[string]bool{
	"watch-claimed": true, "watch-closed": true, "your-move": true, "poll-fail": true,
	"repo-dormant": true, "repo-slow": true, "repo-flagged": true, "stage-failed": true,
}

// ClearedID is how a cleared item is kept.
func ClearedID(key, item string) string { return "c:" + key + ":" + strings.ToLower(item) }

// applyCleared hides the cleared items of each clearable cell. settled says the data behind the
// cells is complete, so an item missing from a cell has really stopped lighting it and its cleared
// mark can be forgotten.
func applyCleared(cells []cell, cleared map[string]bool, settled bool) (forget []string) {
	for i := range cells {
		c := &cells[i]
		if !clearable[c.Key] || c.Empty {
			continue
		}
		c.Clearable = true
		c.ItemsAttr = strings.Join(c.Items, "|")
		present := map[string]bool{}
		var fresh []string
		for _, it := range c.Items {
			id := ClearedID(c.Key, it)
			present[id] = true
			if cleared[id] {
				c.Cleared++
			} else {
				fresh = append(fresh, it)
			}
		}
		if settled {
			prefix := "c:" + c.Key + ":"
			for id := range cleared {
				if strings.HasPrefix(id, prefix) && !present[id] {
					forget = append(forget, id)
				}
			}
		}
		if c.Cleared == 0 {
			continue
		}
		shown := counter(c.Key, c.Label, len(fresh), c.Level, fresh, c.Wide)
		c.Value, c.Lit, c.Detail, c.More = strconv.Itoa(len(fresh)), shown.Lit, shown.Detail, shown.More
	}
	return forget
}

func (h *Handler) serveCells(w http.ResponseWriter, r *http.Request, restore bool) {
	cs, ok := h.Source.(CellSource)
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
		Key   string   `json:"key"`
		Items []string `json:"items"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil || !clearable[req.Key] ||
		len(req.Items) > 200 || (!restore && len(req.Items) == 0) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	for _, it := range req.Items {
		if it == "" || len(it) > 200 {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
	}
	var err error
	if restore {
		err = cs.RestoreCell(req.Key)
	} else {
		err = cs.ClearCell(req.Key, req.Items)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
