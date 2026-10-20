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

Leave the page open; it reloads itself every five minutes. [docs/GUIDE.md](docs/GUIDE.md) explains
every panel, status and colour.

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
| `pipeline_command` | | Optional. See [Pipeline stages](#pipeline-stages). |

Relative paths resolve against the folder the config file is in. Use `-config path/to/file.json`
to point at a config elsewhere. For a quick look with no file at all:

```bash
hellogitty -repos junegunn/fzf,BurntSushi/ripgrep
```

### GitHub token

Set `GITHUB_TOKEN` to a GitHub token. Read access to public repositories is all it needs: a
fine-grained token with no extra permissions, or a classic token with no scopes. HelloGitty only
ever reads. Your work and Your repositories cover what the token can see, so include private
repositories in the token's access if you want them there too.

```bash
export GITHUB_TOKEN=github_pat_...
```

Authenticated requests get 5,000 calls an hour. The first poll of a repository costs more because
it fetches review details for recently closed pull requests; after that those are cached. Measured
on real repositories: about 25 calls per repository on the first poll, and about 110 calls per
hourly cycle for 15 repositories after that. The dashboard shows calls used against the hourly
budget. Your work is one GraphQL request every 5 minutes, which counts against GitHub's separate
GraphQL budget, not this one.

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
