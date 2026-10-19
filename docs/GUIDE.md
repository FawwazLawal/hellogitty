# Reading HelloGitty

A guide to every part of the dashboard and what to do with it. For installing and configuring,
see the [README](../README.md).

HelloGitty is built to be left open all day and glanced at. Most of the screen stays dark and
neutral on purpose. Colour appears only when something is true that you may need to act on, so
the first rule of reading it is simple: **if nothing is lit, nothing needs you.**

![HelloGitty dashboard](screenshot.png)

---

## The three-second check

1. Look at the row of cells under the header (the caution and warning panel).
2. All dark? You're done.
3. Something lit? Read its name, then the repository names written inside it, then find that
   repository in the table below.

Red means stop and look now. Amber means worth knowing today. Green means healthy. Nothing else
on the page uses those colours.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ HELLOGITTY  version   UTC clock  POLL AGE  CYCLE  API USED   REPOS     [cat] │  status line
├──────────────────────────────────────────────────────────────────────────────┤
│ [ WATCH CLAIMED ] [POLL FAIL] [DATA STALE] [WATCH CLOSED] [DORMANT] ...       │  caution and warning panel
├──────────────────────────────────────────────┬───────────────────────────────┤
│ REPOS                                         │ WATCH CHANNEL                 │
│  ● owner/name   counts …   last commit  ›     │ YOUR PRS                      │
│  ● owner/name   counts …   last commit  ›     │ POLL TELEMETRY                │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

On a phone the same parts stack in one column: header, panel, repositories, then the right-hand
panels.

---

## Status line (top)

| Item | Meaning | When to care |
|---|---|---|
| **HELLOGITTY** and version | The build you are running, e.g. `V0.1.0 · BLACK BOMBAY (baby)`. `DEV BUILD` means an untagged build. | Quote it when reporting a bug. |
| **UTC** | The current time in UTC, with seconds. | Every other time on the page is UTC too. |
| **POLL AGE** | How long ago HelloGitty last finished checking GitHub (hours:minutes:seconds). | Longer than the poll interval means a check is late; over two hours lights DATA STALE. |
| **CYCLE** | How long the last check of every repository took. | A sudden jump usually means GitHub was rate-limiting. |
| **API USED** | GitHub API calls used against your hourly budget, with a small gauge. | The gauge turns amber at 90%. |
| **REPOS** | How many repositories are tracked. | |
| **IN PIPELINE** | Only with a pipeline command configured: how many repositories it reports a stage for. | |

The kitten at the right end is the mascot (see [The mascot](#the-mascot)). It carries no data.

---

## Caution and warning panel

One cell per condition. Each cell has three looks:

- **Dark with a label:** the condition is not true. This is the normal state.
- **Dashed border:** the cell has nothing to watch yet (for example NONE WATCHED). This is not an
  all-clear; it means the channel is empty.
- **Solid colour:** the condition is true. The count is on the right, and the repositories
  involved are named underneath. If more are involved than fit, it shows `+N`; hover the cell for
  the full list.

| Cell | Colour when lit | Lights when | What to do |
|---|---|---|---|
| **WATCH CLAIMED** | red | An issue you are watching was assigned to someone, or someone commented in the last 30 days that they are taking it. | Don't start work on it. Check the issue, then pick something else or coordinate with that person. |
| **POLL FAIL** | red | A repository, or the search for your own pull requests, failed on the last check. | Open the repository's row to see the error. See [Troubleshooting](#troubleshooting). |
| **DATA STALE** | red | The last successful check finished more than two hours ago. | HelloGitty has probably stopped. Restart it. |
| **WATCH CLOSED** | amber | A watched issue was closed, either fixed by a merged pull request or commit, or closed without a fix. | Read how it was closed, then unwatch it (`hellogitty unwatch owner/name 123`). |
| **REPO DORMANT** | amber | A repository has had no commit for more than 90 days. | Work sent there may never be reviewed. |
| **REPO SLOW** | amber | No commit for more than 30 days. | Expect slower reviews. |
| **API LOW** | amber | Less than 10% of the hourly GitHub budget is left; shows how many calls remain. | Wait for the reset (time shown under Poll telemetry). |

With a pipeline command configured, two more cells appear (their names can be renamed by your
command): one for repositories your command marks as needing attention, one for a stage your
command reports as failed.

---

## Repositories table

One row per repository. Rows that your pipeline command reports are listed first, furthest stage
first; everything else follows alphabetically.

| Column | Meaning |
|---|---|
| **Light** (first column) | Health from the last commit. Green dot: active, a commit within 30 days. Amber ring: slow, 31 to 90 days. Amber dot: dormant, over 90 days. Dashed grey ring: unknown, never checked successfully. Read the column as a pattern: one amber light in a column of green is the thing to notice. |
| **Repo** | Owner (dim) and name. |
| **Stage strip** | Only with a pipeline command. One small square per stage: grey for done, white for the current stage, amber for a failed stage, dotted squares for a repository your command doesn't report. |
| **Status** | Only with a pipeline command. Your command's label for the repository (for example PASS), green or amber by the level it gives. |
| **OPEN** | Open issues (pull requests not counted). |
| **GFI** | Open issues labelled as good first issues (`good first issue`, `good-first-issue` or `good_first_issue`). |
| **UNASGN** | Open issues with nobody assigned. |
| **LAST COMMIT** | Days since the last commit, with a bar that fills over 120 days and turns amber after 30. |
| **WATCH** | How many of this repository's issues you are watching. |
| **DENIED** | Pull requests from outside contributors, among the latest 100 closed, that were closed without merging. Bots are not counted, and a pull request the maintainer says they merged by hand is not counted. |

Zeros are shown dim so the numbers that matter stand out.

### Open a row

Click a row (or press Enter on it) to expand it. Expanded rows stay open across the automatic
reload.

- **Repository:** a link to the project on GitHub, the stage and status if you use a pipeline,
  and the error from the last check if it failed.
- **Watched issues:** each with its current status.
- **Your PRs:** pull requests your GitHub account opened in this repository, with their state.
- **Denied outside PRs, last 5 of N:** the most recent pull requests from outside contributors that
  were closed without merging. Each shows the author's relationship to the project (`NONE` is a
  first-time contributor), the review verdict if there was one (`CHANGES_REQUESTED` in amber is
  the most telling), the close date, and the maintainer's last comment before closing.

Those closing comments are the most useful thing on the page before you start contributing to a
project: they tell you, in the maintainers' own words, what they turn down and why.

---

## Watch channel (right)

Every issue you are watching, across all repositories, most urgent first: claimed, then closed,
then still open.

| Status | Meaning |
|---|---|
| **CLAIMED** (red) | Assigned to someone, or a comment in the last 30 days such as "I'll take this", "I'm working on this", "taking this" or "I can do this". The link goes to the claiming comment when there is one. |
| **CLOSED_FIXED** (amber) | Closed by a merged pull request or a commit. |
| **CLOSED_WONT** (amber) | Closed without a linked fix. |
| **STILL_OPEN** (green) | Open and unclaimed. |

### Watching an issue

Watch an issue before you start work on it, so HelloGitty tells you if someone else takes it:

```bash
hellogitty watch owner/name 123          # watch issue 123 (several numbers allowed)
hellogitty watch                         # list what you are watching
hellogitty unwatch owner/name 123        # stop watching issue 123 (several numbers allowed)
```

To watch, the repository must be one you track; the new watch shows up after the next check.
An unwatched issue leaves the dashboard on its next reload, and unwatching also works for a
repository you no longer track. Unwatch an
issue once it is closed or no longer interesting, so WATCH CLOSED goes dark again.

---

## Your PRs

Counts of pull requests your GitHub account (the one the token belongs to) opened in tracked
repositories: **opened**, **open**, **merged**, **closed** (closed without merging) and **rate**,
which is merged ÷ (merged + closed). Open pull requests don't affect the rate.

**NO DATA** means you have not opened any yet. The panel stays on the page with zeros rather
than disappearing. **AWAITING PR SEARCH** appears right after starting, until the first check
finishes.

With a pipeline command, the panel is titled **PIPELINE** and also shows how many repositories
are at each stage.

---

## Poll telemetry (right)

| Row | Meaning |
|---|---|
| **Last poll** | When the last check of all repositories finished (UTC). |
| **Next poll** | When the next one starts. |
| **Interval** | Time between checks (60 minutes by default). |
| **Cycle time** | How long the last check took. |
| **Calls per cycle** | GitHub API calls the last check used. |
| **Quota resets** | When the hourly GitHub budget refills. |
| **Snapshot** | Link to `snapshot.json`, the same data in machine-readable form. |

---

## Changes since your last look

The page reloads itself every five minutes. A number that changed since the previous reload is
underlined and blinks twice, so after time away you can see what moved without remembering what
it was. With reduced motion turned on in your system settings, it is underlined without blinking.

---

## The mascot

The kitten at the top right is Black Bombay (baby), the mascot of the current release line. It
plays one short, silent clip each time the page reloads, a livelier one when something on the
page changed, and otherwise rests. It never loops, carries no data, and is hidden from screen
readers. With reduced motion turned on, you see a still image instead.

---

## Everyday use

**Morning check.** Glance at the panel. If WATCH CLAIMED or WATCH CLOSED is lit, deal with those
issues first. Then check for DORMANT or SLOW projects you were planning to work on.

**Choosing what to work on.** Look for repositories with a green light, a healthy GFI count and
many unassigned issues. Open the row and read the denied pull requests before choosing: if the
maintainers keep closing a kind of change, don't send that kind.

**Before you start an issue.** Watch it (`hellogitty watch owner/name 123`). If someone else
claims it while you work, WATCH CLAIMED lights.

**Tracking your own results.** The Your PRs panel keeps count; the rate tells you how often
your merged-or-closed pull requests were accepted.

---

## Troubleshooting

| You see | Likely cause | Fix |
|---|---|---|
| **DATA STALE** lit, POLL AGE climbing | HelloGitty stopped, or the computer slept. | Restart it. |
| **POLL FAIL** naming one repository, error `404` | The repository was renamed, moved or made private. | Update its entry in your config. |
| **POLL FAIL** naming every repository, error `401` | The GitHub token expired or was revoked. | Set a new `GITHUB_TOKEN` and restart. |
| Error mentioning a rate limit | GitHub's hourly or burst limit was hit. | HelloGitty waits and retries; it clears on the next check. |
| A repository with a very large issue list shows POLL FAIL saying exact totals are unavailable | Its issue list is longer than HelloGitty fetches page by page, and the search that gets exact totals failed. | It retries on the next check. Rather than show a partial number, the repository is marked failed. |
| **API USED** near the limit every hour | Many large repositories, or a short interval. | Track fewer repositories or set `"interval"` longer. |
| Numbers look different right after a restart | Counts that need a fresh check are filled in by the first check after starting. | Wait for the first check to finish (see Poll telemetry). |
| **AWAITING PR SEARCH** stays | The pull request search keeps failing; the error is shown in the panel. | Check the token. |
| The page is blank or won't load | HelloGitty is not running, or is on another address. | Start it; the address is the `listen` setting (default `localhost:7340`). |
