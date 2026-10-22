package dashboard

import (
	"strings"
)

// checkError says in plain words why checking something failed. The raw error stays available for
// a bug report; this is what the page leads with.
func checkError(raw string) string {
	if raw == "" {
		return ""
	}
	low := strings.ToLower(raw)
	what := ""
	for prefix, part := range map[string]string{
		"pull requests:": "its pull requests", "issues:": "its issues", "last commit:": "its last commit",
		"comments:": "issue comments", "timeline:": "an issue's history", "reviews:": "reviews",
	} {
		if strings.HasPrefix(low, prefix) {
			what = part
		}
	}
	var why string
	switch {
	case strings.Contains(low, "deadline exceeded"), strings.Contains(low, "timeout"), strings.Contains(low, "i/o timeout"):
		why = "GitHub took too long to answer"
	case strings.Contains(low, "rate limit"):
		why = "the hourly GitHub budget ran out"
	case strings.Contains(low, "status 401"), strings.Contains(low, "bad credentials"):
		why = "GitHub refused the token (expired or revoked?)"
	case strings.Contains(low, "status 403"):
		why = "GitHub refused access with this token"
	case strings.Contains(low, "status 404"), strings.Contains(low, "not found"):
		why = "GitHub can't find it (renamed, deleted, or private?)"
	case strings.Contains(low, "status 5"):
		why = "GitHub had a server error"
	case strings.Contains(low, "no such host"), strings.Contains(low, "connection refused"), strings.Contains(low, "network is unreachable"):
		why = "couldn't reach GitHub (offline?)"
	default:
		return raw
	}
	if what != "" {
		why += " while sending " + what
	}
	return why + "."
}

// failedLine is one entry in the Check failed cell's explanation.
func failedLine(name, raw string) string {
	return name + ": " + checkError(raw)
}
