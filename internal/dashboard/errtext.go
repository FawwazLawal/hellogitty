package dashboard

import (
	"fmt"
	"regexp"
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

// FriendlyErr holds a user-facing error broken into a short explanation and the raw detail.
// Templates show Summary prominently and Detail in secondary text.
type FriendlyErr struct {
	Summary string // plain-language explanation with a resolution tip
	Detail  string // the raw error code or message, for debugging
}

// Empty reports whether there is no error.
func (e FriendlyErr) Empty() bool { return e.Summary == "" }

var statusRe = regexp.MustCompile(`\b(\d{3})\b`)

// friendlyError classifies a raw error string into a human-readable summary (with a tip) and a
// short detail string (the HTTP status or exit code). When the error is not recognised the summary
// is a generic message and the full raw string becomes the detail.
func friendlyError(raw string) FriendlyErr {
	if raw == "" {
		return FriendlyErr{}
	}
	low := strings.ToLower(raw)

	type match struct {
		summary string
		detail  string
	}
	var m match

	switch {
	case strings.Contains(low, "502"), strings.Contains(low, "503"), strings.Contains(low, "504"):
		code := statusRe.FindString(raw)
		names := map[string]string{"502": "Bad Gateway", "503": "Service Unavailable", "504": "Gateway Timeout"}
		label := code
		if n, ok := names[code]; ok {
			label = code + " " + n
		}
		m = match{
			summary: "GitHub is temporarily unavailable — your data will load on the next refresh.",
			detail:  label,
		}
	case strings.Contains(low, "status 500"), strings.Contains(low, "500 internal"):
		m = match{
			summary: "GitHub had an internal error — this usually resolves on its own within a few minutes.",
			detail:  "500 Internal Server Error",
		}
	case strings.Contains(low, "deadline exceeded"), strings.Contains(low, "timeout"), strings.Contains(low, "i/o timeout"):
		m = match{
			summary: "GitHub took too long to respond. This usually means GitHub is under heavy load — it will retry on the next refresh.",
			detail:  "request timed out",
		}
	case strings.Contains(low, "rate limit"):
		m = match{
			summary: "GitHub's hourly API budget has run out. HelloGitty will resume when the limit resets (usually within the hour).",
			detail:  "rate limit exceeded",
		}
	case strings.Contains(low, "status 401"), strings.Contains(low, "bad credentials"):
		m = match{
			summary: "GitHub refused the token — it may have expired or been revoked. Try signing in again or refreshing your token.",
			detail:  "401 Unauthorized",
		}
	case strings.Contains(low, "status 403"):
		m = match{
			summary: "GitHub refused access with this token. Check that the token has the required scopes.",
			detail:  "403 Forbidden",
		}
	case strings.Contains(low, "status 404"), strings.Contains(low, "not found"):
		m = match{
			summary: "GitHub can't find the resource — it may have been renamed, deleted, or made private.",
			detail:  "404 Not Found",
		}
	case strings.Contains(low, "no such host"), strings.Contains(low, "connection refused"), strings.Contains(low, "network is unreachable"):
		m = match{
			summary: "Can't reach GitHub — check your internet connection. HelloGitty will retry on the next refresh.",
			detail:  "network error",
		}
	case strings.Contains(low, "exit status"):
		code := ""
		if i := strings.Index(low, "exit status"); i >= 0 {
			code = strings.TrimSpace(raw[i:])
		}
		m = match{
			summary: "The command failed to run. Check that the command in your config is correct and works on its own.",
			detail:  code,
		}
	default:
		m = match{
			summary: "Something went wrong — HelloGitty will retry on the next refresh.",
			detail:  raw,
		}
	}

	return FriendlyErr{Summary: m.summary, Detail: m.detail}
}

// pipelineError produces a friendly message for pipeline command failures.
func pipelineError(raw string) FriendlyErr {
	if raw == "" {
		return FriendlyErr{}
	}
	fe := friendlyError(raw)
	if strings.Contains(strings.ToLower(raw), "exit status") {
		fe.Summary = "The pipeline command failed to run. Check that the command in your config is correct and works on its own."
	}
	return fe
}

// securityError produces a friendly message for security feed errors.
func securityError(raw string) FriendlyErr {
	if raw == "" {
		return FriendlyErr{}
	}
	low := strings.ToLower(raw)
	switch {
	case strings.Contains(low, "nvd api returned"):
		code := statusRe.FindString(raw)
		return FriendlyErr{
			Summary: "The NVD security feed is temporarily unavailable — it will retry on the next refresh.",
			Detail:  fmt.Sprintf("NVD API %s", code),
		}
	default:
		return friendlyError(raw)
	}
}
