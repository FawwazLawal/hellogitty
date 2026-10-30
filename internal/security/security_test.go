package security

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

var testNow = time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)

// nvdBody writes an NVD response carrying the given vulnerabilities, in the shape the real API
// uses: descriptions in several languages, severity under cvssMetricV31.
func nvdBody(vulns ...string) string {
	return `{"vulnerabilities":[` + strings.Join(vulns, ",") + `]}`
}

func vuln(id, published, severity, desc string) string {
	metrics := `"metrics":{}`
	if severity != "" {
		metrics = fmt.Sprintf(`"metrics":{"cvssMetricV31":[{"cvssData":{"baseSeverity":%q,"baseScore":7.5}}]}`, severity)
	}
	return fmt.Sprintf(
		`{"cve":{"id":%q,"published":%q,"descriptions":[{"lang":"es","value":"no"},{"lang":"en","value":%q}],%s}}`,
		id, published, desc, metrics)
}

func TestDecodeFeedReadsAVulnerability(t *testing.T) {
	f := decodeFeed(strings.NewReader(nvdBody(
		vuln("CVE-2026-1", "2026-10-28T09:15:00.000", "CRITICAL", "a bad thing"))), testNow)
	if f.Error != "" {
		t.Fatalf("error on good input: %s", f.Error)
	}
	if len(f.CVEs) != 1 {
		t.Fatalf("got %d CVEs, want 1", len(f.CVEs))
	}
	c := f.CVEs[0]
	if c.ID != "CVE-2026-1" {
		t.Errorf("id = %q", c.ID)
	}
	if c.Description != "a bad thing" {
		t.Errorf("description = %q — the English one should win over the others", c.Description)
	}
	if c.Severity != Critical {
		t.Errorf("severity = %q, want CRITICAL", c.Severity)
	}
	if c.Published != "2026-10-28" {
		t.Errorf("published = %q, want a plain date", c.Published)
	}
	if c.URL != "https://nvd.nist.gov/vuln/detail/CVE-2026-1" {
		t.Errorf("url = %q", c.URL)
	}
}

func TestDecodeFeedWithoutSeverityAssumesHigh(t *testing.T) {
	f := decodeFeed(strings.NewReader(nvdBody(
		vuln("CVE-2026-2", "2026-10-28T09:15:00.000", "", "no metrics at all"))), testNow)
	if len(f.CVEs) != 1 || f.CVEs[0].Severity != High {
		t.Fatalf("severity = %v, want HIGH when the feed carries no metrics", f.CVEs)
	}
}

func TestDecodeFeedIgnoresASeverityItDoesNotKnow(t *testing.T) {
	f := decodeFeed(strings.NewReader(nvdBody(
		vuln("CVE-2026-3", "2026-10-28T09:15:00.000", "SPICY", "unknown severity"))), testNow)
	if len(f.CVEs) != 1 || f.CVEs[0].Severity != High {
		t.Fatalf("severity = %v, want the HIGH default rather than a value we cannot order", f.CVEs)
	}
}

func TestDecodeFeedSortsHardestFirstThenNewest(t *testing.T) {
	f := decodeFeed(strings.NewReader(nvdBody(
		vuln("CVE-low", "2026-10-20T00:00:00.000", "LOW", "low"),
		vuln("CVE-crit", "2026-10-21T00:00:00.000", "CRITICAL", "crit"),
		vuln("CVE-high-old", "2026-10-22T00:00:00.000", "HIGH", "older high"),
		vuln("CVE-high-new", "2026-10-27T00:00:00.000", "HIGH", "newer high"),
	)), testNow)
	var got []string
	for _, c := range f.CVEs {
		got = append(got, c.ID)
	}
	want := []string{"CVE-crit", "CVE-high-new", "CVE-high-old", "CVE-low"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v — severity first, then newest", got, want)
		}
	}
}

func TestDecodeFeedCapsTheList(t *testing.T) {
	var vs []string
	for i := 0; i < 25; i++ {
		vs = append(vs, vuln(fmt.Sprintf("CVE-%02d", i), "2026-10-28T09:15:00.000", "HIGH", "x"))
	}
	f := decodeFeed(strings.NewReader(nvdBody(vs...)), testNow)
	if len(f.CVEs) != 15 {
		t.Fatalf("got %d CVEs, want the list capped at 15", len(f.CVEs))
	}
}

// A description that is long in BYTES but short in runes used to be truncated anyway, and sliced
// at a byte offset, which lands inside a multi-byte character and leaves invalid UTF-8 behind.
// It should now be left alone.
func TestDecodeFeedKeepsAShortDescriptionThatIsManyBytes(t *testing.T) {
	long := strings.Repeat("é", 150) // 300 bytes, 150 runes
	f := decodeFeed(strings.NewReader(nvdBody(
		vuln("CVE-2026-4", "2026-10-28T09:15:00.000", "HIGH", long))), testNow)
	if len(f.CVEs) != 1 {
		t.Fatalf("got %d CVEs, want 1", len(f.CVEs))
	}
	got := f.CVEs[0].Description
	if !utf8.ValidString(got) {
		t.Fatal("description is not valid UTF-8 — it was cut inside a character")
	}
	if got != long {
		t.Errorf("description is %d runes, want all %d kept: it is under the limit",
			utf8.RuneCountInString(got), utf8.RuneCountInString(long))
	}
}

func TestDecodeFeedTruncatesALongDescription(t *testing.T) {
	long := strings.Repeat("é", 250) // 250 runes, comfortably over the limit
	f := decodeFeed(strings.NewReader(nvdBody(
		vuln("CVE-2026-5", "2026-10-28T09:15:00.000", "HIGH", long))), testNow)
	if len(f.CVEs) != 1 {
		t.Fatalf("got %d CVEs, want 1", len(f.CVEs))
	}
	got := f.CVEs[0].Description
	if !utf8.ValidString(got) {
		t.Error("description is not valid UTF-8 after truncation")
	}
	if !strings.HasSuffix(got, "...") {
		t.Errorf("description = %q, want it to end in an ellipsis", got)
	}
	if n := utf8.RuneCountInString(got); n != 200 {
		t.Errorf("description is %d runes, want 200", n)
	}
}

func TestDecodeFeedRejectsRubbish(t *testing.T) {
	f := decodeFeed(strings.NewReader("{not json"), testNow)
	if f.Error == "" {
		t.Fatal("no error for a body that is not JSON")
	}
	if len(f.CVEs) != 0 {
		t.Errorf("got %d CVEs from rubbish", len(f.CVEs))
	}
}

func TestFetchReportsAnUnhappyStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	defer swapNVD(t, srv.URL)()

	f := fetchNVD()
	if !strings.Contains(f.Error, "503") {
		t.Fatalf("error = %q, want it to name the status", f.Error)
	}
}

func TestFetchReportsAnUnreachableServer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // closed, so the request cannot connect
	defer swapNVD(t, srv.URL)()

	if f := fetchNVD(); f.Error == "" {
		t.Fatal("no error when the server could not be reached")
	}
}

// swapNVD points the fetch at a test server and returns the function that puts it back.
func swapNVD(t *testing.T, url string) func() {
	t.Helper()
	oldBase, oldClient := nvdBase, nvdClient
	nvdBase, nvdClient = url, &http.Client{Timeout: 5 * time.Second}
	return func() { nvdBase, nvdClient = oldBase, oldClient }
}

func TestCacheHoldsOffUntilTheTTLIsUp(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		fmt.Fprint(w, nvdBody(vuln("CVE-2026-5", "2026-10-28T09:15:00.000", "HIGH", "x")))
	}))
	defer srv.Close()
	defer swapNVD(t, srv.URL)()

	c := NewCache(time.Hour)
	c.Refresh()
	c.Refresh()
	if hits != 1 {
		t.Fatalf("fetched %d times, want 1 — the second call is inside the TTL", hits)
	}
}

// The tips describe the reader's own repositories and arrive by a different route from the CVEs,
// so a refresh must not carry them away with it.
func TestRefreshKeepsTheTips(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, nvdBody(vuln("CVE-2026-6", "2026-10-28T09:15:00.000", "HIGH", "x")))
	}))
	defer srv.Close()
	defer swapNVD(t, srv.URL)()

	c := NewCache(time.Hour)
	c.SetTips([]Tip{{Text: "run govulncheck"}})
	c.Refresh()

	got := c.Get()
	if len(got.Tips) != 1 {
		t.Fatalf("got %d tips after a refresh, want the one that was set", len(got.Tips))
	}
	if len(got.CVEs) != 1 {
		t.Errorf("got %d CVEs, want the refresh to have landed too", len(got.CVEs))
	}
}

// A blip at NVD should leave what is on screen alone. Blanking the panel tells the reader less
// than stale data does, and the fetch time has to stay put so they can see how old it is.
func TestAFailedRefreshKeepsTheLastGoodFeed(t *testing.T) {
	var fail bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		fmt.Fprint(w, nvdBody(
			vuln("CVE-2026-7", "2026-10-28T09:15:00.000", "HIGH", "first"),
			vuln("CVE-2026-8", "2026-10-27T09:15:00.000", "HIGH", "second")))
	}))
	defer srv.Close()
	defer swapNVD(t, srv.URL)()

	c := NewCache(0) // no TTL, so the second Refresh really refetches
	c.Refresh()
	good := c.Get()
	if len(good.CVEs) != 2 {
		t.Fatalf("setup: got %d CVEs, want 2", len(good.CVEs))
	}

	fail = true
	c.Refresh()

	after := c.Get()
	if len(after.CVEs) != 2 {
		t.Errorf("got %d CVEs after a failed refresh, want the 2 still on screen", len(after.CVEs))
	}
	if after.Error == "" {
		t.Error("the failure is not reported alongside the kept data")
	}
	if after.FetchedAt != good.FetchedAt {
		t.Errorf("fetch time moved to %q; it should stay at %q so the data does not read as fresh",
			after.FetchedAt, good.FetchedAt)
	}
}

func TestTipsFollowTheLanguagesInUse(t *testing.T) {
	for _, tc := range []struct {
		repo string
		want string
	}{
		{"golang/go", "govulncheck"},
		{"dustin/go-humanize", "govulncheck"},
		{"nodejs/node", "npm audit"},
		{"xrplf/xrpl.js", "npm audit"},
		{"xrplf/xrpl-py", "pip-audit"},
		{"django/django", "pip-audit"},
		{"rust-lang/cargo", "cargo audit"},
	} {
		if !hasTip(GenerateTips([]string{tc.repo}), tc.want) {
			t.Errorf("%s did not get the %q tip", tc.repo, tc.want)
		}
	}
}

// The detection used to match substrings, so "tiangolo" read as Go and "django" read as Go as
// well as Python. Advice for a language a project does not use is worse than no advice.
func TestTipsDoNotMatchInsideWords(t *testing.T) {
	for _, tc := range []struct {
		repo    string
		unwated string
	}{
		{"tiangolo/fastapi", "govulncheck"},
		{"django/django", "govulncheck"},
		{"mongodb/mongo", "govulncheck"},
	} {
		if hasTip(GenerateTips([]string{tc.repo}), tc.unwated) {
			t.Errorf("%s wrongly got the %q tip from a substring", tc.repo, tc.unwated)
		}
	}
}

func TestTipsAlwaysCarryTheGeneralAdvice(t *testing.T) {
	tips := GenerateTips(nil)
	if len(tips) == 0 {
		t.Fatal("no tips at all for a reader with no repositories")
	}
	if !hasTip(tips, "secret scanning") {
		t.Error("the advice that applies to everyone is missing")
	}
}

func TestTipsAreCapped(t *testing.T) {
	tips := GenerateTips([]string{"golang/go", "nodejs/node", "pypa/pip", "rust-lang/cargo"})
	if len(tips) > 5 {
		t.Fatalf("got %d tips, want at most 5", len(tips))
	}
}

func hasTip(tips []Tip, substr string) bool {
	for _, tp := range tips {
		if strings.Contains(tp.Text, substr) {
			return true
		}
	}
	return false
}
