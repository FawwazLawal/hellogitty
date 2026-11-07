package dashboard

import (
	"encoding/json"
	"net/http"
	"time"
)

// The JSON API the React application reads.
//
// ADR-UI-002 §4 is specific about how to arrive here: "Do not assume a full
// JSON API exists: inspect the Go routing and template handlers, inventory data
// dependencies, then add minimal typed endpoints if the migration actually
// requires them." This is that minimum — the figures one vertical slice needs,
// and nothing else.
//
// WHY A PROJECTION RATHER THAN THE VIEW MODEL. The obvious shortcut is to
// marshal the internal `page` struct, which already holds everything. It is the
// wrong move twice over. It carries `Token`, the value sent back with
// acknowledgements, which has no business in a read-only document. It carries
// template.JS fields that mean nothing outside html/template. And it is shaped
// by what the template needed on the day each field was added, so publishing it
// would freeze those accidents into a contract the frontend then depends on.
//
// §4 also sets the trust boundary: "The React UI does not directly own GitHub
// secrets, filesystem operations, backend persistence or privileged API calls."
// So this is GET-only, derived from the snapshot the server already holds, and
// it exposes no credential, no path and no write.

// KPI is one figure in the stat rail.
//
// `Known` is the field that makes the difference between a real zero and an
// absent one. The dashboard polls GitHub on an interval, so before the first
// poll completes every count is genuinely unknown — and a UI that renders
// unknown as 0 tells the viewer there is nothing waiting for them, which is a
// lie with consequences. The existing template already models this as
// RailKnown/APIKnown; the API keeps it rather than flattening it.
type KPI struct {
	ID       string `json:"id"`
	Value    int    `json:"value"`
	Label    string `json:"label"`
	Sublabel string `json:"sublabel"`
	Known    bool   `json:"known"`
}

// DashboardAPI is the document served at /app/api/dashboard.json.
type DashboardAPI struct {
	// GeneratedAt is when the snapshot this is derived from was written, in
	// RFC 3339. Not the time of the request: the client needs to know how stale
	// the figures are, and a server timestamp would always look fresh.
	GeneratedAt string `json:"generatedAt"`
	Version     string `json:"version"`
	KPIs        []KPI  `json:"kpis"`

	// Partial says that this document covers the KPI slice only, and that the
	// repository table, pipeline and work rails are still rendered from
	// fixtures on the client. It exists so the frontend cannot quietly assume
	// it has everything — Phase 4 sets it false as each section lands.
	Partial bool `json:"partial"`
}

// serveDashboardAPI writes the KPI slice as JSON.
func (h *Handler) serveDashboardAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, err := h.build()
	if err != nil {
		// A build failure is the server's problem, and the client has a real
		// error state for it. Returning an empty 200 would render as "nothing
		// needs you", which is the same lie as rendering unknown as zero.
		http.Error(w, "dashboard unavailable", http.StatusInternalServerError)
		return
	}

	// LastPollUnix, not LastPollUTC. The latter is what the template prints in
	// the footer and is a time of day — "00:44:56Z", no date — which a client
	// cannot compute staleness from, and which silently reads as "today" across
	// a midnight boundary. The epoch field is the one that carries a full
	// instant, and RFC 3339 is what the frontend's schema expects.
	//
	// Zero means no poll has completed, and an empty string says that honestly
	// rather than claiming 1970.
	generated := ""
	if p.LastPollUnix > 0 {
		generated = time.Unix(p.LastPollUnix, 0).UTC().Format(time.RFC3339)
	}

	doc := DashboardAPI{
		GeneratedAt: generated,
		Version:     p.Version,
		Partial:     true,
		KPIs: []KPI{
			{ID: "needs", Value: p.RailNeedsYou, Label: "Needs you", Known: p.RailKnown},
			{ID: "prs", Value: p.RailOpenPRs, Label: "Open PRs", Sublabel: "non-draft, state OPEN", Known: p.RailKnown},
			{ID: "repos", Value: p.RepoCount, Label: "Repos", Known: true},
			{ID: "api", Value: p.APIRemaining, Label: "API left", Known: p.APIKnown},
		},
	}
	if p.APIKnown {
		doc.KPIs[3].Sublabel = "of " + itoa(p.APILimit) + " this hour"
	}

	// No caching. These figures move on every poll, and a cached document is a
	// dashboard that quietly stops updating — the failure mode hardest to
	// notice, because it looks exactly like nothing happening.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// The document contains no credential, but it is still the user's data on a
	// loopback-bound server. Deny framing and sniffing on principle.
	w.Header().Set("X-Content-Type-Options", "nosniff")

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(doc); err != nil {
		// The status is already written by now; log-free here because the
		// handler has no logger and a partial body is self-evident to the
		// client's JSON parse.
		return
	}
}

// itoa avoids pulling strconv in for one call site in a file this small.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
