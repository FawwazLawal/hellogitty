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

// Ago says how long ago t was in words a person reads at a glance: "3 days ago".
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
	case d < 24*time.Hour:
		return Plural(int(d/time.Hour), "hour") + " ago"
	case d < 14*24*time.Hour:
		return Plural(int(d/(24*time.Hour)), "day") + " ago"
	case d < 60*24*time.Hour:
		return Plural(int(d/(7*24*time.Hour)), "week") + " ago"
	case d < 365*24*time.Hour:
		return Plural(int(d/(30*24*time.Hour)), "month") + " ago"
	}
	return Plural(int(d/(365*24*time.Hour)), "year") + " ago"
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
