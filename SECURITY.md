# Security Policy

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, use one of these channels:

1. **GitHub Security Advisory** (preferred): go to the repository's **Settings → Security → Advisories → New draft security advisory** and describe the issue. This creates a private conversation with the maintainer.
2. **Email**: send details to the address listed in the maintainer's GitHub profile.

Include as much detail as you can: steps to reproduce, affected versions, and the potential impact.

## Scope

A security issue is anything that could compromise the confidentiality, integrity, or availability of a user's data or machine. Examples include:

- Token handling — leaking, logging, or mishandling the user's GitHub token
- Cross-site scripting (XSS) in the dashboard
- Template injection in Go's `html/template` rendering
- Authentication bypass or privilege escalation in the Chrome extension
- Dependency vulnerabilities that are reachable in HelloGitty's usage

If you are unsure whether something qualifies, report it privately and the maintainer will triage it.

## Response

- **Acknowledgement** within 48 hours of the report.
- **Fix target** of 7 days for critical issues; longer for lower-severity findings, with a timeline communicated in the advisory.
- A public disclosure and advisory will be published once the fix is released.

## Supported versions

Only the latest release on the `main` branch is supported with security fixes. Users are encouraged to stay up to date.

## Security design

HelloGitty is designed to minimise its attack surface:

- **Runs locally**: the dashboard is a binary on the user's own machine, serving only `localhost`.
- **Talks only to GitHub**: the only external network calls are to GitHub's API, authenticated with the user's own token.
- **No remote storage**: no data is sent to or stored on any third-party service.
- **Chrome extension is read-only**: it reads pull requests and issues from GitHub's API but cannot modify them. All extension data stays in `chrome.storage.local`.
- **No analytics or telemetry**: nothing is tracked or reported.
