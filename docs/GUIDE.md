# Reading HelloGitty

A guide to every part of the dashboard and what to do with it. For installing and configuring,
see the [README](../README.md). Inside HelloGitty, press **?** or click **Help** in the header to
read this guide, the glossary and details of your install.

HelloGitty is built to be left open all day and glanced at. It answers two questions without you
opening a single GitHub tab: **what is waiting on me?** and **how are the projects I care about
doing?** Most of the page stays calm on purpose. Colour appears only when something needs you, so
the first rule of reading it is simple: **if nothing is lit, nothing needs you.**

![HelloGitty dashboard](screenshot.png)

---

## The five-second check

1. Look at the row of cells under the header.
2. Is **Your move** lit? Read the **Your move** list at the top of the page.
3. Is anything else lit? Read its name, then the names written inside it.
4. Nothing lit? You're done.

Red means stop and look now. Amber means it's your turn, or worth knowing today. Green means good
news. Nothing else on the page uses those colours.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ HelloGitty  version  Last check · GitHub API · repos   [Auto|Light|Dark] [cat]│  header
├──────────────────────────────────────────────────────────────────────────────┤
│ [Watched issue claimed] [Your move] [Check failed] [Data is stale] ...        │  alerts
├──────────────────────────────────────────────────────────────────────────────┤
│ [Search…] [All|PRs|Issues] [Org / repo ▾] [ ] Needs me only  Group by [...]  │  toolbar
├──────────────────────────────────────────────┬───────────────────────────────┤
│ Your work                                     │ Watched issues                │
│   Your move · Waiting on others · Finished    │ Merge rate                    │
│ Your repositories                             │ Checks                        │
│   Needs you · Waiting on contributors         │                               │
│ Tracked repositories                          │                               │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

On a phone the same parts stack in one column.

---

## Header

| Item | Meaning |
|---|---|
| **HelloGitty** and version | The build you are running, e.g. `v0.1.0 · Black Bombay (baby)`. `dev build` means an untagged build. Quote it when reporting a bug. |
| **Last check** | How long ago HelloGitty last finished checking your tracked repositories, in words. Hover for the exact UTC time. |
| **GitHub API** | Calls used against your hourly GitHub budget, with a small gauge that turns amber at 90%. |
| **Repos** | How many repositories are tracked (and, with a pipeline command, how many it reports a stage for). |
| **Auto / Light / Dark** | The colour theme. Auto follows your system setting; Light or Dark overrides it and is remembered in this browser. |

The kitten at the right end is the mascot (see [The mascot](#the-mascot)). It carries no data.

---

## Alerts

One cell per condition. Each cell has three looks:

- **Dark with a label:** the condition is not true. This is the normal state.
- **Dashed border:** there is nothing to check yet (for example "nothing watched"). This is not
  an all-clear.
- **Solid colour:** the condition is true. The count is on the right, and what's involved is named
  underneath. If more are involved than fit, it shows `+N`; hover the cell for the full list.

| Cell | Colour when lit | Lights when | What to do |
|---|---|---|---|
| **Watched issue claimed** | red | An issue you are watching was assigned to someone, or someone commented in the last 30 days that they are taking it. | Don't start work on it. Pick something else or talk to that person. |
| **Your move** | amber | Anything in **Your move** or **Needs you** (below). Names the items. | Work through the Your move list. |
| **Check failed** | red | A tracked repository, the pull request search, or the Your work refresh failed. Hover or tap the cell for why, in plain words (for example "GitHub took too long to answer while sending its pull requests") and when it's tried again. The repository's row also carries a red **check failed** tag. | Usually nothing: a slow moment at GitHub clears on the next check. If the same one keeps failing, open its row for the details. See [Troubleshooting](#troubleshooting). |
| **Data is stale** | red | The last successful check of your repositories finished more than two hours ago. | HelloGitty has probably stopped. Restart it. |
| **Watched issue closed** | amber | A watched issue was closed, fixed or not. | Read how it was closed, then unwatch it. |
| **Repo dormant** | amber | A tracked repository has had no commit for more than 90 days. | Work sent there may never be reviewed. |
| **Repo slowing** | amber | No commit for more than 30 days. | Expect slower reviews. |
| **API running low** | amber | Less than 10% of the hourly GitHub budget is left. | Wait for the reset (see Checks). |

With a pipeline command configured, two more cells appear, named by your command (by default
**Repo flagged** and **Stage failed**): one for repositories it marks as needing attention, one for
a stage it reports as failed.

**Watched issues** are the issues you plan to take: the ones your pipeline command lists, plus any
you add yourself with `hellogitty watch owner/name 123`. HelloGitty checks them every cycle for
someone else being assigned or saying they're taking it, and for the issue closing. They're listed
in the **Watched issues** panel; `hellogitty unwatch owner/name 123` drops one.

**Clearing an alert.** A lit cell that names what lit it has a **Clear** button. Clearing says
"I've seen these": the cell goes dark and stays dark until something new lights it, such as
another repository going dormant or another watched issue being claimed. Anything that stops
lighting it is forgotten, so it lights the cell again if it comes back later. A cleared cell reads
"N cleared" with a **Show** button that lights it again. **Data is stale** and **API running
low** can't be cleared: they mean the board itself can't be trusted right now, and they go dark on
their own.

---

## Filtering and organizing

The toolbar under the alerts narrows and rearranges the lists. It never touches the alert cells:
an alarm always counts everything, whatever you have filtered.

| Control | What it does |
|---|---|
| **Search** | Matches titles, repositories, numbers (`#123`), labels, status text and people (`@name`). Several words must all match. Press `/` anywhere to jump to it and `Esc` to clear it. |
| **All / PRs / Issues** | Shows only pull requests or only issues in Your work and Your repositories. |
| **Organization or repo** | Narrows every list, including Tracked repositories and Watched issues, to one owner or one repository. The menu lists only owners and repositories on the page. |
| **Needs me only** | Hides everything that isn't your move. |
| **Group by** | *Whose move* is the normal view. *Repository* and *Organization* regroup Your work and Your repositories under each repository or owner, with groups holding something that's your move listed first. Each row then shows a small tag saying whose move it is. |
| **Sort** (Tracked repositories) | Furthest stage first (or name), name, most open issues, most good first issues, most unassigned, most recent commit, or most turned down. |

While a filter is on, list headings read "2 of 15", the toolbar says how many items are showing,
and **Clear filters** appears. A filter that matches something in the folded Finished list opens
it. Your choices are remembered in this browser, so the 5-minute reload keeps them.

---

## Your work

Every pull request and issue your GitHub account has out, **anywhere on GitHub**, not only in
tracked repositories. It refreshes every 5 minutes. Items fall into three groups:

- **Your move:** the next step is yours. Longest waiting first.
- **Waiting on others:** you've done your part; a reviewer, maintainer or reporter hasn't
  answered yet. Longest waiting first.
- **Finished in the last 30 days:** merged or closed. Click the heading to open or fold it; the
  page remembers.

### Reading a row

```
●  Add retry to the uploader
   ⎇ owner/repo #123 · You opened it
   Changes requested by @alice   [Merge conflict]                    2 days ago
   ┌──────────────────────────────────────────────────────┐
   │ @alice Could you add a test for the timeout path?   │
   └──────────────────────────────────────────────────────┘
```

- **Dot:** what needs your eyes.
  - **Green:** something new happened that you haven't read yet. A **New** tag next to the status
    says what: "New comment", "CI failed: lint", "Review requested".
  - **Amber:** you've read it, and it's your move.
  - **Hollow:** you've read it, and nothing is asked of you.

  "Read" is GitHub's own read state, from your notifications inbox. Opening the pull request on
  GitHub, or clicking its title here, marks it read, and the dot changes within a minute. The
  heading of Your work counts what's new. Clicking a title here doesn't mark anything read on GitHub;
  acknowledging a line in the [live feed](#live-feed) does.
- **Other notifications:** threads in your GitHub inbox that match no row: a CI run failing on a
  branch with no open pull request, a review request somewhere else, a release. Shown while unread,
  and afterwards only if they still ask something of you (a review request, an assignment, a
  security alert, a failing CI run). The same workflow failing again on the same branch shows
  once.
- **Missing rows filled in:** GitHub's search sometimes misses a pull request, a new one for a
  few minutes or an older one entirely. Any pull request you opened that shows up in your
  notifications gets its row anyway.
- **Turned off?** A fine-grained GitHub token can't read notifications. The dots then show only
  amber and hollow, and a line under Your work says why. A classic token with the `notifications`
  or `repo` scope turns them on.
- **Only you:** a solid amber tag in front of the status when the next step can't be done by
  anyone else with the branch: signing a CLA, signing off commits for a DCO check, or answering a
  human reviewer in your own words. These rows sort to the top of Your move.
- **Title:** opens the pull request or issue on GitHub.
- **Second line:** a pull request or issue icon, the repository and number, why it's on your
  board (you opened it, it's assigned to you, or you joined the thread), and the item's labels.
  Labels often say what a project expects next (`cla: pending`, `needs-triage`).
- **Status:** one sentence saying what happened last and whose turn it is.
- **Chips:** extra facts worth a glance. Amber: *Failing:* and the check names (*Checks failing*
  when GitHub gives no names), *Merge conflict*, *Behind main* (the branch needs updating),
  *N unresolved threads*. Neutral: *Waiting on:* and the checks still pending (*Checks running*),
  *CI awaiting maintainer approval*. Green: *Checks passed*, shown only when every check ran and
  passed.
- **Repository pill:** the pale yellow pill closing the row names its repository and number.
- **Quote:** the comment worth reading before you act: the unresolved review comment the status
  is about, or else the latest word from someone else. Formatting, code blocks and quoted replies
  are stripped.
- **Time:** how long the item has been in its current state. Hover for the exact time.

### What each status means

**Your pull requests**

| Status | Whose move | Meaning |
|---|---|---|
| Sign the CLA (check: description) | yours, only you | A CLA check is pending or failing, or a label says the CLA is missing. |
| Sign off your commits for the DCO check | yours, only you | The DCO check isn't passing. |
| @name is waiting for your reply on a review comment | yours, only you | A person left a review comment that is unresolved and you haven't answered. |
| Changes requested by @name | yours | A reviewer asked for changes and you haven't pushed since. |
| N unresolved review comments from @name; merging is blocked… | yours | Review threads (often from review bots) are open and unanswered. GitHub can block the merge on them even when every check is green and no one has requested changes. |
| @name commented / left a review | yours | Someone spoke after your last push or comment. |
| Failing: check names | yours | Those checks failed on your latest commit. |
| Merge conflict to resolve | yours | The branch no longer merges cleanly. |
| Branch is behind main; update it | yours | The base branch moved on and the project requires branches to be up to date before merging. |
| Labelled "waiting on author": the maintainers are waiting on you | yours | A label says the project is waiting for you. |
| Draft: mark it ready… | yours | It's still a draft. |
| You pushed changes; waiting for @name to look again | theirs | You answered a change request with new commits. |
| Approved by @name; waiting to be merged | theirs | Approved; a maintainer needs to merge it. |
| Review requested from @name | theirs | A reviewer is assigned and hasn't reviewed yet. |
| You replied; waiting for a response | theirs | You spoke last. |
| Waiting for a first review | theirs | Nobody has looked yet. |
| …; CI is waiting for a maintainer to approve it | theirs | Many projects don't run CI for a first-time contributor until a maintainer approves it. Nothing is broken; it just hasn't run. |
| Merged by @name / Closed without merging | finished | The quote shows the last thing a maintainer said. |

A push after someone's comment counts as your answer, so the item moves to Waiting on others.
A review thread you replied to last counts as answered; resolving it is the reviewer's job.
Threads, check names and labels are fetched for your own open pull requests; other rows use the
combined check state.

**Your issues** (opened, assigned, or a thread you joined)

| Status | Whose move |
|---|---|
| Labelled "needs info" (or similar): the maintainers are waiting on you | yours (issues you opened) |
| @name replied (issues you opened or are assigned) | yours |
| @name mentioned you (a thread you joined) | yours |
| @name commented after you; nothing asked of you (a thread you joined, no mention of you) | theirs |
| Assigned to you | yours |
| No replies yet | theirs |
| You replied; waiting for a response | theirs |
| Closed as completed / not planned / a duplicate | finished |

---

## Conversations

Issues and pull requests you **joined but didn't open**: you commented on them, or someone
mentioned you. They used to sit in Your work; they have their own panel so that Your work counts
only what you opened or were assigned, and the counts there mean "my pull requests and issues".

- **Asks something of you:** someone mentioned you, or replied to you, since you last spoke. These
  count in the Your move alert.
- **Quiet:** nobody is waiting on you. Folded away; a thread leaves the panel once it closes.

## Your repositories

Open pull requests and issues **from other people** in repositories your account owns, plus any
you list under `"maintain"` in `hellogitty.json` (a repository like `"org/name"` or a whole
organisation like `"org"`). Pull requests where your review was requested appear here too, from any
repository.

- **Needs you:** a review was requested from you; a pull request was updated since your review;
  a new pull request nobody has reviewed; an approved pull request ready to merge; a new issue
  nobody has answered; someone commented after you.
- **Waiting on contributors:** you spoke last, or the pull request is a draft.
- **Notifications:** GitHub notifications about these repositories that match no pull request or
  issue above, such as a failed workflow run or a release. **Clear** takes one off the page until
  that thread has new activity, and marks it read on GitHub if it wasn't. GitHub doesn't tell apps
  which notifications you marked Done there, so a read one that still asks something of you (a
  failed run) stays here until you clear it. Notifications about other people's
  repositories stay under Your work's **Other notifications**.

---

## Tracked repositories

The repositories you follow, from your config, with their health. Rows your pipeline command
reports come first, furthest stage first; the rest follow alphabetically.

**Finding and pinning.** **Search repositories**, beside the sort menu, narrows the list as you
type: a name, an owner, a stage or a label. To keep a repository at the top whatever the sort,
point at its row and click the pin beside its name; pinned ones stay first, in the order you
pinned them, with a line under the last. Click the pin again to unpin. Pins and the search are
saved in this browser.

**Adding and removing repositories.** Type `owner/name`, or paste the repository's GitHub address,
into **Add a repo** at the top of the panel and press **Track**, then confirm. HelloGitty checks
that the repository exists and that your token can see it, then checks it straight away; it joins
the list when that first check finishes. To stop tracking one, open its row, click **Stop
tracking** and confirm. Both ask "are you sure" first and name the repository. Its history is kept, so tracking it again picks up where
it left off. Your config file is never rewritten: repositories you add here are kept in
HelloGitty's own database, and one your config file lists that you remove here shows under the
panel with a **Track again** button. From a terminal, `hellogitty track owner/name` and
`hellogitty untrack owner/name` do the same; a running HelloGitty picks them up on its next check.

| Column | Meaning |
|---|---|
| **Light** | Green dot: active, a commit in the last 30 days. Amber ring: slowing, 31 to 90 days. Amber dot: dormant, over 90 days. Dashed ring: not checked successfully yet. |
| **Repository** | Owner (dim) and name. In bold, with a green **N new** badge, when the live feed has things about it you haven't acknowledged: new issues, activity on your pull requests there, someone else's work on an issue you plan to take. |
| **Stage strip** and **status** | Only with a pipeline command: one square per stage (grey done, white current, amber failed; dotted when the command doesn't report the repository) and the command's label. |
| **Open** | Open issues, pull requests not counted. |
| **Good first** | Open issues labelled good first issue (`good first issue`, `good-first-issue` or `good_first_issue`). |
| **Unassigned** | Open issues nobody is assigned to. |
| **Last commit** | Days since the last commit, with a bar that fills over 120 days and turns amber after 30. |
| **Watching** | How many of this repository's issues you watch. |
| **Turned down** | Pull requests from outside contributors, among the latest 100 closed, that were closed without merging. Bots and pull requests the maintainer says they merged by hand are not counted. |

Click a row to open it (it stays open across reloads). On the left: a link to the repository, its
watched issues and your pull requests there. On the right, four tabs:

- **Issues:** its newest open issues, with new ones marked and who has taken one (assigned or
  claimed). Opening this tab counts as reading the new ones, so their badges clear and they leave
  the live feed. An issue with a GitHub notification behind it stays until you press Ack in the
  feed, because that also marks it read on GitHub.
- **Pull requests:** the newest open ones and who sent them (dependency bots left out), then the
  latest merged or closed, marking outside contributors.
- **Activity:** this repository's lines from the live feed in the last week, apart from new issues.
- **Lessons:** the last five turned-down pull requests from outside contributors, each with who sent
  it (first-time or past contributor), the review verdict, when it was closed and the maintainer's
  last comment. Read those before contributing to a new project: they say, in the maintainers' own
  words, what they turn down and why.

A row opens on Issues when it has new ones, otherwise on Lessons.

The **N new in M repos** badge beside the Tracked repositories heading adds those counts up. Your
work's heading counts its green dots the same way.

---

## Watched issues

Issues you want to keep an eye on, most urgent first: ones you plan to work on, or any issue
whose outcome you care about. Commenting on an issue doesn't watch it; you choose.

**The eye.** Every issue on the dashboard has an eye beside it: in Your work, Conversations, the
live feed and a repository's Issues tab. Click it to watch that issue; the eye fills in, and the
issue joins this panel. Click a filled eye (here or anywhere) to stop. The eye works for issues in
any public repository, not just ones you track: HelloGitty looks each one up on every check. It
watches issues only; pull requests you're part of already show under Your work or Conversations.

| Status | Meaning |
|---|---|
| **Claimed** (red) | Assigned to someone, or someone else's comment in the last 30 days that takes it, such as "I'll take this", "I'm working on this", "Can I work on this?" or "Please assign me". The link goes to the claim. |
| **Fixed** (amber) | Closed by a merged pull request or a commit. |
| **Closed** (amber) | Closed without a linked fix. |
| **Open** (green) | Open and unclaimed. |

```bash
hellogitty watch owner/name 123          # watch issue 123 (several numbers allowed)
hellogitty watch                         # list what you are watching
hellogitty unwatch owner/name 123        # stop watching issue 123
```

**How a claim is spotted.** On every check, HelloGitty reads each watched issue's comments from
the last 30 days, newest first, sentence by sentence. A sentence that says its author is taking
the issue ("I'll take", "I'm working", "working on this", "taking this", "I can do this", "I'd like
to work on", "Can I work on", "assign me" and similar) marks it claimed. It skips your own
comments, bots, quoted lines, and questions put to someone else, so "Are you still working on
this?" or "Is anyone working on it?" never count. An assignee always counts.

**Seen.** A claimed or closed issue has a **Seen** button. Pressing it says you know: the badge
turns from solid to outlined, and the matching alert goes dark. You keep watching; if anything
changes again (a new claim, the issue closing) it lights up afresh. To stop watching altogether,
click its eye.

From the command line the repository must be one you track. With the eye, the issue's state
shows within seconds. An unwatched issue leaves the page on its next reload.

---

## Merge rate

Counts of pull requests your account opened **in tracked repositories**: opened, open, merged,
closed (without merging) and rate, which is merged ÷ (merged + closed). Open ones don't count
toward the rate. With a pipeline command this panel is titled **Pipeline** and also shows how many
repositories sit at each stage.

Every number opens what it counts on a page of its own: click **Open** to see your open pull
requests, **Merged** for the merged ones, or a stage such as **BLD** for the repositories at that
stage. The page lists them with their details and has buttons to move between the other counts;
each pull request or repository on it links to GitHub.

---

## Checks

When the last check of your tracked repositories finished and when the next one starts, how often
they run (60 minutes by default), how long the last one took, how many API calls it used, when
the hourly GitHub budget refills, what the last Your work refresh cost, and a link to
`snapshot.json`, the same repository data in machine-readable form. Your work refreshes separately,
every 5 minutes, using GitHub's GraphQL API, which has its own 5,000-point hourly budget and
doesn't count against the number in the header. A refresh usually costs around 30 points.

---

## Changes since your last look

The page reloads itself every five minutes. A number or status that changed since the previous
reload is underlined and blinks twice, so after time away you can see what moved. With reduced
motion turned on in your system settings, it is underlined without blinking.

---

## The mascot

The kitten at the top right is Black Bombay (baby), the mascot of the current release line. It
plays one short, silent clip each time the page reloads, a livelier one when something changed,
and otherwise rests. It never loops, carries no data, and is hidden from screen readers. With
reduced motion turned on, you see a still image. In the light theme it sits in a small dark window.

---

## Live feed

**Live**, at the top of the right-hand column, is a running list of what just happened, newest
first, one line each:

- **New issue:** opened in a repository you track.
- **Your PR / Your issue:** a comment, review, label, merge or close on your own work, or a bot's
  finding that needs fixing.
- **Someone else / Worth a look:** someone else's work on an issue you plan to take.
- **Watched:** a watched issue claimed or closed.
- **Health:** a tracked repository went slow or dormant.
- **GitHub:** a notification about anything else.

The list re-reads itself every 30 seconds, and new lines flash once. Click a line to jump to that
row on the dashboard; if it has no row there, the link opens it on GitHub.

**Ack** marks a line seen, and it leaves the list (tick **Show acknowledged** to see those too).
When a GitHub notification is behind the line, acknowledging it also marks that notification read
on GitHub, and the dashboard's dot for it stops being green. It works the other way too: reading
the thread on GitHub settles the line here within a minute. Lines with no GitHub notification
behind them, such as a repository going dormant, are acknowledged in HelloGitty only; the button
says so when you point at it. **Acknowledge all** clears the list.

**Open in a window** shows the feed on a page of its own (`/feed`), small enough to keep beside
your editor.

New issues arrive with each check of your repositories (hourly by default). Everything about your
own work and your notifications arrives within a few minutes.

---

## Layouts

**On the panels themselves:**
- **Collapse:** the arrow at the right end of a panel's heading folds it down to its heading;
  press it again to expand.
- **Move:** drag a panel by the grip (the six dots before its title) and drop it above or below
  another panel, in either column. With the keyboard, focus the grip and use the up and down arrow
  keys; left and right move it between the main and side columns.
- **Resize:** drag a panel's bottom edge (a short bar appears when you point at it) to make it
  shorter or taller. A shortened panel scrolls inside, with its heading, sort bar and column
  headers staying in view. Double-click the edge to fit the content again. With the keyboard,
  focus the edge and use the up and down arrow keys.

Scrolling the page is never trapped by a panel that scrolls inside. A scroll already moving the
page keeps moving it when the pointer passes over one; a scroll you start over a panel scrolls
that panel, and carries on down the page once it reaches its end.

**Layout** in the header opens a sheet where you set what the page shows:
- turn any panel or section on or off;
- fold a panel down to its heading (an **Unfold** button brings it back);
- move panels up and down;
- put a panel in the main column or the side column.

Changes apply at once and are saved in this browser.

Presets set everything at once:
- **Everything:** the full page, the default.
- **Contributor:** Your work and watched issues, with tracked repositories folded.
- **Maintainer:** Your repositories first.
- **Program:** pipeline and tracked repositories first, with Your work folded.
- **Focus:** one column with the alerts and Your move, nothing else.
- **Custom:** your own layout. Any change you make (showing, hiding, folding or moving a panel)
  is kept here, so trying a preset never loses it: press **Custom** to get yours back.

**Reset to everything** undoes it all.

Hidden panels still count in the alert cells, so a lit cell can point at something you've hidden.
The filter toolbar stays visible while a filter is active, so rows never disappear without a way
to see why. On a narrow screen the page is one column, and moving a panel only changes its order.

---

## Hover help

A word with a dotted underline can explain itself: hover over it, or move to it with Tab, and a
small card says what it means and what to do about it. Alert cells, health lights, the legend,
note chips and watch statuses explain themselves the same way. On a phone or tablet, tap the word;
tap again to close it. Esc closes it anywhere.

Hover a pull request or issue title, or a repository name, for half a second (or Tab to it) and a
peek shows what the row has no room for:
- **Pull requests and issues:** opened and updated, checks by name, reviews, assignees, the
  branch, the issues it fixes, the latest few comments.
- **Repositories:** health, issue counts, your pull requests there, and the last pull request
  the project turned down, with its reason.

The cards only show what HelloGitty already knows, so hovering costs no GitHub calls. A pipeline
command can explain its own words (its stages and verdicts) through its `glossary` field; a word
it doesn't explain is left unmarked.

---

## Everyday use

Comments written by machines never put a row in Your move: bots, accounts that run automation
(names ending in "bot" or "robot", such as gopherbot), and comments that open with a hidden
`<!-- ... -->` marker, which policy checks and review tools post even from a maintainer's account.

Each row ends with a pale yellow pill naming its repository and number, so you can tell rows apart
without reading the small line under the title.

**Glance.** If **Your move** is lit, work down that list from the top: it's sorted by who has
waited longest. Each row's quote usually tells you what to do without opening GitHub.

**Maintaining.** Check **Your repositories → Needs you** for reviews and unanswered issues.

**Choosing new work.** In **Tracked repositories**, look for a green light, a healthy Good first
count and many unassigned issues. Open the row and read what gets turned down first.

**Before you start an issue.** Watch it. If someone else claims it while you work, the red cell
lights.

---

## Keyboard shortcuts

| Key | Does |
|---|---|
| **/** | Jump to the search box. |
| **Esc** | In the search box: clear it. Anywhere else: close a hover card, or the Layout sheet. |
| **?** | Open Help. |
| **Tab** | Move through rows, underlined words, chips and controls. A word with a dotted underline explains itself when it gets focus. |
| **Enter** or **Space** | Open a row's title, press a button, open or close a tracked repository's details. |

---

## Your data and privacy

HelloGitty runs only on your computer. The dashboard listens on your own machine and refuses any
address other people could reach. The only thing it talks to over the network is GitHub's API,
using your token. It reads, with one exception you control: pressing **Ack** on a live-feed line
with a GitHub notification behind it marks that notification read. It never comments, labels or
changes anything else on GitHub, and other websites can't make it acknowledge anything. There is no
telemetry, account or cloud service.

What it keeps, and where:

| What | Where | Safe to delete? |
|---|---|---|
| Repository data, the watch list and records of reports it has made | The database file (`database` in your config, `hellogitty.db` by default) | Yes; the next check refills it. Watched issues and report history are lost. |
| The machine-readable snapshot | `snapshot.json` (the `snapshot` setting) | Yes; rewritten after every check. |
| The inbox file, if you set one | The `inbox` setting | Yes; rewritten every few minutes. |
| Your theme, filters, layout and which dots you've read | Your browser's storage for this page | Yes; clearing site data resets them. |

Your GitHub token is read from the `GITHUB_TOKEN` environment variable when HelloGitty starts. It
is never written to any of these files or shown on the page.

---

## Questions people ask

**Why is something in Your move?** Its status line says why: someone replied, changes were
requested, a check failed, there's a merge conflict, or someone mentioned you. Comments from bots
and automated checks never put a row there.

**Why did a row leave Your move?** You answered, pushed, or the other side acted. Rows that wait
on others move to **Waiting on others**; merged and closed ones fold into **Finished**.

**Does HelloGitty change anything on GitHub?** Only one thing, and only when you ask: pressing
**Ack** on a live-feed line marks the GitHub notification behind it as read. Everything else is
read-only.

**Can I use a fine-grained token?** Yes, for everything except what comes from GitHub
notifications: the green new-activity dots, the GitHub lines in the live feed, and marking
notifications read when you acknowledge. GitHub doesn't let fine-grained tokens read notifications,
so the dots fall back to amber and hollow, and a line under Your work says so.

**How much of my GitHub quota does it use?** Your work is one request every five minutes on
GitHub's separate GraphQL budget. Tracked repositories cost about 25 calls each on the first check
and far fewer afterwards. Notifications cost nothing when nothing has changed. The header shows
calls used this hour.

**How do I hear when someone claims an issue I want?** Watch it:
`hellogitty watch owner/name 123`. If someone is assigned, claims it in a comment, opens a pull
request for it or closes it, you'll see it.

**How do I add or remove a tracked repository?** On the dashboard: type `owner/name` or a GitHub
link into **Add a repo** in Tracked repositories and press **Track**; open a repository's row and
click **Stop tracking** to remove it. See [Tracked repositories](#tracked-repositories). You can
also list them under `repos` (or in your `repos_file`) in `hellogitty.json`; a `repos_file` is
re-read on every check, so no restart is needed.

**Where is my configuration?** In `hellogitty.json`, in the folder you run HelloGitty from, unless
you passed `-config`. **Help → About this install** shows the files in use.

**How do I update?** Run the install command again (`go install
github.com/FawwazLawal/hellogitty/cmd/hellogitty@latest`), then restart HelloGitty.

---

## Getting help

- **In the app:** press **?** for this guide, the glossary of every term on the page, and the
  details of your install (version, files, token access).
- **Installing and configuring:** the [README](../README.md) has every setting.
- **Something wrong?** Check [Troubleshooting](#troubleshooting) below first. If it's still wrong,
  [open an issue](https://github.com/FawwazLawal/hellogitty/issues/new) with your version (from
  **Help → About this install**), what you expected and what you saw. Don't paste your token or
  your config's private paths.

---

## Troubleshooting

| You see | Likely cause | Fix |
|---|---|---|
| **Data is stale** lit, Last check getting older | HelloGitty stopped, or the computer slept. | Restart it. |
| **Check failed** naming one repository, error `404` | The repository was renamed, moved or made private. | Update its entry in your config. |
| **Check failed** naming everything, error `401` | The GitHub token expired or was revoked. | Set a new `GITHUB_TOKEN` and restart. |
| **Check failed** naming "your work" | The Your work refresh failed; the panel shows the error and keeps the previous list. | Usually clears on the next refresh. If it says the token lacks access, use a token that can read your repositories. |
| Your work says it hasn't been fetched yet | HelloGitty just started. | Wait a few seconds; the page reloads on its own. |
| Error mentioning a rate limit | GitHub's hourly or burst limit was hit. | HelloGitty waits and retries. |
| A very large repository shows Check failed saying exact totals are unavailable | Its issue list is too long to fetch page by page and the search for exact totals failed. | It retries on the next check; rather than show a partial number, the repository is marked failed. |
| **GitHub API** near the limit every hour | Many large repositories, or a short interval. | Track fewer repositories or set `"interval"` longer. |
| Merge rate says "Not counted yet" | The pull request search runs after the first check finishes. | Wait for the first check. |
| The page won't load | HelloGitty isn't running, or is on another address. | Start it; the address is the `listen` setting (default `localhost:7340`). |
| No green dots ever, and a line under Your work says they're off | The token can't read notifications (fine-grained tokens never can). | Use a classic token with the `notifications` (or `repo`) scope. |
| A dot stays green after you read the thread | GitHub hasn't marked it read yet, or you read it somewhere that doesn't mark it. | Open it from the row's title, or on GitHub. The dot checks once a minute. |
| A pull request of yours is missing from Your work | GitHub's search hasn't indexed it yet, or leaves it out. | It appears within a few minutes once it shows up in your notifications. |
| A panel has disappeared | It was hidden or folded in **Layout**. | Open **Layout** and turn it back on, or click **Reset to everything**. |
| Rows are missing from a list | A filter is on. | Look at the toolbar; **Clear filters** shows everything. |
