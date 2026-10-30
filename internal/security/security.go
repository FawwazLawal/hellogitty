package security

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

type Severity string

const (
	Critical Severity = "CRITICAL"
	High     Severity = "HIGH"
	Medium   Severity = "MEDIUM"
	Low      Severity = "LOW"
)

type CVE struct {
	ID          string   `json:"id"`
	Description string   `json:"description"`
	Severity    Severity `json:"severity"`
	Published   string   `json:"published"`
	URL         string   `json:"url"`
	Packages    []string `json:"packages,omitempty"`
}

type Tip struct {
	Text  string `json:"text"`
	Level string `json:"level,omitempty"`
}

type Feed struct {
	CVEs      []CVE  `json:"cves"`
	Tips      []Tip  `json:"tips"`
	FetchedAt string `json:"fetchedAt"`
	Error     string `json:"error,omitempty"`
}

type Cache struct {
	mu   sync.Mutex
	feed Feed
	last time.Time
	ttl  time.Duration
}

func NewCache(ttl time.Duration) *Cache {
	return &Cache{ttl: ttl}
}

func (c *Cache) Get() Feed {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.feed
}

func (c *Cache) Refresh() {
	c.mu.Lock()
	if time.Since(c.last) < c.ttl {
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()

	feed := fetchNVD()

	c.mu.Lock()
	defer c.mu.Unlock()
	// The tips describe the reader's own repositories and arrive by a different route, so a
	// refresh of the CVE list must not carry them away with it.
	feed.Tips = c.feed.Tips
	// A failed fetch keeps whatever is already on screen and shows the error beside it, as the
	// work board does. Blanking the panel on a blip tells the reader less than stale data would,
	// and the fetch time stays as it was so they can see how old it is.
	if feed.Error != "" && len(feed.CVEs) == 0 && len(c.feed.CVEs) > 0 {
		feed.CVEs = c.feed.CVEs
		feed.FetchedAt = c.feed.FetchedAt
	}
	c.feed = feed
	c.last = time.Now()
}

func (c *Cache) SetTips(tips []Tip) {
	c.mu.Lock()
	c.feed.Tips = tips
	c.mu.Unlock()
}

type nvdResponse struct {
	Vulnerabilities []struct {
		CVE struct {
			ID          string `json:"id"`
			Published   string `json:"published"`
			Description []struct {
				Lang  string `json:"lang"`
				Value string `json:"value"`
			} `json:"descriptions"`
			Metrics struct {
				V31 []struct {
					Data struct {
						BaseSeverity string  `json:"baseSeverity"`
						BaseScore    float64 `json:"baseScore"`
					} `json:"cvssData"`
				} `json:"cvssMetricV31"`
			} `json:"metrics"`
		} `json:"cve"`
	} `json:"vulnerabilities"`
}

// nvdBase and nvdClient are variables so a test can point the fetch at a local server. Nothing
// outside this package changes them.
var (
	nvdBase   = "https://services.nvd.nist.gov/rest/json/cves/2.0"
	nvdClient = &http.Client{Timeout: 15 * time.Second}
)

func fetchNVD() Feed {
	now := time.Now().UTC()
	start := now.Add(-7 * 24 * time.Hour).Format("2006-01-02T15:04:05.000")
	end := now.Format("2006-01-02T15:04:05.000")

	url := fmt.Sprintf(
		"%s?pubStartDate=%s&pubEndDate=%s&cvssV3Severity=HIGH&resultsPerPage=20",
		nvdBase, start, end,
	)

	resp, err := nvdClient.Get(url)
	if err != nil {
		return Feed{Error: err.Error(), FetchedAt: now.Format(time.RFC3339)}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return Feed{Error: fmt.Sprintf("NVD API returned %d", resp.StatusCode), FetchedAt: now.Format(time.RFC3339)}
	}

	return decodeFeed(resp.Body, now)
}

// decodeFeed turns an NVD response body into a feed: English description, a severity it
// recognises, a plain date, sorted hardest-first and capped to what the panel shows.
func decodeFeed(body io.Reader, now time.Time) Feed {
	var data nvdResponse
	if err := json.NewDecoder(body).Decode(&data); err != nil {
		return Feed{Error: err.Error(), FetchedAt: now.Format(time.RFC3339)}
	}

	var cves []CVE
	for _, v := range data.Vulnerabilities {
		desc := ""
		for _, d := range v.CVE.Description {
			if d.Lang == "en" {
				desc = d.Value
				break
			}
		}
		// Count runes, not bytes: slicing at a byte offset can land inside a multi-byte
		// character and leave invalid UTF-8 for the page to render.
		if utf8.RuneCountInString(desc) > 200 {
			desc = string([]rune(desc)[:197]) + "..."
		}

		sev := High
		if len(v.CVE.Metrics.V31) > 0 {
			s := Severity(strings.ToUpper(v.CVE.Metrics.V31[0].Data.BaseSeverity))
			if s == Critical || s == High || s == Medium || s == Low {
				sev = s
			}
		}

		pub := v.CVE.Published
		if t, err := time.Parse("2006-01-02T15:04:05.000", pub); err == nil {
			pub = t.Format("2006-01-02")
		}

		cves = append(cves, CVE{
			ID:          v.CVE.ID,
			Description: desc,
			Severity:    sev,
			Published:   pub,
			URL:         "https://nvd.nist.gov/vuln/detail/" + v.CVE.ID,
		})
	}

	sort.Slice(cves, func(i, j int) bool {
		if cves[i].Severity != cves[j].Severity {
			return sevOrder(cves[i].Severity) < sevOrder(cves[j].Severity)
		}
		return cves[i].Published > cves[j].Published
	})

	if len(cves) > 15 {
		cves = cves[:15]
	}

	return Feed{CVEs: cves, FetchedAt: now.Format(time.RFC3339)}
}

func sevOrder(s Severity) int {
	switch s {
	case Critical:
		return 0
	case High:
		return 1
	case Medium:
		return 2
	default:
		return 3
	}
}

// langHints maps a whole token in a repository's owner or name to the ecosystem it implies.
// Matching is on tokens rather than substrings, because a substring says very little: "tiangolo"
// is not a Go project and neither is "django", though both contain "go". Advice for a language a
// project does not use is worse than no advice, so a guess has to be a confident one.
var langHints = map[string]string{
	"go": "go", "golang": "go",
	"node": "node", "nodejs": "node", "npm": "node", "js": "node", "javascript": "node",
	"ts": "node", "typescript": "node",
	"python": "python", "py": "python", "pip": "python", "django": "python", "flask": "python",
	"rust": "rust", "cargo": "rust",
}

// repoTokens splits owner/name on anything that is not a letter or a digit, so
// "dustin/go-humanize" yields "dustin", "go" and "humanize".
func repoTokens(repo string) []string {
	return strings.FieldsFunc(strings.ToLower(repo), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
}

func GenerateTips(repos []string) []Tip {
	var tips []Tip
	langs := map[string]bool{}
	for _, r := range repos {
		for _, tok := range repoTokens(r) {
			if lang, ok := langHints[tok]; ok {
				langs[lang] = true
			}
		}
	}

	if langs["go"] {
		tips = append(tips, Tip{Text: "Run govulncheck regularly on your Go modules to catch known vulnerabilities in dependencies.", Level: "info"})
	}
	if langs["node"] {
		tips = append(tips, Tip{Text: "Enable npm audit in CI to catch vulnerabilities before they ship. Consider using --audit-level=high.", Level: "info"})
	}
	if langs["python"] {
		tips = append(tips, Tip{Text: "Use pip-audit or safety to scan your Python dependencies for known CVEs.", Level: "info"})
	}
	if langs["rust"] {
		tips = append(tips, Tip{Text: "Run cargo audit in CI to catch known Rust dependency vulnerabilities.", Level: "info"})
	}

	tips = append(tips, Tip{Text: "Enable GitHub's secret scanning and push protection on all repositories to prevent credential leaks.", Level: "info"})
	tips = append(tips, Tip{Text: "Review Dependabot alerts weekly — unresolved alerts accumulate risk faster than new code introduces it.", Level: "info"})

	if len(tips) > 5 {
		tips = tips[:5]
	}
	return tips
}
