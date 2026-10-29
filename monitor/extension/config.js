// Build-time settings. build.sh fills OAUTH_CLIENT_ID and OAUTH_EXCHANGE_URL from environment
// variables in the packaged copy; they stay empty in the repository.
//
// OAUTH_CLIENT_ID is the public client ID of the GitHub App (or OAuth App). While empty the
// extension offers only the paste-a-token sign-in.
//
// OAUTH_EXCHANGE_URL is the token exchange server that holds the client secret and swaps an auth
// code for an access token. When set, sign-in uses Chrome's web auth popup (one click). When
// empty but OAUTH_CLIENT_ID is set, sign-in falls back to the device flow (copy-paste a code).
//
// OAUTH_SCOPE is the OAuth scope sent in the device flow (OAuth App). The web auth flow (GitHub
// App) ignores this and uses "offline_access" instead, since GitHub App permissions are set in
// the app registration. "read:org" is the least the board query needs with an OAuth App;
// "notifications" lets it read unread notifications to mark items New. That scope would also allow
// marking threads read, which HelloGitty never does: it only reads.
self.HELLOGITTY_CONFIG = {
  OAUTH_CLIENT_ID: "",
  OAUTH_EXCHANGE_URL: "",
  OAUTH_SCOPE: "read:org notifications",
};
