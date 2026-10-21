package notify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/github"
)

// threads is the owner's inbox on 2026-10-21, abridged: a CI failure on a closed PR's branch, a
// comment on an issue, and a new pull request.
const threads = `[
 {"id":"1","unread":true,"reason":"ci_activity","updated_at":"2026-10-20T15:00:00Z",
  "subject":{"title":"mvn spotless:check (Formatting) workflow run failed for fix/8504-gzip-quality-parameter branch","url":null,"type":"CheckSuite"},
  "repository":{"full_name":"hapifhir/hapi-fhir","html_url":"https://github.com/hapifhir/hapi-fhir"}},
 {"id":"2","unread":false,"reason":"comment","updated_at":"2026-10-20T10:22:26Z",
  "subject":{"title":"Accept-Encoding: gzip;q=1.0 does not enable gzip response compression","url":"https://api.github.com/repos/hapifhir/hapi-fhir/issues/8504","type":"Issue"},
  "repository":{"full_name":"hapifhir/hapi-fhir","html_url":"https://github.com/hapifhir/hapi-fhir"}},
 {"id":"3","unread":true,"reason":"author","updated_at":"2026-10-21T09:00:00Z",
  "subject":{"title":"test: port PySpark Catalog.listFunctions doctest","url":"https://api.github.com/repos/lakehq/sail/pulls/2821","type":"PullRequest"},
  "repository":{"full_name":"lakehq/sail","html_url":"https://github.com/lakehq/sail"}}
]`

func TestRefreshKeepsTheListAcross304AndTurnsOffOn403(t *testing.T) {
	var calls atomic.Int32
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/notifications" || r.URL.Query().Get("all") != "true" {
			t.Errorf("request %s", r.URL)
		}
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		if r.Header.Get("If-Modified-Since") == "Tue, 21 Oct 2026 09:00:00 GMT" {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Last-Modified", "Tue, 21 Oct 2026 09:00:00 GMT")
		w.Header().Set("X-Poll-Interval", "90")
		w.Write([]byte(threads))
	}))
	defer srv.Close()
	gh := github.New("t")
	gh.BaseURL = srv.URL
	f := &Feed{GH: gh, Now: func() time.Time { return time.Date(2026, 10, 21, 9, 30, 0, 0, time.UTC) }}

	if err := f.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	v := f.Snapshot()
	if v.State != "ok" || len(v.Items) != 3 || f.Interval() != 90*time.Second {
		t.Fatalf("first fetch %+v interval %s", v, f.Interval())
	}
	ci, issue, pr := v.Items[0], v.Items[1], v.Items[2]
	if ci.Branch != "fix/8504-gzip-quality-parameter" || !ci.Failed || ci.Key() != "" || ci.Words() != "CI failed: mvn spotless:check (Formatting)" || !ci.Action() {
		t.Errorf("CI thread %+v %q", ci, ci.Words())
	}
	if issue.Key() != "hapifhir/hapi-fhir#8504" || issue.URL != "https://github.com/hapifhir/hapi-fhir/issues/8504" || issue.Unread || issue.Words() != "New comment" || issue.Action() {
		t.Errorf("issue thread %+v", issue)
	}
	if pr.URL != "https://github.com/lakehq/sail/pull/2821" || pr.Key() != "lakehq/sail#2821" {
		t.Errorf("PR thread %+v", pr)
	}

	if err := f.Refresh(context.Background()); err != nil || len(f.Snapshot().Items) != 3 {
		t.Errorf("a 304 keeps the list: %v %d", err, len(f.Snapshot().Items))
	}

	status = http.StatusForbidden
	f.Refresh(context.Background())
	if v := f.Snapshot(); v.State != "off" || !strings.Contains(v.Note, "Fine-grained") {
		t.Errorf("a token that can't read notifications turns the dots off, saying why: %+v", v)
	}
	if calls.Load() != 3 {
		t.Errorf("calls %d", calls.Load())
	}
}
