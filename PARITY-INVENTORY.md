# React vs legacy: parity inventory for 13 pages

Branch: `audit/parity-inventory-b` off `origin/dev` at `3619f8c`.
Driven in a browser against the live Go binary with the real snapshot cache
(150 feed rows, 23 help sections, the owner's actual repo list).
No code changes. Report only.

Legend: **present**, **missing**, **not operable** (control exists but
doesn't do what it did), **different** (behaviour kept but altered; marked
**better** / **lesser**).

## Universal regression: document title

Every legacy page sets a specific `<title>` ("HelloGitty live",
"Conversations · HelloGitty", "Flagged · HelloGitty", …). All thirteen
React pages inherit the SPA's default `<title>` of **"frontend"**. The
browser tab no longer tells you which page you are on. One line to fix per
page, but it is thirteen pages wide.

Measured by `curl -s /<path> | grep -oE '<title>[^<]+</title>'`.

**Status:** missing (every page).
**Severity:** regression you notice the moment you open a second tab.

---

## /feed

### Behaviour

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "HelloGitty live" | "frontend" | missing |
| Page heading | none (list starts flush) | "HelloGitty live" + lede sentence | different, arguably better (names the surface) |
| Stale banner on `known: false` with rows | n/a — legacy had no `known` flag | present, warning-coloured | **better** (the port's own fix for the bug the templated page silently had) |
| "Not fetched" state (`known: false`, rows=0) | n/a | present | better |
| "Nothing new …" empty copy | present | present | parity |
| Row: label chip (kind) | present | present | parity |
| Row: title link to GitHub | present | present | parity |
| Row: repo#number · actor · time | present (server-rendered Ago: "Yesterday 22:27") | present (client relative time: "5h ago") | **different, lesser** — legacy keeps time-of-day precision through "Yesterday"/"Today"; React rounds to "Nh ago" |
| Row: time element `datetime` attribute | present | present | parity |
| Row: Ack button | present | present | parity |
| Row: "Seen" state (acked, disabled) | present | present | parity |
| Row: Ack title (differs by whether a GitHub thread is behind it) | present | present | parity |
| **Row: eye button (watch/unwatch issue)** | **present** — every new-issue/issue/watch/overlap row renders an eye, POSTs /watch | **missing** — React never renders the eye | **missing** |
| Row: visual flash animation for newly arrived rows ("fresh") | present (keyframes) | missing | missing |
| Row: click row body jumps back to the dashboard row it's about (scroll + flash) | present on dashboard; moot on /feed itself | moot | parity |
| "Show acknowledged" toggle | present | present | parity |
| "Show acknowledged" persists via localStorage (`hellogitty-feed-all`) | present | missing — React component state, resets on reload | missing |
| "Acknowledge all" button | present | present | parity |
| Ack confirmation message (sr status, "N marked read on GitHub; N kept here only; N failed") | present | missing — React ack success is silent; only errors surface | missing |
| Auto-refresh cadence | 30 s | 20 s | different, arguably better (more aggressive) |
| Row-level `aria-live="polite"` | present | present | parity |
| Cross-widget sync (`hg-acked` / `hg-seen` events) | present on dashboard; moot on standalone /feed | moot | parity |

### Summary

Four misses (eye, show-acknowledged persistence, Ack confirmation,
fresh-flash), one lesser (time-of-day precision), one universal title
regression. The eye is the only one that removes a capability — the others
reduce signal.

---

## /help

### Behaviour

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "HelloGitty help" | "frontend" | missing |
| Page heading from guide | present | present | parity |
| Intro HTML from `help.Render` | present | present | parity |
| Sections rendered with HTML + link rewrites | present | present | parity |
| Glossary (dt+dd rows) | present | present | parity |
| About this install (key/value) | present | present + per-row `known` em-dashes | **better** on the unknown-is-not-zero axis |
| AI prompt block with Copy button | present | present | parity |
| Copy button on EVERY `<pre>` inside doc sections (autowrapped) | **present** — JS auto-wraps every code block in the guide | **missing** — React only renders a Copy button on the AI prompt `<pre>` | missing |
| Clipboard fallback (`execCommand('copy')` + selection) when async API rejects | present | missing — React catches and silently gives up | missing |
| Copy-confirmation "Copied" / "Select and copy it" text | present (1.8s revert) | present ("Copied", 1.5s) | parity |
| **`/` keyboard shortcut focuses the search box** | **present** (`q.focus(); q.select()`) | **missing** — focus stays on `<body>` | **missing** (peer flagged) |
| Visible `<kbd>/</kbd>` hint in search box | present | missing | missing |
| **Search ranker** | stemmed, grouped, scored — "adding repos" → 5 hits across sections + glossary; "Enter opens the first." | substring filter — "adding repos" → "Nothing matches" | **different, lesser** — the stemmer is what makes "adding repos" find "add a repository"; peer flagged this |
| Search `Enter` opens the first result | present | missing — Enter submits the form (no handler) | missing |
| Search `Escape` clears and blurs | present | missing | missing |
| Search `ArrowDown` / `ArrowUp` moves highlight | present (`sel` var, visible `.hit.sel`) | missing | missing |
| Search result bar "N answers, best first" | present | partially — "N matches for '…'" | different (less confident copy, no "best first") |
| Search results clickable rows | present | present | parity |
| Search results reveal context under title (hit snippet) | present (`.snip` with mark highlighting) | missing — only section/term title | missing |
| `data-shortcuts="off"` global override | honoured | moot (no shortcuts) | moot |
| TOC with deep-anchor links | present | present | parity |
| **TOC scroll-spy (`aria-current="true"` on visible section)** | **present** (IntersectionObserver with `-100px 0px -70% 0px` rootMargin) | **missing** | missing |
| Mobile layout (TOC flows, search full width) | present (max-width: 900px media query) | present (md: grid breakpoint) | parity |

### Summary

Nine missing features on /help. The two peer flagged (`/` shortcut and
stemmer) are both confirmed in-browser:

- Legacy: `/` with no input focused → `document.activeElement.id === "h-q"`.
- React: `/` with no input focused → `document.activeElement.tagName === "BODY"`.
- Legacy: search "adding repos" → 5 hits across "Questions people ask" and
  "Tracked repositories".
- React: search "adding repos" → "Nothing matches 'adding repos'".

**On "is substring genuinely better than stemming".** No. The question peer
raised was whether a substring filter beats a stemmer for help, and I doubt
it myself. The example above is the proof: a user who types the words they
would say out loud ("adding repos") finds zero hits on a help page that
documents exactly that. A stemmer collapses "adding/added/add" to one root
and finds the section the user wants. The React page's ranker is strictly
less useful, and nothing about it is better for help than for the dashboard
search where a stemmer was never applied — there, substring matches a
specific row; here, the content is written in prose that uses verb forms,
which is the shape stemming exists for.

---

## /conversations

### Behaviour

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "Conversations · HelloGitty" | "frontend" | missing |
| Lede sentence | present | present | parity |
| Overview cards: Needs reply / Waiting / Unread | present | present | parity |
| Overview cards act as filters (click + aria-pressed) | present (click + Enter/Space keyboard) | present | parity |
| Unread card interactive | NO (readout only) | NO (readout only) | parity |
| Overview per-card em-dash for unknown | n/a — legacy had no `known` flag | present | **better** |
| Filter buttons: All / Needs me / Waiting | present | present | parity |
| Search input | present | present | parity |
| Sort group: Status / Updated / Repository | present | present | parity |
| Sort direction toggle (↑/↓ marker, flips on repeat click) | present | present | parity |
| Sort first-direction per key (status asc, updated desc, repo asc) | present | present | parity |
| Secondary sort tiebreaker: newest first | present | present | parity |
| **Unknown-last on "Updated" sort** | NO — legacy sorts by `data-since`, unknown (0) rises to top | YES — React places unknown last | **better** (the port's own rule) |
| **View toggle: List / Grid** | **present** — icon buttons with pressed state | **missing** entirely | **missing** |
| View toggle persists to localStorage (`hellogitty-conv-view`) | present | missing | missing |
| Grid layout media queries (collapses on phone) | present | n/a (no grid view) | missing |
| Per-item attention styling (bold title on new/caution) | **present** (`.citem.attn .ctitle { font-weight: 700 }`) | **missing** — React doesn't set `attn` class or weight | missing |
| Item: pill ("Needs reply" / "Waiting") | present | present | parity |
| Item: title link | present | present | parity |
| Item: repo#number · why | present | present | parity |
| Item: ago column with `title=AgoTitle` | present | present | parity |
| Empty state copy | "No conversations yet. Comment on or get mentioned in …" | present (same intent) | parity |
| `prefers-reduced-motion` honouring | explicit `transition: none` | inherits from framework | parity (effective) |

### Summary

Three misses on /conversations (view toggle + its persistence, per-item
attn styling). The unknown-last-on-updated-sort is a real improvement.

---

## /alerts/your-move

### Behaviour

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "Your move · HelloGitty" | "frontend" | missing |
| Lede | present | present | parity |
| Overview: Total / Your / Incoming / Conversations | present | present | parity |
| Overview card with `.caution` border on Total | present | present (via `tone: 'caution'`) | parity |
| Three sections: Your / Incoming / Conversations | present | present | parity |
| Section heading with count | legacy headings use "Your pull requests and issues" + body range | present with explicit `(N)` suffix | **better** (count visible without reading the body) |
| Row: PR/Issue icon SVG | present (`<svg><use href="#i-pr|i-issue"/></svg>`) | missing — React uses ExternalLink icon on title only | missing (the type-identifying icon) |
| Row: kind pill ("PR"/"Issue") | present | present | parity |
| Row: title link | present | present | parity |
| Row: meta (repo, #number, why) | present | present | parity |
| Row: status chip with level colour | present | present | parity |
| Row: additional notes chips | present | present | parity |
| Row: quote block (`<blockquote>` with QuoteBy) | present | present | parity |
| Row: ago column with `title=Since AgoTitle` | present ("Since …") | present (title only) | different, lesser (no "Since" prefix) |
| Empty state per section | n/a — legacy hides empty sections entirely (`{{if .Work.You}}…{{end}}`) | present with explicit "No … right now" copy | different (defensible, arguably better — explicit "nothing here" beats a vanished section) |
| Known-is-not-empty gate | n/a | present | better |

### Summary

One real miss (PR/Issue leading icon), one small lesser (dropped "Since"
prefix on timestamps), one defensible difference (empty sections shown
with copy instead of hidden).

---

## /alerts/watched-claimed and /alerts/watched-closed

Same shape, same deltas — one row each table.

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | specific | "frontend" | missing |
| Lede | present | present | parity |
| Overview: count + total watched | present | present | parity |
| Section heading with count | present | present | parity |
| Row: `{Repo}#{Number} {Title}` all one line | present (title line includes the number) | present | parity |
| Row: Claimed / Fixed / Closed badge | present (colored pill) | present (colored pill, uses tokens) | parity |
| Row: ClaimDetail with "See the claim →" (URL) or inline text (non-URL) | present (both arms) | present (isUrl branch → link, else inline) | parity |
| Row: ChangedAt column | present (`{{utc .ChangedAt}}`, "Jan 02 15:04") | present (`.changedAt.slice(0, 10)`, ISO date like "2026-11-07") | different, lesser (loses time-of-day) |
| Recovery `.hint` paragraph | present ("Mark as Seen …") | present | parity |
| Known gate | n/a | present | better |

### Summary (both)

Two deltas: title, and `ChangedAt` format (lost time-of-day). The rest is
parity.

---

## /alerts/check-failed

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "Check failed · HelloGitty" | "frontend" | missing |
| Lede | present | present | parity |
| Overview: failed count + tracked total | present | present | parity |
| Row: repo name link to github.com/{Name} | present | present | parity |
| Row: `.Error` + `.ErrorRaw` secondary in `<small>` | **present** — legacy renders both | **missing** — React only has Error, no ErrorRaw | missing (GitHub's own words were in ErrorRaw) |
| Recovery `.hint` | present | present | parity |
| Known gate | n/a | present | better |

### Summary

One miss (ErrorRaw second line).

---

## /alerts/repo-dormant and /alerts/repo-slow

Same component in React (`RepoHealthAlert` parameterised).

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "Repo dormant" / "Repo slowing" · HelloGitty | "frontend" | missing |
| Lede | present | present | parity |
| Overview: count + tracked total | present | present | parity |
| Row: owner/name link | present | present | parity |
| Row: health badge | present (per-health colour: dormant→danger, slow→warn) | present (same mapping) | parity |
| Row: open + GFI counts | present | present (em-dash when `polled: false`) | **better** (polled-aware) |
| Row: age column `Last commit: Nd ago` | present | present ("Nd ago" only, no "Last commit:" prefix) | different, lesser (less labelled) |
| AgeKnown em-dash | present | present | parity |

### Summary

One miss (age-column label).

---

## /alerts/unresolved-threads

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "Unresolved threads · HelloGitty" | "frontend" | missing |
| Lede | present | present | parity |
| Overview: PR count + open-thread total | present | present | parity |
| PR heading: `{Repo}#{Number} {Title}` linked | present | present | parity |
| PR heading: "N open thread(s)" | present (pluralised) | present (pluralised) | parity |
| Thread: path (font-mono) + `@author (bot)` + date | present | present | parity |
| Thread: outdated flag | present (opacity + "outdated (code changed)" chip) | present (same) | parity |
| Thread: body excerpt (240 char) | present | present | parity |
| Thread: body link to GitHub comment URL | present | present | parity |
| Recovery `.recovery` with formatting guidance | present | present | parity |
| Known gate | n/a | present | better |

### Summary

Parity except for the title.

---

## /alerts/data-stale

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "Data is stale · HelloGitty" | "frontend" | missing |
| Lede | present | present | parity |
| Facts: last/next poll / interval / repo count | present | present with per-fact `known` em-dash | **better** |
| "What the last check could not reach" block (per-FailedRepo row) | present | present | parity |
| Recovery `.recovery` with cross-link to /alerts/check-failed | present | present | parity |

### Summary

Parity except for the title.

---

## /alerts/repo-flagged

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "Flagged · HelloGitty" (uses `.Labels.Flagged` when set) | "frontend" | missing |
| Lede | present | present | parity |
| Overview: flagged count / In pipeline / Tracked total — overview label uses `.Labels.Flagged` | present | present (same label threading via `d.labels.flagged`) | parity |
| Row: owner/name link | present | present | parity |
| Row: stage (if present) | present (`stage: X` font-mono) | present (same) | parity |
| Row: label badge (uses `.Label` if set, else "flagged") | present | present | parity |
| Recovery `.recovery` | present | present | parity |

### Summary

Parity except for the title.

---

## /alerts/stage-failed

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "Stage failed · HelloGitty" (uses `.Labels.Failed`) | "frontend" | missing |
| Lede | present | present | parity |
| Overview: failed count / In pipeline / Tracked total | present | present | parity |
| Row: owner/name link | present | present | parity |
| Row: `.Label` or "failed" badge (warn colour) | present | present | parity |
| Row: phase strip (abbrs, colored per state ok/failed/doing) | present (title="Name: State" tooltip) | present (same) | parity |
| Row: "Open the Actions runs →" link | present | present | parity |
| Recovery `.recovery` | present | present | parity |

### Summary

Parity except for the title.

---

## /alerts/api-low

| control | legacy | React | verdict |
|---|---|---|---|
| `<title>` | "API running low · HelloGitty" | "frontend" | missing |
| Lede | present | present | parity |
| APIKnown branch | present (hides overview when unknown, shows "GitHub hasn't reported a quota yet") | present (same, via known gate) | parity |
| Overview: Remaining / Used / Hourly limit | present | present | parity |
| Quota section: meter with fill width = APIPct | present | present | parity |
| Quota legend: "N% used" + "resets {ResetUTC}" | present | present | parity |
| Facts list: used/limit, reset, repos tracked, poll interval | present | present with per-fact `known` em-dash | **better** |
| Meter has `role="progressbar"` with aria-valuenow etc. | missing on legacy (plain divs) | present | **better** |
| Recovery `.recovery` with link to /settings | present | present | parity |

### Summary

Parity except for title. React is better on a11y of the meter.

---

## Rolled-up losses across the thirteen pages

Sorted by severity, most severe first.

1. **`/help` lost `/` shortcut** — the keyboard affordance that was the whole
   reason the search box has a visible `<kbd>/</kbd>` hint. The hint is also
   gone.
2. **`/help` search ranker is lesser** — stemmer → substring. Reproducible
   zero-hit miss on "adding repos", which is exactly the phrasing the
   `placeholder` text invites a user to type.
3. **`/feed` eye button missing** — every templated feed row had a watch/
   unwatch control; React renders none. The /watch endpoint still works; the
   UI to reach it from /feed is gone.
4. **`/conversations` view toggle (list/grid) missing**, with its localStorage
   persistence.
5. **`/help` copy buttons only on AI prompt**, not on every `<pre>` block in
   the docs.
6. **`/help` TOC scroll-spy (`aria-current`) missing.**
7. **`/help` search keyboard: `Enter` / `Escape` / `ArrowUp` / `ArrowDown`
   all missing.**
8. **`/feed` "Show acknowledged" no longer persists.**
9. **`/feed` Ack confirmation message gone** — the server's result map that
   says "N also marked read on GitHub" lands as a parsed response the React
   client ignores on success.
10. **`/feed` time-of-day lost to "Nh ago" rounding.**
11. **`/alerts/watched-*` time-of-day lost on ChangedAt.**
12. **`/alerts/check-failed` ErrorRaw subtext gone.**
13. **`/conversations` per-item attn bold-title cue missing.**
14. **Document `<title>` is "frontend" on all thirteen pages.**
15. **`/alerts/your-move` PR/Issue leading icon gone.**
16. **`/feed` fresh-row flash animation gone.**

## Real improvements kept (inventory, not justification)

- Per-section `known` gates on every alert page, `/feed`, `/help`'s About,
  `/conversations`.
- `/alerts/repo-dormant` + `-slow` em-dash for `polled: false` repos.
- `/conversations` unknown-last on the Updated sort.
- `/alerts/api-low` meter is now a real `role="progressbar"`.
- Explicit empty-state copy on sections that legacy hid (defensible).
- `/feed` stale-but-known banner.

These are real and I think they stay. The parity bar still has to be met
underneath them.
