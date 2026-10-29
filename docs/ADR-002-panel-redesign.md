# ADR-002: Dashboard Panel Redesign

**Status:** Proposed  
**Date:** 2026-10-29  
**Supersedes:** —

---

## 1. Context

User testing on v0.2.28 surfaced five pain points with the dashboard panels:

1. **Scroll hijacking.** Sized panels with `overflow: auto` capture scroll events before the page does. The user tries to scroll the page and a panel grabs the gesture instead.

2. **Micro-section overload.** "Your work" splits items into headed sub-groups ("Your move", "Waiting on others", "Finished", "Dismissed"). Conversations splits into "Needs your reply" / "Waiting on others". These force the user to jump between sections instead of scanning one list.

3. **Indicator noise.** Items carry too many inline badges — color dots (new/caution/hollow), "your move" tags, "needs you" tags, draft tags, approved tags — many redundant with section headers or not actionable. A lot of indicators are stale (the underlying state hasn't changed but the badge still draws the eye).

4. **Missing timing precision.** Timestamps show "2 days ago" but the user needs exact date-and-time to judge staleness. The precise value is hidden in a `title` attribute (hover-only, invisible on touch).

5. **No clear scan line.** Each row's layout — dot + title + inline tags + meta line + state badges + repo pill + time — creates a jagged reading path with no consistent left-to-right line.

---

## 2. Industry Research

### 2.1 How major apps handle panel-based triage

We studied six apps that solve similar problems — showing a list of items that need attention, letting the user quickly decide what to act on — and extracted the patterns that matter for HelloGitty.

#### Outlook (email — user's reference)

| Pattern | How Outlook does it | HelloGitty takeaway |
|---------|-------------------|---------------------|
| **Flat list** | Every message is one row in one list. No sub-group headers. Status encoded per-row: bold = unread, sender avatar = identity. | Remove "Your move" / "Waiting" section headers. Encode status per-row. |
| **Column discipline** | Three visual zones on every row: From → Subject + preview → Received. Consistent horizontal alignment. | Adopt fixed-zone row layout. |
| **Timestamps** | Precise: `02:56` for today, `Wed 22:01` for this week. Always visible text, same horizontal position (right-aligned). | Surface exact timestamps as visible text. |
| **Density controls** | Three density levels (Full, Medium, Compact). Compact cuts row spacing from ~8px to 4px and font from 12pt to 10pt. | Consider a density toggle if panels feel too spread or too tight. |
| **Focused Inbox** | ML-based split into "Focused" and "Other" tabs. User can turn it off ("Don't sort my messages"). | Overview cards as opt-in filters, not forced sections. |

*Sources: [Microsoft support](https://support.microsoft.com/en-us/outlook/mail/change-how-the-message-list-is-displayed-in-outlook), [Ablebits](https://www.ablebits.com/office-addins-blog/outlook-focused-inbox/)*

#### Gmail (email)

| Pattern | How Gmail does it | HelloGitty takeaway |
|---------|-----------------|---------------------|
| **Bold for unread** | Unread messages use bold subject + higher contrast. No colored dots or badges. Typography alone signals "new." | Replace color-dot attention markers with typographic weight. |
| **Inbox types as filters** | Default, Important First, Unread First, Priority Inbox — each a different sort/filter, not a different layout. The underlying row is identical. | Filters change what you see, not how rows look. |
| **Three density modes** | Default (attachment previews), Comfortable, Compact. Layout structure stays the same; only spacing changes. | Row layout is fixed; density is a separate concern. |
| **Thread grouping** | All messages in a thread collapse into a single line item with a count badge. | Group by thread when possible (conversations already do this). |
| **AI prioritization** | Gemini-powered "AI Inbox" surfaces priorities and summaries (2026). | Future consideration. Today: deterministic status, not ML ranking. |

*Sources: [Medium — 5 UI Lessons from Gmail](https://medium.com/design-bootcamp/5-smart-ui-lessons-from-gmails-inbox-every-designer-should-steal-18af33ca4818), [Email Analytics](https://emailanalytics.com/13-new-gmail-features-you-need-to-know-about/)*

#### Facebook (social feed + notifications)

| Pattern | How Facebook does it | HelloGitty takeaway |
|---------|---------------------|---------------------|
| **Single feed, no sub-groups** | The News Feed is one continuous list. Content type (post, share, reel, ad) is encoded per-card, not by splitting into sections. | One list per panel. |
| **Avatar + title + timestamp** | Every notification row: avatar → "X commented on your post" → relative time. Three zones, consistent layout. | Row layout: identity → action description → time. |
| **Cleaner tab notifications (Dec 2025)** | Meta's redesign moved the most-used features to the front of the tab bar and simplified notification tabs. | Put the most-used filters first in any filter bar. |
| **Severity tiers (design guidance)** | Smashing Magazine recommends high/medium/low attention tiers for notifications, with summary mode for low-priority batches. | Tier indicators: actionable (show inline), informational (show on hover), noise (remove). |

*Sources: [Meta announcement (Dec 2025)](https://about.fb.com/news/2025/12/making-it-easier-to-create-discover-and-share-content-on-facebook/), [Smashing Magazine](https://www.smashingmagazine.com/2025/07/design-guidelines-better-notifications-ux/)*

#### Instagram (mobile-first feed)

| Pattern | How Instagram does it | HelloGitty takeaway |
|---------|---------------------|---------------------|
| **Single-item focus** | Feed shows one post at a time. Reduces cognitive load from multi-item scanning. | On mobile/narrow viewports, show one item prominently instead of cramming rows. |
| **Lazy loading** | First items load immediately; the rest appear on scroll. | Already doing this via server-rendered HTML; no change needed. |
| **Minimal chrome** | The interface recedes so content leads. Very few persistent indicators. | Strip non-actionable badges. The item title is the content; let it lead. |
| **Chunked carousels** | One idea per slide reduces perceived effort (Cognitive Load Theory). | When a row has multiple flags, show the most important one; expand on hover for the rest. |

*Sources: [UX Design Insights (Unosquare)](https://www.unosquare.com/blog/ux-design-insights-overcoming-cognitive-biases/), [uxtigers.com](https://www.uxtigers.com/post/think-time-ux)*

#### Linear (issue tracker — closest peer)

| Pattern | How Linear does it | HelloGitty takeaway |
|---------|-------------------|---------------------|
| **Triage as a first-class surface** | Triage is a named inbox. Items go there before being assigned. The user's job is to move items out. | HelloGitty's "Your move" concept already works like triage. Make it the default sort (your-move items first). |
| **Flat issue list with inline status** | Issues show in a flat list. Status (Todo, In Progress, Done) is a colored icon at the left of each row, not a section header. | Per-row status indicator replaces section headers. |
| **Reduced sidebar visual noise** | Linear's 2025 redesign explicitly aimed to "reduce visual noise in the sidebar, tabs, headers, and panels" and "increase hierarchy and density." | Same goal: fewer indicators, stronger hierarchy. |
| **Dashboard drill-down** | Dashboard metrics (chart, table, single number) let users click into the underlying issues and act directly. | Overview cards already link to filtered views. Keep this. |
| **AI triage suggestions** | AI suggests assignee, labels, project. Visually distinct from human-set metadata (hover shows reasoning). | Future consideration. Today: no AI, just clear deterministic status. |
| **Hidden triage by default** | Project views hide Triage items unless the user enables a display option. Reduces noise for non-triage contexts. | On the dashboard, show only "Your move" items by default in the work panel; expand to "All" on click. |

*Sources: [Linear changelog (Jul 2025)](https://linear.app/changelog/2025-07-24-dashboards), [Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), [Linear Triage Intelligence](https://linear.app/now/how-we-built-triage-intelligence)*

#### Slack (messaging + notifications)

| Pattern | How Slack does it | HelloGitty takeaway |
|---------|-----------------|---------------------|
| **Bold for unread, badge for mentions** | Unread channels appear bold. Mentions add a numbered badge. Two tiers of attention using two visual signals. | Two tiers: bold title = new activity, pill badge = needs your action. |
| **Collapsed sections preserve signal** | A collapsed sidebar section still shows an unread badge on its header. One line replaces fifteen, without losing the "something happened" signal. | Dashboard panels can be folded (already supported) and should show a badge count when folded. |
| **Activity view as triage** | Slack's Activity tab is a centralized triage surface with its own badge. Filtering by channel or section is available. | The dashboard overview cells are HelloGitty's "Activity" equivalent — keep them as triage entry points. |
| **Subtle badge colors** | Slack changed from red to white notification badges (2022) to "catch attention without demanding it." | Avoid red/high-contrast badges for non-critical states. Reserve amber for "your move," use dim/muted for informational. |
| **Tiered channels** | Power users tier channels: Reply Needed → Review → Noise. Goal: summarize low-priority as counts, never promote them. | Group indicators by urgency, not by type. "Checks failing" (urgent) outranks "Review requested" (informational). |

*Sources: [Slack Activity view](https://slack.com/help/articles/19693583638803-Triage-notifications-in-the-Activity-tab), [Slack notifications guide](https://slack.com/help/articles/360025446073-Guide-to-Slack-notifications)*

#### GitHub (notifications + triage)

| Pattern | How GitHub does it | HelloGitty takeaway |
|---------|-------------------|---------------------|
| **Notification inbox** | All notifications in one inbox. Default filters: assigned, participating, review-requested, @mentioned. | HelloGitty's "Your work" is this inbox. Filters should match: assigned to you, review requested, mentioned. |
| **Bulk triage** | Select multiple → dropdown to triage (done, unsubscribe, save). Action buttons support batch operations. | Consider batch dismiss/restore for items. |
| **Mixed categories** | Inbox combines review requests, team requests, mentions, and subscriptions. Users report difficulty seeing what needs action. | This is the problem HelloGitty solves better — the "whose move" classification. Preserve it as the primary sort axis. |
| **Octobox pattern** | Third-party tool adds "archived" state: items stay out of inbox until new activity. | HelloGitty's "Dismissed" serves this role. Show dismissed items at the bottom or behind a filter, not in a separate section. |

*Sources: [GitHub Docs — Managing notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox), [Octobox](https://github.com/octobox/octobox)*

### 2.2 HCI principles applied

| Principle | Source | Application to HelloGitty |
|-----------|--------|--------------------------|
| **F-pattern scanning** | NN/g eye-tracking studies (cited by uxpilot.ai) | Place the most important signal (status) at the left of each row. Title next. Time at the right. Users scan left-to-right, top-to-bottom. |
| **Progressive disclosure (two levels max)** | Jakob Nielsen, 2006; NN/g research (cited by multiple sources) | Show actionable indicators inline (level 1). Show detail on hover/click (level 2). Never nest a third level. |
| **Information scent** | NN/g | Filter labels must predict what sits behind them. "Your move (3)" tells the user exactly what they'll see. Vague labels like "More" fail. |
| **Badge fatigue** | W3C Badging API spec | "Authors should reserve badges for states that merit attention or action." Rapidly changing values increase distraction. Stale badges that never clear train users to ignore all badges. |
| **5-6 indicator ceiling** | IBM Carbon Design System | "More than 5 or 6 indicators begins to tax a user." HelloGitty currently has ~8+ per row in the worst case. Reduce to ≤4 visible indicators per row. |
| **Notification severity tiers** | Smashing Magazine (Jul 2025) | High attention (needs your action now), Medium (informational, recent), Low (can wait or batch). Map HelloGitty indicators to these tiers. |
| **Self-contained notifications** | uxtigers.com (Oct 2025) | Each notification should let the user act without opening it. "John commented on your doc" with inline action beats "You have 1 new comment." HelloGitty rows should include enough context to decide: act, defer, or dismiss. |
| **Staleness decay** | W3C Badging API; Carbon Design System | An indicator that hasn't changed in 24+ hours should visually decay (reduce contrast, or remove entirely). Permanent badges become wallpaper. |

---

## 3. Design Principles (derived from research)

These principles guide every decision in this ADR and future panel work:

**P1. One list, one scan.** Every panel renders items in a single flat list. Status is encoded per-row, not by splitting into sections. (Outlook, Gmail, Facebook, Linear all do this.)

**P2. Fixed-zone rows.** Every row follows the same horizontal layout: Status → Content → Repository → Time. The eye learns where to look once and applies it to every row. (Outlook's three-column discipline; F-pattern scanning.)

**P3. Actionable indicators only.** An indicator appears inline only if the user can and should act on it now. Informational indicators appear on hover. Noise indicators are removed entirely. (Carbon's 5-6 ceiling; W3C badge guidance; Instagram's minimal chrome.)

**P4. Exact time, always visible.** Timestamps are visible text, not hover-only. Format degrades gracefully by age: precise time → day + time → date + time → full date. (Outlook's timestamp column.)

**P5. Page scrolls, panels don't.** The dashboard page is the scroll container. Panels expand to natural height and scroll with the page. No panel captures scroll events. (Scroll hijacking fix.)

**P6. Filters, not sections.** Overview cards and filter buttons change what's visible in the list. They don't create separate headed sections. Clicking "Your move (3)" filters the flat list to those 3 items. (Gmail's inbox types; Linear's display options; Facebook's tab bar.)

**P7. Triage-first default.** The default view shows "your move" items first, sorted by most recent activity. The user sees what needs action at the top without clicking anything. (Linear's triage surface; Slack's Activity view; GitHub's default filters.)

**P8. Staleness signals.** Indicators that haven't changed in 24+ hours visually decay — reduced contrast or opacity. Permanently lit badges train users to ignore all badges. (W3C guidance; Slack's subtle badge colors.)

**P9. Two disclosure levels max.** Level 1: what's visible in the row. Level 2: what appears on hover/click (a tooltip, expanded detail, or a peek card). Never a third nested level. (NN/g progressive disclosure research.)

**P10. Typography over iconography for status.** Use bold text for unread/new, a colored word pill for status ("Your move", "Waiting"), and a muted style for dismissed. Avoid color-dot systems that require learning a visual vocabulary. (Gmail's bold-for-unread; Slack's bold-for-unread.)

---

## 4. Decisions

### D1: Flatten all panel lists

**All panels** render items in a single flat list. Status distinction moves from section headers to per-row indicators:

| Current | Proposed |
|---------|----------|
| Section "Your move" heading + list of items | Single list. Each row has a status pill at the left. |
| Section "Waiting on others" heading + list | Same list. Status pill says "Waiting" in dim text. |
| Section "Finished" heading + list | Same list. Status pill says "Done" in green. |
| Conversations split: "Needs your reply" / "Waiting" | Same list. Status pill says "Needs reply" (amber) or "Waiting" (dim). |

Overview cards remain at the top as **filter triggers**: clicking "Your move 3" filters the flat list. They are not section anchors. (Principle P6.)

Default sort: status priority (your-move first → waiting → done → dismissed), then by most recent activity within each group. (Principle P7.)

### D2: Fixed-zone row layout

Every item row across all panels follows four horizontal zones:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ STATUS       Title of the item                      repo#123   Oct 27   │
│              PR · Changes requested · Checks failing            14:32   │
└──────────────────────────────────────────────────────────────────────────┘
```

| Zone | Width | Content | Alignment |
|------|-------|---------|-----------|
| 1. Status | ~80px fixed | Colored word pill: "Your move" (amber bg), "Waiting" (dim), "Done" (green), "Dismissed" (dim italic) | Left |
| 2. Content | Flexible | Line 1: Title (linked, bold if new activity). Line 2: Kind (PR/Issue) + actionable flags only (max 3) | Left |
| 3. Repository | ~120px | `repo#123` — short-form repo + number | Right |
| 4. Time | ~80px | Exact timestamp per D5. Two-line: date on top, time below, both visible | Right |

This replaces the current layout: dot → title → inline tags → meta → state badges → repo pill → relative time.

The row is a CSS Grid with fixed columns for zones 1, 3, and 4, and a flexible column for zone 2. (Principle P2.)

**New-activity signal:** Instead of a colored dot, the title text is bold (like Gmail/Outlook/Slack for unread). Once the user has seen the item (visited the link or the dashboard has refreshed with the same data), the title returns to normal weight. (Principle P10.)

### D3: Indicator tiering

Based on the severity-tier model (Smashing Magazine) and Carbon's 5-6 ceiling:

**Tier 1 — Inline (always visible in the row):**
These require the user to act. Max 3 shown per row; if more exist, show the top 3 by urgency and a "+N" count.

| Indicator | Visual | Urgency |
|-----------|--------|---------|
| Changes requested | amber pill | 1 (highest) |
| Checks failing | amber pill | 2 |
| Conflicts | amber pill | 3 |
| Unresolved threads (N) | amber pill with count | 4 |
| Review requested | dim pill | 5 |

**Tier 2 — On hover/peek (progressive disclosure level 2):**
Informational, not urgent. Appear in a peek card or tooltip.

| Indicator | When shown |
|-----------|-----------|
| Approved | Open PRs only |
| Draft | User's own PRs |
| Review decision detail | Any PR |
| Full thread list | Any conversation |

**Tier 3 — Removed entirely:**
Redundant or noise. These indicators currently exist and will be deleted.

| Indicator | Why removed |
|-----------|-----------|
| Color dots (new/caution/hollow) | Replaced by bold title (new) + status pill (urgency). Three-state dot vocabulary costs too much to learn. |
| "your move" tag | Redundant with status pill. |
| "needs you" tag in conversations | Redundant with status pill. |
| Draft tag (standalone) | Folded into status pill ("Draft") or Tier 2 peek. |
| Approved tag on merged/closed PRs | No action possible. |

**Staleness decay (Principle P8):** Any Tier 1 indicator that hasn't changed in 24+ hours gets reduced opacity (0.6). Hover restores full opacity. After 7 days with no change, it's visually identical to Tier 2 (shown on hover only). This prevents permanent amber badges that the user learns to ignore.

### D4: Fix scroll hijacking

- Remove `overflow: auto` from `.panel.sized` on the main dashboard. Panels expand to natural height; the page is the scroll container. (Principle P5.)
- On the dashboard, panels that would render very long (e.g., 50+ tracked repos) get a "Show all" toggle at 10 items, not overflow scroll.
- Add `scroll-padding-top: 60px` to `<html>` to account for the sticky header.
- Add `scroll-margin-block: 12px` to `.panel` elements for anchor-scroll breathing room.

### D5: Timestamp format

All panels show exact timestamps as visible text (Principle P4):

| Age | Format | Example |
|-----|--------|---------|
| < 1 hour | Relative | "12 min ago" |
| Today | Time only | "14:32" |
| Yesterday | "Yesterday" + time | "Yesterday 09:15" |
| This week | Day + time | "Mon 09:15" |
| This year | Date + time | "Oct 27 14:32" |
| Older | Full date | "2025-12-03" |

The `title` attribute retains the full ISO-8601 timestamp for copy-paste.

**Implementation:** The Go `Ago()` helper returns the formatted string. The `AgoTitle()` helper returns the ISO string for the `title` attribute.

### D6: Column-header sorting

On dedicated pages (Your work, Conversations, PR Pipeline), the filter bar includes sort controls:

| Sort axis | Default direction | What it does |
|-----------|------------------|--------------|
| **Status** | Your move first | Groups by urgency tier, preserving activity order within each tier |
| **Updated** | Newest first | Pure chronological sort |
| **Repository** | A-Z | Groups by repo, newest first within each repo |

The active sort column shows a directional arrow (▲/▼). Default: Status ascending + Updated descending (your-move items first, most recent activity at top).

On the dashboard, embedded panels always sort by status priority (your-move first) — no sort control. The dashboard is for triage; dedicated pages are for exploration.

### D7: Dashboard panel default view

Following Linear's "hidden triage by default" pattern:

- The "Your work" panel on the dashboard shows **only "your-move" items** by default, with a count label: "Your work · 3 items need you."
- A "Show all (12)" link expands to include waiting and done items.
- This reduces the default panel height and puts actionable items front and center. (Principle P7.)

---

## 5. Row layout comparison

### Before (current)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ● Title of PR ─────────── [your move] [changes req] [checks fail]     │
│    repo#123 · PR · Review: changes requested                           │
│                                                              2 days ago│
│                                                    ┌─repo/name #123──┐ │
└─────────────────────────────────────────────────────────────────────────┘
```
- 8+ visual elements per row
- Jagged reading path (dot → title → tags → meta → badges → pill → time)
- "your move" encoded twice (section header + tag)
- Relative time only
- Color dot requires learned vocabulary

### After (proposed)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Your move   Title of PR                        repo#123    Oct 27      │
│             PR · Changes requested · Checks failing         14:32     │
└─────────────────────────────────────────────────────────────────────────┘
```
- 4 zones, consistent on every row
- Left-to-right scan: status → what → where → when
- Status encoded once (pill)
- Exact time visible
- Bold title = new activity (no dot vocabulary)

---

## 6. Implementation Plan

Multi-PR effort. Each PR is one coherent step, independently mergeable and testable. PRs that touch different template files run in parallel; PRs that share a file are serialized.

| PR | Scope | Issue | Status |
|----|-------|-------|--------|
| 1 | Scroll fix + timestamp visibility | — | Merged (#129) |
| 2 | Flatten "Your work" page | #130 | Merged (#134) |
| 3 | Flatten "Conversations" page | #131 | Merged (#135) |
| 4 | Dashboard work panel + triage default | #132 | Merged (#136) |
| 5 | Indicator cleanup + staleness decay | #133 | Open |
| 6 | Remaining dashboard panels | #137 | Open |
| 7 | "Your repositories" page | #138 | Open |

PRs 6 and 7 were added after a post-merge audit of every template found two surfaces the original five-PR plan had missed: the dashboard's own Conversations and Your-repositories panels, and the standalone `web/your-repos.html` page. PR 4 was scoped to the dashboard work panel alone, so those panels kept the `.group` + `h3` pattern — including the "Asks something of you" micro-section that prompted this ADR.

### PR 1: Scroll fix + timestamp visibility
- Remove `overflow: auto` from `.panel.sized`
- Add scroll-padding/scroll-margin
- Update `Ago()` helper in Go to return formatted string per D5
- Surface exact timestamps as visible text in all panel rows
- **Files:** `internal/dashboard/handler.go`, `web/index.html`, `web/work.html`, `web/conversations.html`

### PR 2: Flatten "Your work" page
- Remove `.section` / `h2` sub-group headers
- Render all items in one `<ul class="wlist">` with a status pill per row
- Add status pill CSS (`.wpill`, colored by status)
- Keep overview cards as filter triggers
- Implement column-header sorting (D6)
- Apply indicator tiering (D3): remove noise tags, keep actionable flags
- Bold title for new-activity signal
- **Files:** `web/work.html`, `internal/dashboard/handler.go` (work page data)

### PR 3: Flatten "Conversations" page
- Same treatment as PR 2: flat list, status pill, column sorting
- Remove conversation section split
- **Files:** `web/conversations.html`, `internal/dashboard/handler.go` (conversations data)

### PR 4: Dashboard panels — flat list + triage default
- Apply flat-list + status-pill to dashboard's embedded "Your work" panel
- Default to showing only "your-move" items with "Show all" toggle (D7)
- Remove dot indicators (`.dot` elements), apply fixed-zone row layout (D2)
- Panels scroll with the page (D4)
- **Files:** `web/index.html` (panel templates + CSS + JS)

### PR 5: Indicator cleanup + staleness decay
- Remove deprecated CSS: `.dot`, `.group > h3`, section-related styles
- Implement staleness decay: indicators older than 24h get reduced opacity
- Verify no stale indicator logic in handler.go
- Consider extension parity (separate PR in extension repo if needed)
- **Files:** `web/index.html` (CSS), `internal/dashboard/handler.go` (staleness logic)

### PR 6: Remaining dashboard panels
- Flatten the Conversations panel (`Asks something of you` / `Quiet`)
- Flatten the Your-repositories panel (`Needs you` / `Waiting on contributors` / `Notifications`)
- Same pill vocabulary and triage toggle as PR 4 — no new variants
- Preserve the `data-module`, `data-term` and `data-v` hooks
- **Files:** `web/index.html`

### PR 7: "Your repositories" page
- Flatten the three `.section` blocks into one list
- Replace the remaining `.dot` indicators with status pills
- Replace the Newest/Oldest toggle with three-axis column sorting (D6)
- **Files:** `web/your-repos.html`

---

## 7. Consequences

### Positive
- **Faster triage.** One scan path per panel. The eye learns the four-zone layout once and applies it everywhere.
- **Less cognitive load.** Fewer indicators per row (≤4 vs. 8+). No three-state dot vocabulary to learn. Status encoded once, not twice.
- **Industry alignment.** Row layout and behavior match patterns users already know from Outlook, Gmail, Slack, Linear, GitHub.
- **Exact times visible.** No more hovering to find out when something happened.
- **No scroll traps.** The page is the scroll container.

### Negative
- **Section headers gone.** Users who used "Your move" / "Waiting" headers as landmarks lose them. Mitigated by overview cards + filters providing equivalent navigation.
- **Five PRs.** Significant template + CSS + handler changes. Mitigated by each PR touching a different page, enabling parallel execution.
- **Staleness decay is a new concept.** Needs tuning after deployment — the 24h/7d thresholds may need adjustment.

---

## 8. Alternatives Considered

1. **Keep sections, just add timestamps.** Doesn't fix cognitive load, indicator noise, or scan-line problems.
2. **Kanban columns.** Too much horizontal space for a side-panel or full page. Better for a dedicated board view than for triage.
3. **Full table layout (like Issues page).** Works for Issues because the data is uniform. Work items and conversations have variable meta (tags, quotes, state badges) that break fixed columns. The hybrid row layout (D2) gives column discipline without forcing a `<table>`.
4. **Keep color dots with fewer states.** Still requires learning a visual vocabulary. Typography (bold/normal) is universally understood without learning.
5. **AI-powered priority ranking (Gmail/Linear style).** Too early. HelloGitty's strength is deterministic "whose move" classification. AI ranking can be a future layer on top of this redesign.

---

## 9. Research Sources

- [Microsoft Outlook — Change message list display](https://support.microsoft.com/en-us/outlook/mail/change-how-the-message-list-is-displayed-in-outlook)
- [Outlook Focused Inbox](https://www.ablebits.com/office-addins-blog/outlook-focused-inbox/)
- [5 Smart UI Lessons from Gmail's Inbox](https://medium.com/design-bootcamp/5-smart-ui-lessons-from-gmails-inbox-every-designer-should-steal-18af33ca4818)
- [Meta — Making it Easier to Create, Discover, and Share Content (Dec 2025)](https://about.fb.com/news/2025/12/making-it-easier-to-create-discover-and-share-content-on-facebook/)
- [Smashing Magazine — Design Guidelines for Better Notifications UX (Jul 2025)](https://www.smashingmagazine.com/2025/07/design-guidelines-better-notifications-ux/)
- [Linear — Dashboards (Jul 2025)](https://linear.app/changelog/2025-07-24-dashboards)
- [Linear — How We Redesigned the UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Linear — How We Built Triage Intelligence](https://linear.app/now/how-we-built-triage-intelligence)
- [Slack — Activity view](https://slack.com/help/articles/19693583638803-Triage-notifications-in-the-Activity-tab)
- [Slack — Guide to notifications](https://slack.com/help/articles/360025446073-Guide-to-Slack-notifications)
- [GitHub Docs — Managing notifications from your inbox](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)
- [Octobox — GitHub notification manager](https://github.com/octobox/octobox)
- [Courier — In-app notification center design](https://www.courier.com/blog/in-app-notification-center-design)
- [W3C Badging API spec](https://w3c.github.io/badging/)
- [IBM Carbon Design System — Status indicators](https://v10.carbondesignsystem.com/patterns/status-indicator-pattern/)
- [UX Tigers — Think-Time UX (Oct 2025)](https://www.uxtigers.com/post/think-time-ux)
- [12 Dashboard Design Principles (uxpilot.ai)](https://uxpilot.ai/blogs/dashboard-design-principles)
- [Progressive Disclosure (IxDF)](https://ixdf.org/literature/book/the-glossary-of-human-computer-interaction/progressive-disclosure)
