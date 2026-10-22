# HelloGitty

A local dashboard for your open source work. On one screen you can leave open all day it shows
every pull request and issue you have out on GitHub, sorted by whose move it is, with the latest
comment from the other side; what is waiting on you in repositories you maintain; and, for the
projects you follow, how active each one is, how many open and good-first issues it has, whether
someone just claimed an issue you were planning to take, and what maintainers said when they
closed outside pull requests.

It runs on your machine, serves the page on `localhost` only, and writes a `snapshot.json` that
scripts can read instead of calling GitHub themselves.

![HelloGitty dashboard: the Your work board, alerts and checks, tracking three public repositories](docs/screenshot.png)

## Quick start

Five minutes from nothing to a running dashboard. Each step links to the full details below.

**1. Install** (needs Go 1.26 or newer). The binary lands in `$(go env GOPATH)/bin`, so make sure
that folder is on your `PATH`.

```bash
go install github.com/FawwazLawal/hellogitty/cmd/hellogitty@latest
```

**2. Give it a GitHub token.** Read-only is enough. If you use the GitHub CLI, reuse its login:

```bash
export GITHUB_TOKEN=$(gh auth token)
```

Otherwise create a fine-grained token with no extra permissions and export that instead
([details](#github-token)).

**3. List the projects you follow.** In a folder of your choice, create `hellogitty.json`:

```json
{ "repos": ["junegunn/fzf", "BurntSushi/ripgrep"] }
```

Add `"maintain": ["your-org"]` if you maintain repositories you don't own
([all settings](#configure)).

**4. Run it** and open <http://localhost:7340>.

```bash
hellogitty
```

Your work fills in within a few seconds; each followed project takes a few seconds more.

**5. First things to do on the dashboard:**

- Read **Your move** at the top of Your work: pull requests and issues waiting on you, longest
  waiting first, each with the latest comment so you know what's being asked.
- Glance at the row of alert cells under the header. If nothing is lit, nothing needs you.
- Open a row in **Tracked repositories** and read the last pull requests the project turned down
  before you contribute there.
- Before starting on an issue, watch it so you hear if someone else claims it:
  `hellogitty watch owner/name 123`.
- Try the toolbar: press `/` to search, or group your work by organization.
- Open **Layout** in the header to pick a preset (Focus is a one-column "just Your move" view) or
  arrange the panels yourself.

Hover any word with a dotted underline, or a row's title, for more about it.

Leave the page open; it reloads itself every five minutes. Press **?** (or click **Help** in the
header) for the user guide, a glossary of every term on the page, keyboard shortcuts, answers to
common questions and the details of your install. The same guide is in
[docs/GUIDE.md](docs/GUIDE.md).

## Install

HelloGitty needs Go 1.26 or newer.

```bash
go install github.com/FawwazLawal/hellogitty/cmd/hellogitty@latest
```

Or clone and build:

```bash
git clone https://github.com/FawwazLawal/hellogitty.git
cd hellogitty
go build ./cmd/hellogitty
```

## Configure

Create `hellogitty.json` in the folder you run it from (copy `hellogitty.example.json`):

```json
{
  "repos": ["junegunn/fzf", "BurntSushi/ripgrep", "charmbracelet/bubbletea"],
  "listen": "localhost:7340",
  "interval": "60m"
}
```

| Key | Default | Meaning |
|---|---|---|
| `repos` | | Repositories as `owner/name` or GitHub URLs. |
| `repos_file` | | A JSON file listing more repositories, re-read on every poll, so editing it changes what is tracked without a restart. It may be `["owner/name", ...]` or `{"repos": [...]}` with strings or objects carrying a `repo`, `url` or `upstream` field. |
| `listen` | `localhost:7340` | Dashboard address. Loopback only; any other address is refused. |
| `interval` | `60m` | How often to poll. One minute at least. |
| `database` | `hellogitty.db` | SQLite file for polled data. |
| `snapshot` | `snapshot.json` | Where the machine-readable snapshot is written. |
| `maintain` | | Repositories (`"owner/name"`) or organisations (`"org"`) you maintain but don't own. Their pull requests and issues from others show under Your repositories. Repositories your account owns are always included. |
| `inbox` | | Optional. A JSON file rewritten after every refresh with recent events on your own open pull requests (new comments, reviews, inline comments, merged or closed, changes requested, CI failing, merge conflicts), on watched issues someone claimed or closed, and on issues where someone else may be doing the work you planned. See [inbox file](#inbox-file). |
| `pipeline_command` | | Optional. See [Pipeline stages](#pipeline-stages). |

Relative paths resolve against the folder the config file is in. Use `-config path/to/file.json`
to point at a config elsewhere. For a quick look with no file at all:

```bash
hellogitty -repos junegunn/fzf,BurntSushi/ripgrep
```

### GitHub token

Set `GITHUB_TOKEN` to a GitHub token. Read access to public repositories is all it needs: a
fine-grained token with no extra permissions, or a classic token with no scopes. HelloGitty reads;
its one write is marking a GitHub notification read when you acknowledge it in the live feed. Your work and Your repositories cover what the token can see, so include private
repositories in the token's access if you want them there too.

```bash
export GITHUB_TOKEN=github_pat_...
```

Authenticated requests get 5,000 calls an hour. The first poll of a repository costs more because
it fetches review details for recently closed pull requests; after that those are cached. Measured
on real repositories: about 25 calls per repository on the first poll, and about 110 calls per
hourly cycle for 15 repositories after that, plus one call per repository each check for its newest
open pull requests. The dashboard shows calls used against the hourly
budget. Your work is one GraphQL request every 5 minutes, which counts against GitHub's separate
GraphQL budget, not this one. The new-activity dots read your GitHub notifications about once a
minute; an unchanged inbox answers "not modified", which costs nothing. Notifications need a
classic token with the `notifications` (or `repo`) scope; with a fine-grained
token the dashboard works without the dots.

## Run

```bash
hellogitty
```

Then open <http://localhost:7340>. The first poll starts immediately and takes a few seconds per
repository.

| Command | Does |
|---|---|
| `hellogitty` | Poll on the interval and serve the dashboard. |
| `hellogitty -once` | Poll once, write the snapshot (and the inbox, if set), exit. Exits non-zero if any repository failed. |
| `hellogitty watch owner/name 123 456` | Watch issues for claims and fixes. |
| `hellogitty watch` | List watched issues. |
| `hellogitty unwatch owner/name 123` | Stop watching issues. |
| `hellogitty -version` | Print the version and codename, e.g. `hellogitty v0.1.0 - Black Bombay (baby)`. |

On macOS, `start.sh` builds HelloGitty from a clone, starts it in the background if it is not
already running, and opens the dashboard. It takes the token from `GITHUB_TOKEN` or, failing
that, from `gh auth token`.

## Reading the dashboard

The full guide, covering every panel, status and colour, what to do when something lights up, and
troubleshooting, is in [docs/GUIDE.md](docs/GUIDE.md). The short version:

**Alerts.** A row of cells under the header. Each stays dark while all is well and lights up, with
a count and names, when its condition is true: a watched issue claimed (red), **your move**
(amber, anything waiting on you), a failed check, stale data, a watched issue closed, a dormant or
slowing repository, the API running low. An empty watch list reads "nothing watched", never a
reassuring 0.

**Your work.** Every pull request and issue your account has out, anywhere on GitHub, refreshed
every 5 minutes and sorted by whose move it is: **Your move** (changes requested, a maintainer
replied, checks failing, a merge conflict), **Waiting on others** (no review yet, review
requested, approved and waiting to merge, you replied last) and **Finished** in the last 30 days.
Each row says what happened last in a sentence and quotes the latest comment from someone else.

**Your repositories.** Open pull requests and issues from other people in repositories you own or
list under `maintain`, plus reviews requested from you: what needs you and what waits on a
contributor.

**Tracked repositories.** One row per repository you follow: a health light (green active, amber
ring slowing, amber dormant, dashed not checked), open, good-first and unassigned issues, days
since the last commit, watched issues, and pull requests turned down from outside contributors.
Click a row for the last five of those with the maintainer's closing comment: the quickest way to
learn what a project does not accept.

**Watched issues, merge rate and checks** fill the right-hand column.

The page follows your system's light or dark setting; the Auto / Light / Dark switch in the header
overrides it. It reloads itself every five minutes, and a value that changed since the previous
reload is underlined once.

## snapshot.json

After every poll HelloGitty writes `snapshot.json` (also served at `/snapshot.json`):

```json
{
  "generated_at": "2026-10-19T08:02:30Z",
  "poll_interval_minutes": 60,
  "repos": [
    {
      "owner": "junegunn",
      "name": "fzf",
      "health": "ACTIVE",
      "last_commit": "2026-10-17T09:23:00Z",
      "open_issues_total": 271,
      "open_issues_gfi": 0,
      "open_issues_unassigned": 268,
      "watch_list": [
        {"number": 1234, "title": "...", "status": "STILL_OPEN", "last_checked": "2026-10-19T08:02:30Z"}
      ],
      "denied_prs_sample": [
        {"number": 4321, "title": "...", "author_association": "NONE",
         "closing_comment": "...", "closed_at": "2026-10-10T11:00:00Z"}
      ]
    }
  ]
}
```

`health` is `ACTIVE`, `SLOW`, `DORMANT` or `UNKNOWN` (never polled successfully). Watch `status` is
`STILL_OPEN`, `CLAIMED`, `CLOSED_FIXED` or `CLOSED_WONT`. `denied_prs_sample` holds up to ten
recent pull requests from outside contributors that were closed without merging; bots are left
out. The file is replaced atomically, so a reader never sees half of it.

## Inbox file

Set `"inbox": "path/to/inbox.json"` and HelloGitty rewrites that file every 5 minutes, and after
each check, with what currently needs a look on your own pull requests and watched issues, so a
script can act on it without calling GitHub:

```json
{
  "generated_at": "2026-10-20T12:22:00Z",
  "poll_interval_minutes": 5,
  "entries": [
    {
      "id": "hg-octo-tool-42-review-1761234567",
      "kind": "pr_review",
      "repo": "octo/tool",
      "number": 42,
      "url": "https://github.com/octo/tool/pull/42#pullrequestreview-1761234567",
      "actor": "maintainer",
      "occurred_at": "2026-10-20T07:40:01Z",
      "summary": "CHANGES_REQUESTED, 2 unresolved inline comments: Use the existing constant"
    }
  ]
}
```

`kind` is `pr_comment`, `pr_review`, `pr_state`, `pr_label`, `pr_bot`, `new_issue`, `issue_comment` (a reply that made an
issue your move), `watched_issue`, `issue_overlap` or `issue_similar`
(see [someone else's work](#someone-elses-work)). A pull request of yours closed without merging is a `pr_state` entry that names who closed it and
quotes what they said, or says "with no comment" when they said nothing. `pr_label` is one entry
per label added to a pull request of yours, unless the label is known to be harmless (size and area
tags, `community`, `documentation`, `docs`, `enhancement`, `bug`, `feature`, `dependencies`,
`tests`). A label HelloGitty has never seen is reported, not ignored. Both carry `"priority":
"high"`; other entries have no `priority`. `new_issue` is one entry per repository where you are planning work (one with an issue on your
watch list or the pipeline's): how many unassigned, unclaimed issues it opened in the last day,
naming the newest few. It is replaced when a newer one arrives and goes when there are none. The
live feed on the dashboard lists every new issue. `pr_bot` is one entry per pull request of yours
for what bots still ask to be fixed: an unresolved review comment from a bot on current code, a
bot's standing "changes requested", or a review saying "Actionable comments posted: N" with no
commit since. Bot summaries, coverage reports and approvals never count. The entry is replaced
when the bot reviews again, and disappears when nothing is left open. The file is replaced whole on
each write (a temporary file, then a rename), so a reader never sees half of one. Entries stay
while they are current; to tell new ones from ones you've handled, keep the `id`s you've seen. An
`id` is built from GitHub's own ids and never changes for the same event. `occurred_at` is GitHub's
time for the event; for a merge conflict, which GitHub doesn't timestamp, it's when HelloGitty first
saw it. Everything comes from data HelloGitty already fetches, so the file costs no extra API calls.

## Someone else's work

Before you start on an issue, and while your pull request for it is open, HelloGitty checks every
15 minutes whether someone else got there first. It watches the issues on your watch list, the
issues your open pull requests fix, and any listed under `watch` in the
[pipeline output](#pipeline-stages), and reports into the inbox file when:

- another pull request cites the issue (links it, mentions `#123` in its title or body, or puts
  `[123]` at the start of its title), or one citing it was merged;
- the issue gains an assignee other than you;
- somebody claims it in a comment in the last 30 days ("I'll take this", "working on it", "can I
  work on this?");
- the issue closes, unless your own pull request closed it;
- another open pull request from the last 90 days has a title on the same subject. This is
  `issue_similar` and only says what to look at: "Worth a look: #8600 shares the title words
  response, compression". A pull request that cited the issue and was closed without merging is
  reported the same way.

It is built to stay quiet, because a watcher that reports everything gets ignored:

- **One report per issue.** The first sign of someone else's work is reported (`issue_overlap`) and
  nothing more is said about that issue. Before that, at most one `issue_similar`. Each issue has
  one entry in the file at a time; it replaces the issue's `watched_issue` entry.
- **Never the same pull request twice** against the same issue, even if it goes from a similar
  title to citing the issue.
- **Reports are recorded** in the database, so a restart repeats nothing, and an entry keeps its
  `id`, time and wording.
- **The entry goes when the issue stops being watched**: you unwatch it, your pull request
  closes, or it leaves the `watch` list.
- **Same subject means real overlap.** Title words are compared after dropping tags and scopes
  (`[Feature]`, `fix(ui):`, `cmd/go:`) and common words. Another title must share two of them, or
  half when the issue's title has more than four. Your own pull requests and bots never count,
  nor do mentions from repositories outside the issue's organisation.

A check of about 50 issues costs about 6 points of GitHub's 5,000-point GraphQL hour.

## Pipeline stages

If you track your own work on these repositories somewhere else, HelloGitty can show where each
one stands. Set `pipeline_command` to a program that prints JSON like this:

```json
{
  "stages": ["triage", "build", "review"],
  "labels": {"status": "CHECK", "flagged": "REPO FLAGGED", "failed": "STAGE FAILED", "notes": "NOTES"},
  "repos": {
    "junegunn/fzf": {"stage": "build", "done": ["triage"], "label": "OK", "level": "ok",
                     "notes": "/home/me/notes/fzf.md"}
  },
  "watch": [{"repo": "junegunn/fzf", "number": 4012, "title": "Preview window flickers"}],
  "glossary": {"OK": "Ready to contribute."}
}
```

```json
{ "repos": ["junegunn/fzf"], "pipeline_command": ["./my-stages", "--json"] }
```

The dashboard then adds a phase strip and a status column to each row, a count of repositories
per stage, and two more cells: one for repositories whose `level` is `caution`, one for a stage
listed in `failed`. `labels` renames those to your own words. `notes`, when given, is a local text
file served read-only at `/notes/owner/name`; no other file can be reached. Stages can be given as
names or as `{"name": ..., "abbr": ...}`. `glossary`, optional, maps your
command's own words (stage codes, verdicts) to a sentence the page shows when you hover them.
`watch`, optional, lists issues you plan to work on;
the command runs again before each check, so the list follows whatever your program reads it from
(see [someone else's work](#someone-elses-work)). The command runs from the config folder with a 15 second
timeout, at most once a minute. Without `pipeline_command` none of this appears.

## Local only

The dashboard binds to a loopback address and refuses anything else. The only network traffic is
calls to the GitHub API.

## Versioning

Every publish is a release with downloadable builds. A release reads as its version and, in
brackets, how many updates it has had since that version began: "v0.2.0 (3)" is tag `v0.2.3`.
Releases carry a semantic version and a codename: a coat colour and a cat breed. The current line
is **Black Bombay (baby)**, the `0.x` releases; it grows up at `v1.0.0`. Later codenames start as
prereleases of their own major version, and `go install ...@latest` skips prereleases, so `@latest`
always gives you the newest stable build. See [VERSIONING.md](VERSIONING.md) and
[CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
