package help

import (
	"html"
	"regexp"
	"strconv"
	"strings"
)

// Section is one part of a Markdown document, split at its "## " headings, rendered to HTML.
type Section struct {
	ID    string // the heading's anchor, as GitHub makes it: "troubleshooting"
	Title string
	HTML  string // the section's body, without its heading
	Text  string // the plain words, lower case, for searching
}

// Doc is a rendered document: its title, the part before the first section, and the sections.
type Doc struct {
	Title    string
	Intro    string
	Sections []Section
}

// Links rewrites a link target while rendering, for example "../README.md" to its page on GitHub.
type Links func(target string) string

// Render turns the Markdown HelloGitty's own guide uses into HTML: headings, paragraphs, nested
// lists, tables, fenced code, quotes, rules, images, links, bold, italics and code spans. It is not
// a general Markdown engine; everything else comes out as escaped text, never as raw HTML.
func Render(md string, links Links) Doc {
	var d Doc
	var cur *Section
	var body strings.Builder
	flush := func() {
		if cur == nil {
			d.Intro = body.String()
		} else {
			cur.HTML = body.String()
			cur.Text = strings.ToLower(stripTags.ReplaceAllString(cur.Title+" "+cur.HTML, " "))
			d.Sections = append(d.Sections, *cur)
		}
		body.Reset()
	}
	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	for i := 0; i < len(lines); {
		l := lines[i]
		switch {
		case strings.HasPrefix(l, "# ") && d.Title == "" && cur == nil:
			d.Title = strings.TrimSpace(l[2:])
			i++
		case strings.HasPrefix(l, "## "):
			flush()
			t := strings.TrimSpace(l[3:])
			cur = &Section{ID: Slug(t), Title: t}
			i++
		default:
			n := block(lines[i:], &body, links)
			i += n
		}
	}
	flush()
	return d
}

var (
	stripTags  = regexp.MustCompile(`<[^>]*>`)
	headingRe  = regexp.MustCompile(`^(#{3,6})\s+(.*)$`)
	listRe     = regexp.MustCompile(`^(\s*)([-*]|\d+\.)\s+(.*)$`)
	tableSepRe = regexp.MustCompile(`^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$`)
	imageRe    = regexp.MustCompile(`^!\[([^\]]*)\]\(([^)\s]+)\)\s*$`)
	slugDrop   = regexp.MustCompile(`[^a-z0-9 _-]`)
)

// Slug makes a heading's anchor the way GitHub does: lower case, punctuation dropped, spaces to
// hyphens.
func Slug(title string) string {
	s := strings.ToLower(stripTags.ReplaceAllString(title, ""))
	s = strings.NewReplacer("*", "", "`", "").Replace(s)
	s = slugDrop.ReplaceAllString(s, "")
	return strings.ReplaceAll(strings.TrimSpace(s), " ", "-")
}

// block renders one block starting at lines[0] and says how many lines it used.
func block(lines []string, out *strings.Builder, links Links) int {
	l := lines[0]
	t := strings.TrimSpace(l)
	switch {
	case t == "":
		return 1
	case strings.HasPrefix(t, "```"):
		n := 1
		var code []string
		for n < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[n]), "```") {
			code = append(code, lines[n])
			n++
		}
		out.WriteString("<pre><code>" + html.EscapeString(strings.Join(code, "\n")) + "</code></pre>\n")
		return min(n+1, len(lines))
	case t == "---" || t == "***":
		out.WriteString("<hr>\n")
		return 1
	case headingRe.MatchString(t):
		m := headingRe.FindStringSubmatch(t)
		lvl := strconv.Itoa(len(m[1]))
		out.WriteString("<h" + lvl + ` id="` + Slug(m[2]) + `">` + inline(m[2], links) + "</h" + lvl + ">\n")
		return 1
	case imageRe.MatchString(t):
		m := imageRe.FindStringSubmatch(t)
		out.WriteString(`<p><img src="` + html.EscapeString(links(m[2])) + `" alt="` + html.EscapeString(m[1]) + `" loading="lazy"></p>` + "\n")
		return 1
	case strings.HasPrefix(t, "|") && len(lines) > 1 && tableSepRe.MatchString(lines[1]):
		return table(lines, out, links)
	case strings.HasPrefix(t, ">"):
		n := 0
		var q []string
		for n < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[n]), ">") {
			q = append(q, strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(lines[n]), ">")))
			n++
		}
		out.WriteString("<blockquote><p>" + inline(strings.Join(q, " "), links) + "</p></blockquote>\n")
		return n
	case listRe.MatchString(l):
		return listBlock(lines, out, links)
	}
	// A paragraph: lines until a blank line or the start of another block.
	n := 0
	var p []string
	for n < len(lines) {
		x := strings.TrimSpace(lines[n])
		if x == "" || (n > 0 && startsBlock(lines[n], lines[n:])) {
			break
		}
		p = append(p, x)
		n++
	}
	out.WriteString("<p>" + inline(strings.Join(p, " "), links) + "</p>\n")
	return n
}

func startsBlock(l string, rest []string) bool {
	t := strings.TrimSpace(l)
	return strings.HasPrefix(t, "```") || t == "---" || headingRe.MatchString(t) || strings.HasPrefix(t, "## ") ||
		strings.HasPrefix(t, ">") || listRe.MatchString(l) || (strings.HasPrefix(t, "|") && len(rest) > 1 && tableSepRe.MatchString(rest[1]))
}

func cells(row string) []string {
	row = strings.TrimSpace(row)
	row = strings.TrimSuffix(strings.TrimPrefix(row, "|"), "|")
	// A "|" inside a code span (`a|b`) is part of the cell; split only outside backticks.
	var out []string
	var cur strings.Builder
	inCode := false
	for _, r := range row {
		switch {
		case r == '`':
			inCode = !inCode
			cur.WriteRune(r)
		case r == '|' && !inCode:
			out = append(out, strings.TrimSpace(cur.String()))
			cur.Reset()
		default:
			cur.WriteRune(r)
		}
	}
	return append(out, strings.TrimSpace(cur.String()))
}

func table(lines []string, out *strings.Builder, links Links) int {
	out.WriteString("<div class=\"tw\"><table>\n<thead><tr>")
	for _, c := range cells(lines[0]) {
		out.WriteString("<th>" + inline(c, links) + "</th>")
	}
	out.WriteString("</tr></thead>\n<tbody>\n")
	n := 2
	for n < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[n]), "|") {
		out.WriteString("<tr>")
		for _, c := range cells(lines[n]) {
			out.WriteString("<td>" + inline(c, links) + "</td>")
		}
		out.WriteString("</tr>\n")
		n++
	}
	out.WriteString("</tbody></table></div>\n")
	return n
}

// listBlock renders a list and everything nested in it: deeper items become a nested list, indented
// lines continue the item, and an indented paragraph after a blank line stays inside the item.
func listBlock(lines []string, out *strings.Builder, links Links) int {
	m := listRe.FindStringSubmatch(lines[0])
	indent := len(m[1])
	tag := "ul"
	if m[2] != "-" && m[2] != "*" {
		tag = "ol"
	}
	out.WriteString("<" + tag + ">\n")
	n := 0
	for n < len(lines) {
		m := listRe.FindStringSubmatch(lines[n])
		if m == nil || len(m[1]) != indent {
			break
		}
		// Gather the item: its first line, then lines indented deeper than the marker, including
		// those after a single blank line.
		var item []string
		item = append(item, m[3])
		n++
		for n < len(lines) {
			x := lines[n]
			if strings.TrimSpace(x) == "" {
				if n+1 < len(lines) && leading(lines[n+1]) > indent && strings.TrimSpace(lines[n+1]) != "" {
					item = append(item, "")
					n++
					continue
				}
				break
			}
			if leading(x) <= indent {
				break
			}
			item = append(item, x)
			n++
		}
		out.WriteString("<li>")
		var sub strings.Builder
		// The first paragraph is the item text; the rest are blocks of their own.
		first := []string{item[0]}
		k := 1
		for k < len(item) && strings.TrimSpace(item[k]) != "" && !listRe.MatchString(item[k]) {
			first = append(first, strings.TrimSpace(item[k]))
			k++
		}
		out.WriteString(inline(strings.Join(first, " "), links))
		rest := dedent(item[k:])
		for j := 0; j < len(rest); {
			j += block(rest[j:], &sub, links)
		}
		out.WriteString(sub.String() + "</li>\n")
		if n < len(lines) && strings.TrimSpace(lines[n]) == "" {
			if n+1 < len(lines) {
				if m2 := listRe.FindStringSubmatch(lines[n+1]); m2 != nil && len(m2[1]) == indent {
					n++
					continue
				}
			}
			break
		}
	}
	out.WriteString("</" + tag + ">\n")
	return max(n, 1)
}

func leading(s string) int { return len(s) - len(strings.TrimLeft(s, " ")) }

func dedent(lines []string) []string {
	least := -1
	for _, l := range lines {
		if strings.TrimSpace(l) == "" {
			continue
		}
		if d := leading(l); least < 0 || d < least {
			least = d
		}
	}
	out := make([]string, len(lines))
	for i, l := range lines {
		if len(l) >= least && least > 0 {
			out[i] = l[least:]
		} else {
			out[i] = strings.TrimLeft(l, " ")
		}
	}
	return out
}

var (
	linkRe   = regexp.MustCompile(`\[([^\]]+)\]\(([^)\s]+)\)`)
	boldRe   = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	italicRe = regexp.MustCompile(`(^|[^*\w])\*([^*\s][^*]*?)\*([^*\w]|$)`)
)

// inline renders a line's inline markup. Text is escaped first; code spans keep their contents
// literally.
func inline(s string, links Links) string {
	parts := strings.Split(s, "`")
	var b strings.Builder
	for i, p := range parts {
		if i%2 == 1 && i < len(parts)-1 {
			b.WriteString("<code>" + html.EscapeString(p) + "</code>")
			continue
		}
		if i%2 == 1 {
			p = "`" + p // an unmatched backtick stays as text
		}
		t := html.EscapeString(p)
		t = linkRe.ReplaceAllStringFunc(t, func(m string) string {
			sm := linkRe.FindStringSubmatch(m)
			href := links(html.UnescapeString(sm[2]))
			ext := ""
			if strings.HasPrefix(href, "http") {
				ext = ` target="_blank" rel="noopener"`
			}
			return `<a href="` + html.EscapeString(href) + `"` + ext + `>` + sm[1] + `</a>`
		})
		t = boldRe.ReplaceAllString(t, "<strong>$1</strong>")
		t = italicRe.ReplaceAllString(t, "$1<em>$2</em>$3")
		b.WriteString(t)
	}
	return b.String()
}
