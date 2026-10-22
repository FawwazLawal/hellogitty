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
