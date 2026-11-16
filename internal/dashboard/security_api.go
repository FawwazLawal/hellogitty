package dashboard

import (
	"encoding/json"
	"net/http"

	"github.com/FawwazLawal/hellogitty/internal/security"
)

// SecurityAPI is the document served at /app/api/security.json.
//
// WHY A PROJECTION AROUND security.Feed. The internal `security.Feed`,
// `security.CVE` and `security.Tip` structs already carry the right JSON tags
// and could be marshalled directly. They are wrapped here for two reasons.
// First, §4 of ADR-UI-002 asks each JSON endpoint to own its contract in the
// dashboard package, so a change inside internal/security does not silently
// become a contract change for the React client; the wrapper type is the
// seam that catches that. Second, a `nil` slice in Go encodes as JSON `null`,
// and a client writing `doc.cves.map(...)` crashes on a dashboard that simply
// has nothing to report — identical reasoning to doc.Repos / doc.StageHeads
// in serveDashboardAPI. The wrapper guarantees `[]` for empty.
//
// The three carried types stay re-used: their shapes are stable and live at
// the boundary where NVD responses are decoded. Re-declaring them here would
// create two places for `Severity` to drift.
type SecurityAPI struct {
	CVEs      []security.CVE `json:"cves"`
	Tips      []security.Tip `json:"tips"`
	FetchedAt string         `json:"fetchedAt"`
	Error     string         `json:"error,omitempty"`
}

// serveSecurityAPI writes the current security feed as JSON.
//
// The endpoint is read-only and derived from the snapshot `h.Source.Security()`
// already holds — same trust boundary as the dashboard document. There is no
// client-side refresh trigger here: `security.Cache.Refresh` is driven by the
// server's background loop, and exposing a kick from the client would turn a
// read-only endpoint into a write.
func (h *Handler) serveSecurityAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	feed := h.Source.Security()

	doc := SecurityAPI{
		CVEs:      feed.CVEs,
		Tips:      feed.Tips,
		FetchedAt: feed.FetchedAt,
		Error:     feed.Error,
	}
	if doc.CVEs == nil {
		doc.CVEs = []security.CVE{}
	}
	if doc.Tips == nil {
		doc.Tips = []security.Tip{}
	}

	// Same cache / content-type discipline as every other migrated endpoint:
	// no-store so the figures cannot quietly freeze, and nosniff because
	// this is still the owner's data on a loopback-bound server.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(doc)
}
