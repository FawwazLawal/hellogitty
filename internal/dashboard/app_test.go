package dashboard

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/FawwazLawal/hellogitty/web"
)

// The /app/ route is the Phase 2 integration surface: the Go binary serving the
// built React application with no Node at runtime. These hold the three
// behaviours that are decisions rather than defaults, because each of them
// fails quietly in a way that looks like something else.
func TestServeAppRouting(t *testing.T) {
	// A stand-in for a real Vite build: a document, a fingerprinted asset.
	app := fstest.MapFS{
		"index.html":              {Data: []byte("<!doctype html><title>app</title>")},
		"assets/index-abc123.js":  {Data: []byte("console.log(1)")},
		"assets/index-abc123.css": {Data: []byte(":root{}")},
	}
	h := &Handler{App: app}

	cases := []struct {
		name       string
		path       string
		wantStatus int
		wantBody   string // substring; empty means do not check
		wantCache  string
		why        string
	}{
		{
			name: "root of the app serves the document",
			path: "/app/", wantStatus: 200, wantBody: "<title>app</title>", wantCache: "no-store",
			why: "index.html is not fingerprinted, so caching it strands a user on a page pointing at assets the binary no longer has",
		},
		{
			name: "bare /app serves the document too",
			path: "/app", wantStatus: 200, wantBody: "<title>app</title>",
			why: "a link without the trailing slash is the same page",
		},
		{
			name: "a client route falls back to the document",
			path: "/app/repos/some/deep/route", wantStatus: 200, wantBody: "<title>app</title>",
			why: "a client-routed app owns its URL space; without this every deep link and every refresh 404s, which looks like a broken deploy",
		},
		{
			name: "a real asset is served and cached hard",
			path: "/app/assets/index-abc123.js", wantStatus: 200, wantBody: "console.log(1)",
			wantCache: "public, max-age=31536000, immutable",
			why:       "Vite fingerprints asset names, so they are immutable",
		},
		{
			name: "a MISSING asset 404s rather than falling back",
			path: "/app/assets/index-gone.js", wantStatus: 404,
			why: "serving index.html for a missing script hands the browser HTML where it expected JavaScript, and the failure surfaces as an opaque MIME error instead of a 404 naming the file",
		},
		{
			name: "traversal cannot escape the bundle",
			path: "/app/../../etc/passwd", wantStatus: 200, wantBody: "<title>app</title>",
			why: "this handler resolves names itself for the fallback, so it must do its own containment",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.serveApp(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if rec.Code != tc.wantStatus {
				t.Errorf("%s = %d, want %d\nwhy it matters: %s", tc.path, rec.Code, tc.wantStatus, tc.why)
			}
			if tc.wantBody != "" && !strings.Contains(rec.Body.String(), tc.wantBody) {
				t.Errorf("%s body = %q, want it to contain %q\nwhy it matters: %s",
					tc.path, rec.Body.String(), tc.wantBody, tc.why)
			}
			if tc.wantCache != "" && rec.Header().Get("Cache-Control") != tc.wantCache {
				t.Errorf("%s Cache-Control = %q, want %q\nwhy it matters: %s",
					tc.path, rec.Header().Get("Cache-Control"), tc.wantCache, tc.why)
			}
		})
	}
}

// A binary with no frontend build must still serve the dashboard it has.
func TestAppRouteIsOffWhenNothingIsEmbedded(t *testing.T) {
	h := &Handler{App: nil}
	if h.App != nil {
		t.Fatal("precondition")
	}
	// The route guard is `h.App != nil`, so with nil App the case never runs and
	// the request falls through to the normal 404 rather than panicking.
	rec := httptest.NewRecorder()
	defer func() {
		if p := recover(); p != nil {
			t.Fatalf("a nil app filesystem panicked: %v — a binary built without a frontend must still serve the dashboard", p)
		}
	}()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/app/", nil))
}

// The embedded bundle must contain a document, or /app/ serves nothing at all.
// This catches a build that wrote somewhere else, or an emptied output
// directory that was committed in that state.
func TestEmbeddedAppContainsADocument(t *testing.T) {
	sub, err := fs.Sub(web.App, "app")
	if err != nil {
		t.Fatalf("app embed: %v", err)
	}
	b, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		t.Fatalf("no index.html in the embedded app bundle: %v", err)
	}
	if len(b) == 0 {
		t.Fatal("the embedded index.html is empty")
	}
}

// The migration switch. Both dashboards are always in the binary; the flag
// only decides which one the front door opens onto.
func TestUIFlagChoosesTheFrontDoor(t *testing.T) {
	app := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>react app</title>")}}

	t.Run("default serves the templated dashboard", func(t *testing.T) {
		h := handler(fakeSource{})
		h.App = app
		// ReactIsDefault not set — the zero value must be the safe one.
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if strings.Contains(rec.Body.String(), "react app") {
			t.Error("/ served the React app without the flag being set; the default must be the dashboard that already works")
		}
	})

	t.Run("flag flips the front door", func(t *testing.T) {
		h := handler(fakeSource{})
		h.App = app
		h.ReactIsDefault = true
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if !strings.Contains(rec.Body.String(), "react app") {
			t.Errorf("/ did not serve the React app with the flag set; got: %.80s", rec.Body.String())
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("Cache-Control = %q, want no-store — index.html is not fingerprinted whichever door it came through", got)
		}
	})

	t.Run("legacy stays reachable either way", func(t *testing.T) {
		for _, reactDefault := range []bool{false, true} {
			h := handler(fakeSource{})
			h.App = app
			h.ReactIsDefault = reactDefault
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/legacy", nil))
			if rec.Code != http.StatusOK {
				t.Errorf("/legacy with ReactIsDefault=%v = %d, want 200 — a bookmark must survive the flag being flipped", reactDefault, rec.Code)
			}
			if strings.Contains(rec.Body.String(), "react app") {
				t.Errorf("/legacy with ReactIsDefault=%v served the React app", reactDefault)
			}
		}
	})

	t.Run("a missing bundle falls back rather than erroring", func(t *testing.T) {
		h := handler(fakeSource{})
		h.App = fstest.MapFS{} // flag says react, nothing is built
		h.ReactIsDefault = true
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != http.StatusOK {
			t.Errorf("/ = %d, want 200 — a misconfiguration must not take the product away", rec.Code)
		}
	})
}
