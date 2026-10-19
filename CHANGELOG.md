# Changelog

Newest first. Each milestone has a semantic version and a codename; see
[VERSIONING.md](VERSIONING.md).

## Unreleased

Fixes, waiting for the owner to declare the next milestone.

- Repositories with more open issues than the fetch limit (10 pages) now show exact open,
  good-first and unassigned counts from GitHub search instead of counting only the fetched pages.
  If those counts cannot be fetched, the repository is reported under POLL FAIL rather than shown
  with a partial number.
- A pull request whose closing comment says it was merged by hand ("merged manually",
  "cherry-picked as <commit>") no longer counts as denied.
- Comments from bot accounts and CI status comments are no longer taken as a maintainer's
  closing comment.
- GitHub's secondary (burst) rate limit is now waited out and retried, and search calls are
  spaced to stay under 30 a minute.
- A banner mascot: Black Bombay (baby), a rim-lit black kitten, at the right end of the status
  line. It plays one short silent clip per page load (a livelier one when data changed) and rests
  otherwise; reduced-motion users see a still. Clips are compiled into the binary.
- `hellogitty unwatch owner/name 123 [456 ...]` stops watching issues, so a closed watch no longer
  keeps WATCH CLOSED lit. `watch` now checks every issue number before adding any.
- A guide to reading the dashboard, [docs/GUIDE.md](docs/GUIDE.md): every column, colour and
  cell, what to do when one lights up, and troubleshooting.

## v0.1.0 · Black Bombay (baby) · 2026-10-19

First public release.

- Hourly polling of a configured set of GitHub repositories, stored in SQLite.
- Local dashboard on a loopback address: status line with UTC clock, poll age, cycle time and
  API budget; caution and warning panel; per-repository health, issue counts, last commit age,
  watched issues and denied outside pull requests with maintainers' closing comments.
- Watch list (`hellogitty watch owner/name 123`) with claim detection from assignees and
  comments, and fix detection from merged pull requests and closing commits.
- Your own pull requests in tracked repositories, with merge rate.
- `snapshot.json` for scripts, written atomically after every poll.
- `hellogitty.json` config with inline repositories or a `repos_file` re-read on every poll.
- Optional `pipeline_command` to show your own workflow stages per repository.
- `-version` flag, and the version and codename, with "(baby)" while it applies, in the dashboard header.
