# HelloGitty

A local dashboard for the GitHub repositories you follow. It polls GitHub every hour and shows,
on one dark screen you can leave open all day: how active each project is, how many open and
good-first issues it has, whether someone just claimed an issue you were planning to take, and
what maintainers said when they closed outside pull requests.

It runs on your machine, serves the page on `localhost` only, and writes a `snapshot.json` that
scripts can read instead of calling GitHub themselves.

![HelloGitty dashboard tracking three public repositories](docs/screenshot.png)

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
| `pipeline_command` | | Optional. See [Pipeline stages](#pipeline-stages). |

Relative paths resolve against the folder the config file is in. Use `-config path/to/file.json`
to point at a config elsewhere. For a quick look with no file at all:

```bash
hellogitty -repos junegunn/fzf,BurntSushi/ripgrep
```

### GitHub token

Set `GITHUB_TOKEN` to a GitHub token. Read access to public repositories is all it needs: a
fine-grained token with no extra permissions, or a classic token with no scopes. HelloGitty only
ever reads.

```bash
export GITHUB_TOKEN=github_pat_...
```

Authenticated requests get 5,000 calls an hour. The first poll of a repository costs more because
it fetches review details for recently closed pull requests; after that those are cached. Measured
on real repositories: about 25 calls per repository on the first poll, and about 110 calls per
hourly cycle for 15 repositories after that. The dashboard shows calls used against the hourly
budget.

## Run

```bash
hellogitty
```

Then open <http://localhost:7340>. The first poll starts immediately and takes a few seconds per
repository.

| Command | Does |
|---|---|
| `hellogitty` | Poll on the interval and serve the dashboard. |
| `hellogitty -once` | Poll once, write the snapshot, exit. Exits non-zero if any repository failed. |
| `hellogitty watch owner/name 123 456` | Watch issues for claims and fixes. |
| `hellogitty watch` | List watched issues. |
| `hellogitty unwatch owner/name 123` | Stop watching issues. |
| `hellogitty -version` | Print the version and codename, e.g. `hellogitty v0.1.0 - Black Bombay (baby)`. |

On macOS, `start.sh` builds HelloGitty from a clone, starts it in the background if it is not
already running, and opens the dashboard. It takes the token from `GITHUB_TOKEN` or, failing
that, from `gh auth token`.

## Reading the dashboard

The full guide, covering every column, colour and cell, what to do when one lights up, and
troubleshooting, is in [docs/GUIDE.md](docs/GUIDE.md). The short version:

**Status line.** UTC time with seconds, time since the last poll, how long the last poll took,
and GitHub API calls used against the hourly budget.

**Caution and warning panel.** One cell per condition. A cell stays dark while all is well and
lights up, with a count and the repository names, when the condition is true:

| Cell | Lights when |
|---|---|
| WATCH CLAIMED | A watched issue was assigned, or someone commented that they are taking it. |
| POLL FAIL | A repository, or the pull request search, failed on the last poll. |
| DATA STALE | The last poll is more than two hours old. |
| WATCH CLOSED | A watched issue was closed, by a merged fix or otherwise. |
| REPO DORMANT | No commit in over 90 days. |
| REPO SLOW | No commit in over 30 days. |
| API LOW | Under 10% of the hourly API budget remains. |

With no issues watched, the two WATCH cells read NONE WATCHED rather than 0, because an empty
watch list is not the same as an all-clear.

**Repos.** One row per repository: a health light (green active, amber ring slow, amber dormant,
dashed unknown), open issues, good-first issues, unassigned issues, days since the last commit,
watched issues, and denied pull requests. Click a row to see its watched issues, your own pull
requests there, and the last five pull requests from outside contributors that were closed
without merging, each with the maintainer's last comment before closing and the review verdict.
Those closing comments are the quickest way to learn what a project does not accept.

**Watch channel.** Every watched issue, claimed ones first. An issue counts as claimed when it
has an assignee, or when a comment from the last 30 days says something like "I'll take this",
"I'm working on this" or "I can do this". An issue closed by a merged pull request or commit
counts as fixed.

**Your PRs.** Pull requests the token's account opened in the tracked repositories: opened, open,
merged, closed, and merge rate, which is merged ÷ (merged + closed). It reads NO DATA until you
have opened one.

**Poll telemetry.** Last and next poll, interval, cycle time, calls per cycle, and when the
API budget resets.

The page reloads itself every five minutes. A value that changed since the previous reload is
underlined once; otherwise only the clock moves.

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
  }
}
```

```json
{ "repos": ["junegunn/fzf"], "pipeline_command": ["./my-stages", "--json"] }
```

The dashboard then adds a phase strip and a status column to each row, a count of repositories
per stage, and two more cells: one for repositories whose `level` is `caution`, one for a stage
listed in `failed`. `labels` renames those to your own words. `notes`, when given, is a local text
file served read-only at `/notes/owner/name`; no other file can be reached. Stages can be given as
names or as `{"name": ..., "abbr": ...}`. The command runs from the config folder with a 15 second
timeout, at most once a minute. Without `pipeline_command` none of this appears.

## Local only

The dashboard binds to a loopback address and refuses anything else. The only network traffic is
calls to the GitHub API.

## Versioning

Releases carry a semantic version and a codename: a coat colour and a cat breed. The current line
is **Black Bombay (baby)**, the `0.x` releases; it grows up at `v1.0.0`. Later codenames start as
prereleases of their own major version, and `go install ...@latest` skips prereleases, so `@latest`
always gives you the newest stable build. See [VERSIONING.md](VERSIONING.md) and
[CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
