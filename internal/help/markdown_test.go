package help

import (
	"os"
	"strings"
	"testing"
)

func same(t string) string { return t }

func TestRenderBlocksAndInline(t *testing.T) {
	md := "# Title\n\nIntro with **bold**, *italic*, `a|b <c>` and [a link](../README.md).\n\n" +
		"## First part\n\n- **Dot:** what needs you.\n  - **Green:** new. Tag says\n    what.\n  - **Amber:** yours.\n\n  \"Read\" is GitHub's state.\n- Second item\n\n" +
		"| Key | Does |\n|---|---|\n| **/** | Search `a|b` |\n\n```\n<raw> & code\n```\n\n### Sub heading\n\n> quoted\n\n1. one\n2. two\n\n" +
		"## Troubleshooting\n\n<script>alert(1)</script>\n"
	d := Render(md, func(s string) string { return strings.Replace(s, "../README.md", "https://example.test/readme", 1) })
	if d.Title != "Title" || len(d.Sections) != 2 || d.Sections[1].ID != "troubleshooting" {
		t.Fatalf("doc %+v", d)
	}
	if want := `<p>Intro with <strong>bold</strong>, <em>italic</em>, <code>a|b &lt;c&gt;</code> and <a href="https://example.test/readme" target="_blank" rel="noopener">a link</a>.</p>`; !strings.Contains(d.Intro, want) {
		t.Errorf("intro\n got  %s\n want %s", d.Intro, want)
	}
	h := d.Sections[0].HTML
	for _, want := range []string{
		"<ul>\n<li><strong>Dot:</strong> what needs you.<ul>\n<li><strong>Green:</strong> new. Tag says what.</li>\n<li><strong>Amber:</strong> yours.</li>\n</ul>\n<p>&#34;Read&#34; is GitHub&#39;s state.</p>\n</li>\n<li>Second item</li>\n</ul>",
		"<th>Key</th><th>Does</th>", "<td><strong>/</strong></td><td>Search <code>a|b</code></td>",
		"<pre><code>&lt;raw&gt; &amp; code</code></pre>", `<h3 id="sub-heading">Sub heading</h3>`,
		"<blockquote><p>quoted</p></blockquote>", "<ol>\n<li>one</li>\n<li>two</li>\n</ol>",
	} {
		if !strings.Contains(h, want) {
			t.Errorf("missing\n%s\nin\n%s", want, h)
		}
	}
	if strings.Contains(d.Sections[1].HTML, "<script>") {
		t.Error("raw HTML must come out escaped")
	}
}

// The real guide renders with every section and no stray Markdown.
func TestTheGuideRenders(t *testing.T) {
	b, err := os.ReadFile("../../docs/GUIDE.md")
	if err != nil {
		t.Fatal(err)
	}
	d := Render(string(b), same)
	if d.Title != "Reading HelloGitty" {
		t.Errorf("title %q", d.Title)
	}
	ids := map[string]bool{}
	for _, s := range d.Sections {
		ids[s.ID] = true
		for _, leak := range []string{"**", "](", "\n| ", "```"} {
			if strings.Contains(s.HTML, leak) {
				t.Errorf("section %s still has Markdown %q", s.ID, leak)
			}
		}
	}
	for _, id := range []string{"the-five-second-check", "your-work", "layouts", "hover-help", "keyboard-shortcuts", "your-data-and-privacy", "questions-people-ask", "getting-help", "troubleshooting"} {
		if !ids[id] {
			t.Errorf("section %s missing; have %v", id, ids)
		}
	}
}
