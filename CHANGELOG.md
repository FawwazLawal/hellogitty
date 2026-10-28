# Changelog

Newest first. Each milestone has a semantic version and a codename; see
[VERSIONING.md](VERSIONING.md).

## Unreleased

## v0.2.0 (16) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.16`.

- **Extension layout support (ADR-002 step 3)**: the extension popup defaults to
  the Focus layout preset; the full-tab view honours saved layouts from
  localStorage, matching the main dashboard.
- **Test fixes**: updated dashboard tests for the new sortable column headers and
  renamed "Turned down" column.
- **Extension visual parity**: synced extension CSS, header grid, and pink theme
  support with the latest dashboard (monitor/extension, non-git).

## v0.2.0 (15) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.15`.

- **Pink collaboration theme (pinky v1)**: Settings panel gains a Visual Theme
  gallery under Appearance. Selecting "Pinky v1" applies a pink colour overlay
  that works in both light and dark modes and swaps the codename marker from
  "(baby)" to "(pinky v1)". Limited-run easter egg, available for ~5-10 cycles.
- **OSS Monitor desktop app rebuilt**: the .app now points at hellogitty-clone's
  start.sh directly, so double-clicking always serves the latest dev build.

## v0.2.0 (14) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.14`.

- **Finder-style sortable columns**: Your Work gets Name and Updated sort
  buttons with toggleable asc/desc arrows. Tracked Repos column headers
  (Repository, Open, Good first, Unassigned, Last commit, Turned down) are
  clickable sort toggles that replace the old Sort dropdown.
- **start.sh always rebuilds**: the launch script now runs `go build` on every
  invocation and restarts only when the binary actually changed, so
  double-clicking OSS Monitor always serves the latest code.

## v0.2.0 (13) · Black Bombay (baby) · 2026-10-27

Tag `v0.2.13`.

- **Layout config default**: the `layout` key in hellogitty.json sets the starting
  dashboard layout for browsers that have not saved one. Accepts a preset name
  (`{"preset": "contributor"}`) or an explicit module list. A browser's own saved
  layout always takes priority.
- **Copy layout button**: the Layout dialog gains a "Copy layout" button that
  copies the current layout state as JSON, ready to paste into hellogitty.json.
  ADR-002 modular dashboard step 2.
- **Friendly error messages**: all user-facing error displays now show a
  plain-language explanation with a resolution tip, with the raw error code in
  parentheses. Covers GitHub API errors (502/503/504, timeouts, rate limits,
  auth failures), pipeline command failures, and security feed errors.

## v0.2.0 (12) · Black Bombay (baby) · 2026-10-27

Tag `v0.2.12`.

- **Issues search across all pages**: typing in the Issues search bar now queries
  the full dataset via debounced AJAX, not just the current page's rows. The
  `/issues` endpoint returns JSON when asked with `Accept: application/json`.
- **Track comment replies**: poll for new comments on issues where we posted a
  comment and surface them as `issue_comment_reply` inbox entries, priority high
  when the commenter is a maintainer or owner.
- **Track PR cross-references**: detect when PRs in watched repos reference our
  open PRs and surface them as `pr_cross_reference` inbox entries via timeline
  events.
- **Composition audit**: unified site-header template shared across Dashboard,
  Help, and Feed pages; standardised content widths with CSS tokens; fixed panel
  header z-index stacking over the site header in Layout mode.

## v0.2.0 (11) · Black Bombay (baby) · 2026-10-26

Tag `v0.2.11`.

- **Unified header**: redesigned header with CSS grid layout — brand left, clock center,
  controls right — consistent across all pages. Dashboard-specific controls (Collapse,
  Layout) now sit alongside common header buttons with matching icon styling.
- **Settings sidebar navigation**: macOS System Settings-style sidebar with categorised
  sections (Preferences, Data, System), content panes, and localStorage/hash persistence.
- **Repositories settings**: add/remove tracked repos directly from the Settings page,
  view removed repos with re-add option, and display the maintain list from config.
- **Two new clock styles**: LED (bright wall-clock glow) and Flip (retro split-flap).
- **World clock management in Settings**: add and remove world clocks from the Clock
  settings pane instead of the header dropdown, keeping the header clean.

## v0.2.0 (10) · Black Bombay (baby) · 2026-10-26

Tag `v0.2.10`.

- **Dashboard cockpit**: prominent date/time clock centered in the header, collapsible
  panels, filter pills with clear-all, grid/list view toggle, and a DevSecOps security
  panel showing recent CVEs and workflow tips.
- **Multi-timezone clocks**: add world clocks from a searchable timezone picker; clocks
  persist in localStorage and display city names with UTC offsets.
- **Clock settings and 12 creative themes**: adjustable time format (12h/24h), seconds
  toggle, date toggle, and 12 visual clock styles — Neon, Ember, Matrix, Arctic, Sunset,
  Midnight, Terminal, Golden, Rosé, Ocean, Mono, Nixie — selectable from a swatch grid
  on the Settings page.
- **Settings page** (`/settings`): dashboard preferences and server configuration on a
  dedicated page — appearance (theme, layout preset, compact cells), clock customisation,
  world clocks, and read-only server config.
- **Security headers**: dashboard responses include `X-Content-Type-Options`,
  `X-Frame-Options`, and `Content-Security-Policy` headers.
- **Privacy policy**: `PRIVACY.md` covering dashboard, Chrome extension, and OAuth exchange
  server data flows.
- **Telemetry relocated**: API rate, cycle stats, and poll timing moved from the header bar
  to the page footer for a cleaner layout.
- Fixed: filter pill text invisible in dark mode.
- Fixed: timezone picker dropdown overflowing the page.

## v0.2.0 (9) · Black Bombay (baby) · 2026-10-23

Tag `v0.2.9`.

- **Clickable overview cards**: on Conversations, the "Needs your reply" and "Waiting on
  others" cards activate the matching filter. On Your work, all four cards ("Your move",
  "Waiting", "Finished", "Dismissed") do the same, and empty sections hide when their items
  are filtered out. On Your repositories, "Open PRs" and "Merged" link to their pipeline
  list pages.
- **Sort toggle on list pages**: Conversations, Your work and Your repositories each have a
  "Newest / Oldest" button that reverses every list section by date.
- **Typography tightened**: fractional font sizes (11.5, 12.5, 13.5 px) consolidated to four
  steps (12, 13, 14, 19 px). Uppercase labels get tracked letter-spacing. Panel and section
  headings drop from 15 px to 14 px with 0.02 em spacing.
- **Light-theme colour tokens**: `--caution-fill`, `--caution-ink`, `--warn-fill`, `--warn-ink`
  and `--mascot-bg` now have proper light-mode values; alert cells no longer fall back to
  dark-mode fills.
- **Interactive polish**: table rows highlight on hover (Issues, List, Pipeline). Status badges,
  alert cells and theme buttons transition smoothly. Empty alert cells get a dimmed border.
  Linked cells use a raised background on hover instead of a brightness filter.
- **Empty and no-data states**: `.nodata` is italic with more padding; `.empty` is consistent
  across pages.

## v0.2.0 (8) · Black Bombay (baby) · 2026-10-23

Tag `v0.2.8`.

- **Work dismiss**: entries can be silently dismissed from the "Your work" panel on the
  dashboard, removing merged PRs and other resolved items from view without losing them.
  Uses the same ack/unack store as cell clearing, with a `d:` key prefix.
- **Your work page** (`/work`): a dedicated full page that organises all work items by
  status — Your move, Waiting on others, Finished and Dismissed — with filter buttons,
  search, overview cards and one-click restore for dismissed items.
- **Persistent header on all sub-pages**: the status bar and quicknav navigation now
  appear on the Issues page, List page and all five alert detail pages, not only on pages
  routed through `serveSubPage`.
- Fixed: the Issues page (`/issues`) rendered blank because `serveIssues` passed a custom
  `issuesPage` struct that lacked the fields the shared `site-header` template requires;
  it now uses `build()` and the full `page` struct.
- Fixed: the List page (`/list`) had the same blank-render risk with its `listPage`
  struct; rewritten to populate the shared `page` struct directly.

## v0.2.0 (7) · Black Bombay (baby) · 2026-10-23

Tag `v0.2.7`.

- **Quick-access navigation bar**: a persistent shortcuts bar across the top links to
  Dashboard, Issues, Tracked repos, Pipeline, Conversations and Your repositories.
  Each opens a dedicated full page with interactive features.
- **Sub-pages**: Tracked repos, Pipeline, Conversations and Your repositories are now
  full pages with search, filters, sorting, overview cards and detailed listings.
  Tracked repos shows a card grid with health lights and tags; Pipeline shows stage
  counts, merge rate and a filterable PR table; Conversations lists threads you joined
  with needs-me/waiting filters; Your repositories shows your open work, recently
  finished items and repository activity.
- **Server-side issue search**: the Issues page search now queries the database across
  all pages, not just the current page. Searching for an issue number or title that
  appears on any page returns it regardless of which page you are viewing.
- **Clickable indicators**: issue counts (Open, GFI, Unassigned, Denied) on tracked
  repositories link directly to the corresponding GitHub issue or PR query.
- **Header redesign**: gradient panel headers replaced with solid backgrounds and a
  left accent border for clearer visual hierarchy; the accent colour is reserved for
  meaning rather than decoration.
- Fixed: the panel resize handle now stays at the panel's bottom edge when the panel
  is taller than its content, instead of floating right after the last row.
- Bot findings carried in a review body (outside the diff range) are now counted
  alongside thread-based findings in the `pr_bot` inbox entry. A bot that posts
  file-specific feedback under `<details><summary>` blocks in the review body, rather
  than as inline threads, now surfaces in the entry's count and summary.

## v0.2.0 (6) · Black Bombay (baby) · 2026-10-23

Tag `v0.2.6`.

- Tracked repositories has its own search box, and a pin on each row keeps a repository at the top
  whatever the sort.
- Fixed: scrolling the page no longer gets caught in a panel that scrolls inside (a shortened
  panel, the live feed). A scroll already moving the page keeps moving it, and a panel scrolled to
  its end carries on down the page.
- Panels can be collapsed with an arrow in their heading, moved by dragging their grip (or with
  the arrow keys), and resized by dragging their bottom edge; a shortened panel scrolls inside with
  its heading and column headers in view. All of it is saved with your layout.
- GitHub notification rows have a Clear button: the row leaves until that thread has new activity,
  and it is marked read on GitHub if it wasn't.
- Seen: a claimed or closed watched issue has a Seen button that quiets its badge and its alert
  until something changes again.
- Claims are spotted more carefully: your own comments, bots, quoted lines and questions to someone
  else ("Are you still working on this?") no longer mark an issue claimed, and more ways of taking
  an issue are recognised ("Can I work on this?", "Please assign me").
- Help has a "Use with an AI assistant" section: a prompt to paste into Claude Code, Copilot,
  Cursor or another assistant so it can keep HelloGitty up to date for you. Code blocks in Help have
  Copy buttons.
- `hellogitty track owner/name` and `hellogitty untrack owner/name` follow and unfollow repositories
  from a terminal.
- Watch any issue with the eye. Every issue on the dashboard (Your work, Conversations, the live
  feed, a repository's Issues tab) has an eye: click it to watch, and a filled eye to stop. It
  works for issues in repositories you don't track too, and you hear if someone claims the issue or
  it closes.
- **Recent issues** panel on the dashboard: the 30 most recently updated open issues across every
  tracked repository, with labels, claim status and the eye toggle. "Show all" opens the full issues
  page.
- The issues page now shows the last 90 days of open issues, 100 per page, with Previous / Next
  pagination. Search still filters the current page.

## v0.2.0 (5) · Black Bombay (baby) · 2026-10-22

Tag `v0.2.5`.

- Each section heading sits on a strip that fades from black on the left to a warm amber on the
  right, so Your work, Your repositories, Tracked repositories and the side panels are easy to tell
  apart at a glance.
- "N new" badges beside Your work, Your repositories and Tracked repositories, and on each tracked
  repository with unacknowledged items, whose name also turns bold. They count down as you
  acknowledge things anywhere on the page.
- A tracked repository opens on four tabs: Issues (newest, new ones marked), Pull requests (newest
  open and latest merged or closed), Activity (its live-feed lines) and Lessons (what it turned down,
  and why). Opening Issues counts as reading its new issues.
- Your pull requests that GitHub's search misses now count in the merge rate and show under a
  repository's "Your pull requests here".
- Conversations: issues and pull requests you joined but didn't open have their own panel, so
  Your work lists only what you opened or were assigned. Threads that ask something of you still
  count in Your move.
- Notifications about your own repositories (a failed workflow run, a release) show under Your
  repositories instead of Your work's Other notifications.
- The Pipeline panel's numbers open what they count on a page of their own: your open, merged or
  closed pull requests, or the repositories at a stage.
- A Custom layout preset keeps your own arrangement; trying another preset no longer loses it.
- Add and remove tracked repositories from the dashboard: type `owner/name` or paste a GitHub link
  into **Add a repo** in Tracked repositories, or open a repository and click **Stop tracking**. Both ask you to confirm first.
  HelloGitty checks the repository exists and checks it straight away. Your config file is never
  rewritten; a config repository you remove shows under the panel with **Track again**.
- Help search understands questions as you'd ask them ("how to add a repo"): small words are
  ignored, plurals and common other words match, and it lists the best answers first with the
  matching words marked. Enter or a click jumps to the exact paragraph.
- Check failed says why. Hovering the alert gives each failure in plain words and when it's tried
  again, and the repository's row carries a red "check failed" tag. A GitHub answer that times out
  halfway through is now retried, like a failed connection, instead of failing that repository's
  whole check.
- Alerts can be cleared. A lit alert that names what lit it has a **Clear** button; it stays dark
  until something new lights it, and **Show** brings it back. Data is stale and API running low
  can't be cleared.

## v0.2.0 (4) · Black Bombay (baby) · 2026-10-21

Tag `v0.2.4`.

- A live activity feed at the top of the right-hand column: new issues in tracked repositories,
  comments, reviews and state changes on your work, someone else's work on issues you plan to take,
  repositories going quiet, and GitHub notifications, newest first. Click a line to jump to it on
  the dashboard. **Ack** marks it seen; when a GitHub notification is behind it, that is marked read
  on GitHub too, and reading it on GitHub settles the line. `/feed` shows it on a page of its own.
  This is HelloGitty's first write to GitHub, made only when you press Ack.
- The inbox file has a new kind, `new_issue`: one entry per repository where you plan work, listing
  its new unassigned issues from the last day.
- Help: press ? or click Help in the header for the user guide, a searchable glossary of every
  term on the page, keyboard shortcuts, common questions, privacy notes, troubleshooting, and the
  details of your install (version, files in use, whether notifications can be read, where to
  report a problem). The guide is compiled in, so it always matches the version you run.
- The version shows under the HelloGitty name. A release reads "v0.2.0 (4) · Black Bombay (baby)":
  its version and, in brackets, how many updates it has had since that version began. A build from
  source between releases reads "dev build · after v0.2.0 (3)". See [VERSIONING.md](VERSIONING.md).
- Every publish is now a release, with a page and downloadable builds for macOS, Linux and Windows.
- The screenshot in the README and the guide shows the current dashboard.

## v0.2.0 (3) · Black Bombay (baby) · 2026-10-21

Tag `v0.2.3`.

- Layouts: a Layout button opens a sheet to show, hide, fold and reorder panels and move them
  between the main and side columns, with five presets (Everything, Contributor, Maintainer,
  Program, Focus). Saved in the browser.
- The inbox file now says who closed your pull request without merging and what they said, or
  "with no comment", and reports labels added to your pull requests (new kind `pr_label`) unless
  they are known to be harmless. Both carry a new `"priority": "high"` field.

## v0.2.0 (2) · Black Bombay (baby) · 2026-10-21

Tag `v0.2.2`.

- Your move is quieter. Comments from machines (bots, automation accounts such as gopherbot, and
  comments that open with a hidden `<!-- -->` marker, like policy checks posted from a
  maintainer's account) no longer count as someone replying. On an issue you only joined, a later
  comment is your move only when it mentions you; otherwise the row waits on others and says
  "nothing asked of you".
- Each Your work row ends with a pale yellow pill naming its repository and number.
- New-activity dots from your GitHub notifications: green for something you haven't read, amber
  once read if it's your move, hollow once read with nothing asked. They follow GitHub's read state
  within a minute. Threads that match no row, such as a CI run on a branch without an open pull
  request, show under Other notifications. HelloGitty only reads notifications; it never marks
  them read.
- Hover help: words with a dotted underline explain themselves on hover, keyboard focus or a
  tap, and hovering a row's title or a repository's name shows a peek with checks, reviews, recent
  comments, the branch and more. Everything comes from data already on hand. A pipeline command
  can explain its own words with a new `glossary` field.
- The inbox file has a new kind, `pr_bot`: what bots still ask to be fixed on your open pull
  requests, one entry per pull request. It is replaced when the bot reviews again and goes once
  the findings are resolved. A bot's inline comments no longer appear one by one.
- Pull requests that GitHub's search misses (a brand-new one, or one search leaves out) now get
  their own row, found through your notifications.
- The inbox file has a new kind, `issue_comment`: a reply that made an issue your move. It goes
  when you answer.

## v0.2.0 (1) · Black Bombay (baby) · 2026-10-21

Tag `v0.2.1`.

- HelloGitty now checks the issues you plan to work on, and the issues your open pull requests fix,
  for someone else's work every 15 minutes: another pull request citing the issue, an assignee, a
  claim in a comment, the issue closing, or an open pull request whose title covers the same
  subject. Each issue gets one report in the inbox file (`issue_overlap`, or `issue_similar` for a
  title match), recorded so it is never repeated. The pipeline command can list issues to watch
  under `watch`. `-once` now also writes the inbox file.

## v0.2.0 · Black Bombay (baby) · 2026-10-21

Tag `v0.2.0`.

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
  keeps the closed-watch alert lit. `watch` now checks every issue number before adding any.
- **Your work:** a new panel at the top of the dashboard listing every pull request and issue
  your account has out anywhere on GitHub, sorted into Your move, Waiting on others and Finished
  (last 30 days). Each row says in one sentence what happened last (changes requested, a reply,
  checks failing, a merge conflict, approved, waiting for review) and quotes the latest comment
  from someone else. Refreshed every 5 minutes with one GraphQL request.
- **Your repositories:** pull requests and issues from others in repositories you own or list
  under the new `maintain` setting, plus reviews requested from you, split into Needs you and
  Waiting on contributors. A new amber **Your move** alert counts everything waiting on you.
- Friendlier wording throughout: sentence-case labels ("Watched issue claimed", "Turned down"),
  times in words ("3 days ago"), plain review verdicts and contributor types.
- Light and dark themes. The page follows the system setting; an Auto / Light / Dark switch in the
  header overrides it and is remembered.
- A toolbar to filter and organize the dashboard: search (press `/`), pull requests or issues
  only, one organization or repository, "Needs me only", and group Your work by whose move,
  repository or organization. Tracked repositories can be sorted. Choices are remembered across
  reloads; the alert cells are never filtered.
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
