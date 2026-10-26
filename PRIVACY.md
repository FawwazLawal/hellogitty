# Privacy Policy

**HelloGitty** — privacy policy for the local dashboard and the Chrome extension
("HelloGitty for Chrome").

Last updated: 2026-10-26

---

## What HelloGitty is

HelloGitty is a developer tool that shows you the state of your GitHub pull
requests, issues and repositories on a local dashboard. The Chrome extension
brings a subset of the same view into your browser.

The dashboard runs entirely on your machine. The extension uses a small token
exchange server during sign-in (see "Where data is sent" below) but has no
HelloGitty account and no backend that stores your data.

## Data HelloGitty collects

### From GitHub's API

HelloGitty reads data about repositories, issues, pull requests, reviews,
check runs, comments and notifications through the GitHub REST and GraphQL
APIs, using a token you provide. The data it reads includes:

- Repository metadata (name, owner, open issue counts, commit timestamps).
- Pull request and issue details (title, state, author, assignees, reviewers,
  labels, comments, review verdicts, check statuses).
- Your GitHub notifications (thread subject, reason, read state).
- Your GitHub username (from the `viewer` query).

HelloGitty never writes to GitHub except when you explicitly press a button
that says it will. Today the only write is marking a single notification as
read when you press **Ack** on a feed line or **Clear** on a notification row.

### From you

- **GitHub token.** The dashboard reads a personal access token from the
  `GITHUB_TOKEN` environment variable. The extension signs you in through
  GitHub's web authorization flow (one click), falls back to the device
  authorization flow, or accepts a pasted fine-grained token.
- **Configuration.** Which repositories to track, which issues to watch, layout
  preferences, theme choice. All stored locally.

## Where data is stored

| Component | Storage | Location |
|-----------|---------|----------|
| Dashboard | SQLite database, JSON snapshot, JSON inbox | Your machine, paths shown on the Help page |
| Extension | `chrome.storage.local` (auth, board cache, settings) | Your browser profile, on your machine |
| Extension (transient) | `chrome.storage.session` (device-flow state) | Browser memory only, never touches disk |

No data is stored on any server operated by HelloGitty or its author.

## Where data is sent

HelloGitty sends requests only to these hosts:

- `api.github.com` — REST and GraphQL API calls.
- `github.com/login/oauth/authorize` — web-flow sign-in (extension only,
  opened in a Chrome identity popup).
- `github.com/login/device/code` and `github.com/login/oauth/access_token` —
  device-flow sign-in (extension only, fallback).
- `hellogitty-oauth-production.up.railway.app` — token exchange server
  (extension only, during sign-in). Receives the one-time authorization code
  from the web flow and returns an access token. It does not store the code,
  the token, or any user data.

HelloGitty does not send data to any analytics, telemetry, advertising,
crash-reporting or third-party service. There are no tracking pixels, no
beacons, no outbound calls other than the GitHub API.

## What HelloGitty does not do

- Does not collect or transmit personal information beyond your GitHub username.
- Does not access your browsing history, bookmarks, or other browser data.
- Does not read or modify web pages you visit (no content scripts).
- Does not track your location, contacts, or any device identifiers.
- Does not run when you are not using it (the extension's service worker wakes
  on a 5-minute alarm to refresh data, then sleeps).
- Does not sell, share, or transfer data to third parties for any purpose.
- Does not use data for advertising, profiling, or creditworthiness assessment.

## Chrome extension permissions

| Permission | Why |
|------------|-----|
| `storage` | Save your auth token, board cache and settings locally. |
| `alarms` | Schedule background refreshes every 5 minutes. |
| `sidePanel` | Show the board in Chrome's side panel. |
| `identity` | Open a GitHub sign-in popup so you can authorize with one click. |
| Host: `api.github.com` | Fetch your pull requests, issues and repos. |
| Host (optional): `github.com/login` | Device-flow sign-in. Requested only when you sign in. |
| Host (optional): `localhost:7340` | Connect to your local HelloGitty dashboard, if running. |

## Data retention

All data stays on your machine for as long as you keep HelloGitty installed.

- **Dashboard:** Uninstalling or deleting the binary and its database removes
  all stored data.
- **Extension:** Uninstalling the extension removes all data from
  `chrome.storage`. Signing out from the extension's settings clears your
  token and cached board.

## Security

- The dashboard binds to `localhost` only. It is not reachable from other
  machines on your network.
- Every mutating request requires a same-origin check and a per-process CSRF
  token.
- Security headers (X-Content-Type-Options, X-Frame-Options, Content-Security-Policy)
  are set on every response.
- The extension stores tokens in `chrome.storage.local`, never in cookies or
  the DOM.
- GitHub tokens are never logged, written to output files, or exposed in error
  messages.

## Children

HelloGitty is a developer tool. It is not directed at children under 13 and
does not knowingly collect data from them.

## Changes

If this policy changes, the new version will be posted in the repository and,
for the Chrome extension, in the Chrome Web Store listing. The "last updated"
date at the top will change.

## Contact

Questions about this policy: open an issue on the HelloGitty repository or
email the author at the address listed in the repository.
