package help

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	htmlComment = regexp.MustCompile(`(?s)<!--.*?-->`)
	htmlTag     = regexp.MustCompile(`(?s)<[^>]*>`)
	mdImage     = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	mdLink      = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	quoted      = regexp.MustCompile(`(?m)^>.*$`)
	codeFence   = regexp.MustCompile("(?s)```.*?```")
	spaces      = regexp.MustCompile(`\s+`)
)

// Excerpt turns a GitHub comment into one readable line: no HTML, quoted replies, code blocks or
// image markup, cut at a word boundary to at most max characters.
func Excerpt(body string, max int) string {
	s := htmlComment.ReplaceAllString(body, " ")
	s = codeFence.ReplaceAllString(s, " [code] ")
	s = quoted.ReplaceAllString(s, " ")
	s = mdImage.ReplaceAllString(s, " ")
	s = mdLink.ReplaceAllString(s, "$1")
	s = htmlTag.ReplaceAllString(s, " ")
	s = strings.NewReplacer("**", "", "__", "", "`", "", "&nbsp;", " ", "&amp;", "&").Replace(s)
	s = strings.TrimSpace(spaces.ReplaceAllString(s, " "))
	if len([]rune(s)) <= max {
		return s
	}
	cut := string([]rune(s)[:max])
	if i := strings.LastIndexByte(cut, ' '); i > max/2 {
		cut = cut[:i]
	}
	return strings.TrimRight(cut, " ,.;:") + "…"
}

// Ago returns a human-readable timestamp for t relative to now: exact times for anything older
// than an hour, relative words for the last few minutes.
func Ago(now, t time.Time) string {
	if t.IsZero() {
		return "—"
	}
	d := now.Sub(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return Plural(int(d/time.Minute), "min") + " ago"
	}
	nowY, nowM, nowD := now.Date()
	tY, tM, tD := t.Date()
	hm := fmt.Sprintf("%02d:%02d", t.Hour(), t.Minute())
	if nowY == tY && nowM == tM && nowD == tD {
		return hm
	}
	yesterday := now.AddDate(0, 0, -1)
	yY, yM, yD := yesterday.Date()
	if tY == yY && tM == yM && tD == yD {
		return "Yesterday " + hm
	}
	if d < 7*24*time.Hour {
		return t.Weekday().String()[:3] + " " + hm
	}
	if nowY == tY {
		return t.Format("Jan 2") + " " + hm
	}
	return t.Format("2006-01-02")
}

// Plural writes a count with its unit: "1 day", "3 days", "5 min".
func Plural(n int, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	if unit == "min" {
		return fmt.Sprintf("%d min", n)
	}
	return fmt.Sprintf("%d %ss", n, unit)
}
