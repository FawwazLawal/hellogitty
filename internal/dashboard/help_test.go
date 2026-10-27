package dashboard

import (
	"os"
	"strings"
	"testing"

	"github.com/FawwazLawal/hellogitty/web"
)

func TestHelpPage(t *testing.T) {
	guide, err := os.ReadFile("../../docs/GUIDE.md")
	if err != nil {
		t.Fatal(err)
	}
	st := pipeFixture(t)
	st.Glossary = map[string]string{"PASS": "Gate passed."}
	h := handler(fakeSource{pipe: st})
	h.HelpTemplate, h.Guide, h.Screenshot = web.Help, string(guide), []byte("png")
	h.About = []AboutItem{{Key: "Database", Value: "/tmp/hg.db"}}

	code, body := get(t, h, "/help")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	for _, want := range []string{
		`<title>HelloGitty help</title>`, `<h2>Reading HelloGitty</h2>`,
		`<li><a href="#troubleshooting">Troubleshooting</a></li>`, `<section class="hs" id="keyboard-shortcuts"`,
		`<img src="/help/screenshot.png"`, `<a href="https://github.com/FawwazLawal/hellogitty#readme" target="_blank" rel="noopener">README</a>`,
		`<dt>Repo flagged<span class="kind">Alert cell</span></dt>`, `<dt>PASS<span class="kind">From your pipeline</span></dt>`,
		`<dt>Database</dt><dd>/tmp/hg.db</dd>`, `<dt>Notifications</dt><dd>Not available in this build</dd>`,
		`href="https://github.com/FawwazLawal/hellogitty/issues/new"`, `--bg: #0a0a0b`, `data-theme-set="dark"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %s", want)
		}
	}
	for _, bad := range []string{"{{", "**", "ZgotmplZ"} {
		if strings.Contains(body, bad) {
			t.Errorf("leaked %q", bad)
		}
	}
	if code, body := get(t, h, "/help/screenshot.png"); code != 200 || body != "png" {
		t.Errorf("screenshot %d %q", code, body)
	}
	_, dash := get(t, h, "/")
	if !strings.Contains(dash, `<a class="headbtn" href="/help" title="Help (press ?)">`) {
		t.Error("the dashboard header links to Help")
	}
}
