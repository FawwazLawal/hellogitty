package dashboard

import "testing"

func TestCheckError(t *testing.T) {
	for raw, want := range map[string]string{
		"pull requests: context deadline exceeded (Client.Timeout or context cancellation while reading body)": "GitHub took too long to answer while sending its pull requests.",
		"issues: github: status 404 for https://api.github.com/repos/a/b/issues":                               "GitHub can't find it (renamed, deleted, or private?) while sending its issues.",
		"github: status 401: Bad credentials":                                                                  "GitHub refused the token (expired or revoked?).",
		"something new":                                                                                        "something new",
		"":                                                                                                     "",
	} {
		if got := checkError(raw); got != want {
			t.Errorf("checkError(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestFriendlyError(t *testing.T) {
	tests := []struct {
		raw         string
		wantSummary string
		wantDetail  string
	}{
		{
			raw:         "github: 502 from https://api.github.com/graphql: <html><head><title>502 Bad Gateway</title></head></html>",
			wantSummary: "GitHub is temporarily unavailable — your data will load on the next refresh.",
			wantDetail:  "502 Bad Gateway",
		},
		{
			raw:         "github: status 503",
			wantSummary: "GitHub is temporarily unavailable — your data will load on the next refresh.",
			wantDetail:  "503 Service Unavailable",
		},
		{
			raw:         "context deadline exceeded (Client.Timeout)",
			wantSummary: "GitHub took too long to respond. This usually means GitHub is under heavy load — it will retry on the next refresh.",
			wantDetail:  "request timed out",
		},
		{
			raw:         "rate limit exceeded",
			wantSummary: "GitHub's hourly API budget has run out. HelloGitty will resume when the limit resets (usually within the hour).",
			wantDetail:  "rate limit exceeded",
		},
		{
			raw:         "github: status 401: Bad credentials",
			wantSummary: "GitHub refused the token — it may have expired or been revoked. Try signing in again or refreshing your token.",
			wantDetail:  "401 Unauthorized",
		},
		{
			raw:         "no such host api.github.com",
			wantSummary: "Can't reach GitHub — check your internet connection. HelloGitty will retry on the next refresh.",
			wantDetail:  "network error",
		},
		{
			raw:         "exit status 1",
			wantSummary: "The command failed to run. Check that the command in your config is correct and works on its own.",
			wantDetail:  "exit status 1",
		},
		{
			raw:         "",
			wantSummary: "",
			wantDetail:  "",
		},
		{
			raw:         "something unexpected happened",
			wantSummary: "Something went wrong — HelloGitty will retry on the next refresh.",
			wantDetail:  "something unexpected happened",
		},
	}
	for _, tt := range tests {
		got := friendlyError(tt.raw)
		if got.Summary != tt.wantSummary {
			t.Errorf("friendlyError(%q).Summary = %q, want %q", tt.raw, got.Summary, tt.wantSummary)
		}
		if got.Detail != tt.wantDetail {
			t.Errorf("friendlyError(%q).Detail = %q, want %q", tt.raw, got.Detail, tt.wantDetail)
		}
	}
}

func TestFriendlyErrorEmpty(t *testing.T) {
	if !friendlyError("").Empty() {
		t.Error("friendlyError(\"\").Empty() should be true")
	}
	if friendlyError("something").Empty() {
		t.Error("friendlyError(\"something\").Empty() should be false")
	}
}
