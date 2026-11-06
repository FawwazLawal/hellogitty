# Changelog

Newest first. Each milestone has a semantic version and a codename; see
[VERSIONING.md](VERSIONING.md).

## Unreleased

## v0.2.0 (41) · Black Bombay (baby) · 2026-11-06

Tag `v0.2.41`.

- **A sixth pack, Oni, which is one identity in three appearances rather than three
  packs.** Three reference renders came in — a midnight indigo, a porcelain light, a
  vermilion on near-black — and the obvious reading was three packs. They are one
  direction drawn three times, so this ships them as one selectable pack whose dark,
  light and AMOLED appearances are Azure, Bone and Vermilion. The appearance control
  and the pack control stay orthogonal, every appearance has a real token block, and
  the registry guard that rejects half-finished packs passes honestly rather than
  being widened to let one through. Token names are shared across the three blocks
  and only their values differ, so a single rule can say `var(--pack-crimson)` and
  mean the right red in each. It is also the first pack with raster art rather than
  generated surfaces: five images, served from the binary, nothing fetched over the
  network.

- **The header art never reached the screen, in any of the three appearances.** The
  header element ships at roughly 21:1, the art was drawn at roughly 8.6:1, and
  `background-size: cover` on that pair crops sixty per cent of the art's height from
  the centre. The horizon all three bands had been composed around sat outside the
  visible slice, so every piece of scenery — ridgeline, torii, cat — was off screen
  and the band rendered as flat colour. It looked exactly like a pack with no art in
  it, which is why reading the stylesheet could not find it. The band now has real
  height and the art is anchored to its bottom edge at a width-pinned scale, which
  also holds the horizon still as the window widens.

- **Art that was referenced only from a comment, and art gated behind an attribute
  nothing sets.** Four finished images shipped embedded in the binary while every
  reference to them lived inside a comment block, so 83 KB of art painted nothing.
  Separately, every art rule in the light appearance sat behind `[data-art="ready"]`,
  added as a guard against serving a 404 before an asset landed — but nothing ever
  sets that attribute, so it guarded by never firing, which is indistinguishable from
  a pack with no art. A build-time test now enforces that every art URL the template
  paints names a file that is actually embedded. It went red on its first run, on a
  footer that had not been generated yet.

- **The keyboard focus indicator on the stat tiles was effectively invisible.** Those
  tiles suppress the native focus outline and draw their own one-pixel border in an
  accent token, so that border is the only focus indicator they have. It measured
  2.87:1 in dark and 2.08:1 in light against the surface behind it, where the standard
  asks for 3:1. A keyboard user tabbing through the rail could barely tell which tile
  was focused, and in light could not. The token reads as a quiet accent, and quiet is
  right for the decorative panel-heading rule it also draws — the same token was doing
  a second job where quiet is the defect. Three values move on lightness alone, holding
  hue and saturation, so each theme keeps its own colour; a test now holds every token
  block to the floor and ships with no exemptions.

- **A screenshot gate, because the failures in this work were feedback-loop failures.**
  Art was being authored by something that could not see its own output, and three
  consecutive fixes were each reasoned correctly and wrong on screen. The gate renders
  a captured page fixture — real markup, frozen content — so every difference is
  attributable to CSS, art or layout rather than to the board's data moving. Its
  tolerances were set by experiment rather than taste: the first, more defensible-
  sounding pair of numbers flagged zero of eighteen captures when a known layering bug
  was reintroduced, because a low-alpha overlay moves each pixel less than the
  threshold allowed. The accessibility gate alongside it is a per-rule ratchet rather
  than a wall, since a wall on a suite with existing violations is either permanently
  red or switched off within the week.

## v0.2.0 (40) · Black Bombay (baby) · 2026-11-06

Tag `v0.2.40`.

- **The header stopped sticking for anyone using Muertos V2, and nobody noticed.**
  That pack set `position: relative` on the site header to get a containing block
  its ornament needed. The base stylesheet makes that header `position: sticky`,
  and the pack's selector was the more specific of the two, so the pack won and the
  header scrolled away with the content. `sticky` is itself a positioned value and
  already provided the containing block, so the declaration bought nothing and cost
  the behaviour. It had shipped. Nothing caught it, because the pack's colours, both
  of its registries and its true-black block were all correct and the only symptom
  was a header that stopped staying put — invisible in a diff, and invisible in a
  screenshot of the top of the page. A test now rejects any pack that sets
  `position`, `display` or `overflow` on the header element.

- **A fourth visual pack, Azure Oni, whose surfaces are generated rather than flat.**
  Lacquered cobalt over obsidian, in three appearances: the default dark, a
  true-black mode that stays blue instead of going neutral, and a light mode designed
  from bone paper rather than inverted from the dark one. What makes it a pack rather
  than a palette is that its surfaces are made rather than filled — a wave pattern
  across the canvas and breaking along the bottom of the brand row, a riveted seam on
  the panel chrome, a lacquered sheen on the selected tab, a stone grain on the raised
  surfaces. All of it is CSS gradients and masked SVG written inline, so there are no
  image files, nothing is fetched over the network, and nothing animates. Contrast was
  measured across every rendered text pair in all three appearances before any of it
  was written.

- **A fifth pack, Azure Oni V2, where all six of the direction's named materials are
  real.** The first pack builds one of its source's eight texture recipes as a
  genuinely generated surface and approximates two more. This one builds them all:
  obsidian under the whole canvas, azure lacquer on the selected tab, ember haze on
  empty panels, a vertical armour seam with rivets on the chrome, a rim light that is
  the focus and hover language, and a brushed alloy micrograin. Both packs stay
  selectable; they are different objects, the way the two Muertos packs are. Four
  defects were found by reading the running page rather than the diff, including a
  focus ring that vanished entirely in high-contrast mode and a haze layer that was
  painting over the dashboard instead of behind it.

- **Three packs claimed a contrast ratio their colours did not have.** The same
  sentence appeared in three true-black blocks: that the panel rule was raised to
  clear 3:1 against black. Measured, it is true in one of them and false in the other
  two, one of which had shipped. The colours are fine — a soft inner hairline on a
  black canvas is a reasonable choice, and the standard exempts inactive container
  boundaries. What was wrong was a comment asserting a number, in a file where those
  comments are the record of what was measured; one false figure there makes the rest
  unciteable. The comments now say what is true and name the token that does carry the
  boundary, and a test computes the ratio instead of trusting the prose.


## v0.2.0 (39) · Black Bombay (baby) · 2026-11-05

Tag `v0.2.39`.

- **The four numbers that answer "where do I stand" now sit above the grid.** Needs
  you, open pull requests, repositories tracked and API headroom were split across
  three panel headings and the footer, so the one question you open the dashboard to
  ask was the one thing it never answered in one place. They are now a compact
  full-width row above the panels, and none of them is new: every figure was already
  computed server-side, so the rail adds no polling and no GitHub calls. Repos and
  API appear twice on purpose — the rail reads the number you want first, the footer
  keeps the breakdown and the gauge that goes hot at ninety percent. The rail joins
  the existing layout mechanism for full-width modules, so it shows and hides from
  the Layout dialog like anything else and no preset changed. Before the first poll
  arrives a tile shows a dimmed dash and says what it has not fetched yet, rather
  than a confident zero that would read as "quota exhausted" or "nothing waiting".

- **The Your work panel stops cutting a row in half.** It is the dashboard's answer
  to "what needs me" and it sits first, but the Everything preset pinned it to 360px
  while the queue behind it ran to thirty-eight items: three rows and a fourth sliced
  through its own title. A mid-row clip does not read as "scroll for more", it reads
  as a render fault. The preset heights are raised — Everything to 720, Contributor
  to 680, Maintainer to 600 — and any height applied to the panel is now rounded down
  to a whole number of rows plus its chrome, counting the borders and the sticky
  resize handle that were eating the last row's bottom edge. Rounding down means a
  height you dragged yourself stays within one row of what you chose. Heights you set
  by hand are otherwise untouched; only the presets moved.

- **An empty Conversations panel now tells you something.** One sentence sat in a
  280px box, so the panel was mostly void and the panels under it hung below that
  void instead of under the thing they follow. The empty state says three things
  instead: that nothing needs you, what the panel would hold and how much of it is
  sitting quiet, and where to go to see it. The panel also stops reserving its preset
  height when its body is nothing but that block, whether the template found nothing
  to show or filtering hid every row. For Muertos V2 users the Luz cameo follows the
  block rather than disappearing with the paragraph it used to be attached to — a
  decoration that stops appearing looks like one nobody added.

## v0.2.0 (38) · Black Bombay (baby) · 2026-11-05

Tag `v0.2.38`.

- **The pipeline page's top numbers now say what they count.** Eleven figures sat
  there as peers. "Opened" was a lifetime total and "Open" was right now, two words
  apart and reading as the same thing, and the six action figures below them were
  subsets of "Open" that could count the same pull request twice. Nothing on the page
  said which number contained which, so the eye had to guess, and the honest reading
  of eleven peers is that they are eleven independent facts.

  They are now three tiers that say their own relationship. A muted lifetime row
  (opened, merged, closed without merging — relabelled so it reads as the complement
  of merged rather than as "shut right now" — and the merge rate). One large card for
  open now, with "your pull requests still in flight" beside the digit so it cannot be
  misread as "opened". Then, under a heading that says "of those, waiting on", the
  four action counts as what they always were: filters of the card above them.
  Approved and draft left the rail for the table's filter chips, because they are
  states rather than things waiting on you. No counter's arithmetic changed; this is
  what the page says about its own numbers.

- **The pull requests table has a Last activity column.** It is the newest of four
  things — a human comment or review, a bot review, a review-thread reply, or our own
  last commit on the branch — and deliberately not GitHub's `updated_at`, which moves
  when someone edits a label. Shown as "4m ago", with the exact UTC time on hover, and
  re-rendered every 30 seconds so the relative label does not drift between refreshes.
  A row with none of the four shows an em dash and sorts to the bottom rather than
  pretending to be from 1970. The column hides and shows from a toggle beside the
  filter chips, remembered per browser.

- **A red CI entry now changes its id when its checks change.** The id was built from
  the commit alone, so a pull request that went from one failing check to three kept
  the same entry: the board had already told you about this one, and a reader who had
  seen it had no way to learn that what was failing was not what had failed before.
  The id now carries a short digest of the failing and stopped check names, sorted
  first so that the same set always hashes the same way. New names, new id, new entry
  — and an unchanged set stays quiet, which is the other half of the contract.

- **Every pull request runs CI, whatever it targets.** The workflow's `pull_request`
  trigger was filtered to base `dev`. A pull request opened against any other base ran
  nothing — not pending, not skipped, never created — so its status box was empty, and
  an empty box reads as fine; retargeting it to `dev` afterwards does not re-fire the
  trigger, so it stayed empty. One branch reached review that way with a failing test
  nobody had seen. The filter is gone. The `push` trigger keeps its `dev`/`main` list,
  which is what that one is for.

- **A fourth visual theme pack: Muertos V2, "La Noche Viva".** Three designed
  appearances — cream paper for light, aubergine and plum for dark, true black for
  AMOLED — with pack-scoped ornament: a papel picado strip across the site head, a
  violet medallion on the active quicknav tab, a left-edge ribbon on panels in light,
  faint paper grain on the light canvas, and Luz, the Signal Keeper, as an empty-state
  cameo. The existing muertos pack is untouched; both sit alongside the appearance
  setting rather than replacing it.

  The semantic triad holds, which is the part that matters: violet carries identity,
  marigold stays reserved for caution and jade for good news, and the decorative
  marigold, pink and jade in the ornament never land on a status surface. Every
  decorative rule is scoped to the pack and attached to single elements, so no row pays
  for a filter or a blur. The grayscale check and the palette that was tried and
  rejected are written down in the implementation report.

## v0.2.0 (37) · Black Bombay (baby) · 2026-11-05

Tag `v0.2.37`.

- **A check that was cancelled is no longer reported as a failure.** GitHub gives a
  check run one of nine conclusions and the board named four of them, sending the
  other five to "failed". Two of those five are not failures: a cancelled run was
  halted, by hand or by a newer push, and a stale one belongs to a merge commit that
  no longer exists. Neither says anything about the code, and the board sent you to
  open a log that held no failure — on the row, in the peek panel, and in
  `inbox.json`, which is the line that leaves the machine.

  A stopped check still blocks a merge, so it is still your move and it still raises
  an inbox entry; dropping it was the shorter thing to describe and it would have
  quietly hidden a pull request that cannot merge. What changed is the words:
  "Stopped: build; re-run for a verdict" in place of "Failing: build". `TIMED_OUT`
  deliberately stays a failure, because a run that spent its whole budget without
  reaching a verdict did fail and there is something to fix. Where real failures
  stand beside stopped ones the row names the failures and counts the stops —
  upstream matrix job names run past a hundred characters each and two named lists do
  not fit a row — and the peek panel, which exists for what the row has no room
  for, names them.

- **A merge bot's own merge is no longer counted as a rejection.** A project whose
  bot rebases and pushes instead of using the merge button leaves the pull request
  closed and unmerged, which is the same state a refusal leaves, so every one of
  those merges was being read as a turndown. The filter meant to catch exactly this
  was written for a person saying it in prose — "merged manually",
  "cherry-picked as `9f3a2b1c`" — and caught three rows in four thousand. A bot
  writes a heading instead, or a plain line about landing one commit of a stack.

  Both wordings are now matched, anchored to the start of a line because that is how
  a bot announces and not how anyone writes a sentence. 309 automated merges leave
  the count: 42% of every turned-down row that carries a closing comment, which are
  the only rows anything can be learned from. The error ran in the worst available
  direction, since those rows feed the rejection reading — the tool had been
  teaching us to avoid the things that in fact worked.

  The second wording turned up the morning after the first one shipped. A filter
  built by reading prose is only ever as complete as the last sentence someone's bot
  was taught to write, and the code now says so where the pattern is: checking
  whether the change actually landed is the durable answer, and this is not it.

## v0.2.0 (36) · Black Bombay (baby) · 2026-11-03

Tag `v0.2.36`.

- **The inbox file's interval field says what it measures.** It was called
  `poll_interval_minutes` and carried the work-board refresh cadence, five minutes,
  while the snapshot file used the same name for the repository poll, sixty. Both
  were honest about their own loop and the shared name was wrong about one of them —
  and wrong in the direction that makes the data look fresher than it is. The inbox
  field is now `refresh_interval_minutes`, which is the loop that actually writes
  the file, and `schema_version` moves to 3 so a reader can tell which it has.
- **Your own finished work leaves the inbox.** More than half the file had become
  merges and closures in your own repositories — work you did yourself, with nothing
  left for anyone to do, re-read on every pass. Finished work in *other* people's
  repositories stays: a pull request of yours merged upstream is the outcome worth
  knowing about, not noise. The filter is the narrow one, finished *and* yours, and
  the matching is case-insensitive on the owner because that is how a repository name
  can differ from the login that owns it.
- **A new `/health` endpoint answers whether the service is actually working.** The
  dashboard renders from the last good data, so a page that loads proves nothing
  about the loops behind it; twice the only way to find a half-dead service was to
  read the log and compare timestamps by hand. `GET /health` returns 200 when every
  check passes and 503 when any one fails — the status code alone is a usable answer
  — with a line per loop and per output file in the body.

  Each loop is judged against its own cadence rather than one shared timeout: stale
  past two and a half times its own interval, so a missed tick is tolerated and two
  in a row are not. A single global threshold would have called a dead five-minute
  loop healthy for an hour. A file counts as current only when its last write
  actually put content on disk — a write skipped because the board was incomplete,
  or one that errored, reads false with the reason in words. A file the service was
  never asked to maintain is left out of the list entirely rather than reported as
  fine.

  A first cycle still in flight is not a stopped loop, so a service that has only
  just started is not reported as broken: on a long repository list the first pass
  takes many minutes, and anything acting on a 503 would have restarted the process
  and begun that pass again.

## v0.2.0 (35) · Black Bombay (baby) · 2026-11-03

Tag `v0.2.35`.

- **A failed refresh no longer overwrites the inbox file.** When GitHub refused part
  of a refresh, the board on screen was already known to be new and incomplete — but
  the inbox file and `unreplied.json` were written from it anyway. A reader got a
  shorter list with nothing on it to say the list was short, and the entries that
  dropped out looked resolved. Both writers now stop and keep the last good contents,
  saying in the log why they wrote nothing. The previous release taught the board to
  tell "new and incomplete" from "old but whole"; this is the half that stops the
  distinction being thrown away on the way to disk.
- **Every inbox entry says whose move it is.** A new `move` field on each entry:
  `you` when the entry is waiting on you, `them` when the other side has it, `done`
  when it is finished. It is the same answer the work board already computed, so
  nothing has to re-derive it from a summary line. Entries that are nobody's move by
  nature — a cross-reference, an overlap report, a new-issue digest — carry no `move`
  at all rather than a guessed one. Review-thread entries also gained `replied` and
  `thread_url`, and comments and reviews now carry `author_association`.
- **A bot's findings say whether you have answered them.** `pr_bot` is one entry for
  a whole pull request, so its `replied` has to speak for every finding at once: it
  is true only when every finding came from a review thread and your comment is the
  newest in all of them. One unanswered thread, or a finding with no thread to answer
  in — a standing changes-requested review, an "actionable comments posted" tally —
  and it reads false. `thread_url` points at the newest thread still waiting on you.
  Absent, as before, means nothing here came from a review thread and `move` is the
  field to read.

## v0.2.0 (34) · Black Bombay (baby) · 2026-10-31

Tag `v0.2.34`.

- **The dashboard has a skip link and a main landmark.** It was the last page in
  the product without either, and the page where it matters most: the densest one,
  the most to tab through, and the one that opens first. The grid became the
  landmark rather than gaining a wrapper around it — every selector already reached
  it by `.grid` — so the panel drag and resize machinery is untouched.
- **A partial board no longer calls itself the previous one.** When GitHub refused
  part of a refresh, the board on screen was new and incomplete while the page said
  the last refresh had failed and this was the previous list. "Previous" means old
  but whole: wait, or look again later. The truth was current but holed: what you
  are reading is missing things. The two call for opposite responses, and the page
  asserted the one that was not true. The tracker records which actually happened
  and the page says so, with nothing inferred from timestamps.

## v0.2.0 (33) · Black Bombay (baby) · 2026-10-30

Tag `v0.2.33`.

- **The alert row is gone.** Eleven tiles across the top of the dashboard, at equal
  weight, mixing your work with repository health, system health and a watchlist.
  On a real board nine of them read zero or "not checked yet" and the two with
  content truncated into fragments. The dashboard now opens on the work that needs
  you. The count has not gone anywhere — the Your work heading already carries it.
- **A panel whose work is all done says so.** Triage mode hides everything that is
  not your move, and a panel with items but none of them yours drew a heading and
  280px of nothing: the best news a panel can give, rendered as something that
  reads like a failed load. It says "Nothing here needs you" now.
- **Amber means one thing again.** 103 elements wore the caution colour and seven
  of them meant work that needs doing. `--head-accent` was defined as the same
  value as `--caution`, so every panel heading wore the alert colour, and a closed,
  resolved issue wore the same fill as Your move. Repository health, age bars and
  quota gauges move to their own ramp: they are conditions, not tasks.
- **The light theme stops inverting the alert signal.** A lit cell set its border
  to its own fill, which measures 1.00:1 against the page there, so a lit cell had
  no edge at all while a quiet one kept a 1.50:1 border — lit read as less
  important than unlit. Lit state is carried by a 4px edge now, 3.24:1.
- **Every alert has somewhere to go.** Five new pages — unresolved threads, data
  stale, repositories flagged, stage failed, API low — each with an orienting
  sentence, the counts and what to do about it. The two loudest numbers on the old
  row went nowhere at all when clicked.
- **Skip links and landmarks** on every page outside the dashboard, with the rules
  in the shared stylesheet rather than copied into fifteen templates.
- **The controls you sort and triage with are big enough to hit.** Column sorts
  were 15px tall against a 24px minimum, the work sorts 22px, the triage toggle
  20px. The high-severity badge was white on orange at 3.85:1.
- **The header fits the window.** It overflowed every route at phone width, the
  whole of it the control cluster at 424px inside a 390px viewport.
- **The Chrome extension gets the board fix from v0.2.32**: its eight searches now
  go in their own requests, so check status stops nulling out there too.

## v0.2.0 (32) · Black Bombay (baby) · 2026-10-30

Tag `v0.2.32`.

- **The board knows its check status again.** The eight searches behind Your work rode in a single
  GraphQL request and shared one resource budget. When it ran out, GitHub did not reject the
  query — it returned the rows and quietly nulled the expensive fields, so a pull request with
  failing checks showed no check status at all, which reads exactly like one that has no CI.
  Measured on a real board: 175 of those errors in a single response, and a check state present on
  **1 item out of 79**. Each search now goes in its own request: no errors, check state on **33 of
  79**, at the same cost per refresh.
- **The security panel keeps what it has.** A blip at the CVE feed used to blank it. It now keeps
  the last good list and shows the error beside it, as the work board does, and leaves the fetch
  time alone so stale data cannot read as fresh.
- **Smaller fixes in the same panel**: a refresh no longer discards the per-repository tips; long
  descriptions are cut by rune rather than by byte, so they cannot break a character in half; and
  the language tips match whole words, so a repository called `tiangolo` is no longer told to run
  `govulncheck` and `django` is no longer told to run it as well as `pip-audit`.
- **First tests for `internal/security`**, covering the parse, the severity order, the cap, the
  cache's hold-off and the tip generator. The parse is now reachable from a test at all, which it
  was not before.

## v0.2.0 (31) · Black Bombay (baby) · 2026-10-29

Tag `v0.2.31`.

- **A second theme pack, with three appearances**: Muertos, a Halloween and Día
  de los Muertos palette, selectable in Settings. Beside Light and Dark it adds
  **AMOLED** — true black, offered only while a pack that defines it is active.
  Violet carries the pack's identity and marigold is reserved for work that
  needs doing, so the only warm light on the page is the thing waiting on you.
- **A third appearance for the theme switch**: `data-theme` gains `amoled`, a
  variant of dark and never of light. Its button is added by the shared theme
  script rather than by each page, so every page gets it from one place, and a
  pack without it falls back to the dark it varies.
- **The side panel reaches it too.** The extension already rendered the matching
  theme group, so the script it lifts from the dashboard offers AMOLED there
  whenever the pack is on. Extension bumped to 0.2.30.
- **Theme packs are documented**: `docs/THEME-PACKS.md` carries the five-step
  recipe for authoring one, the rule that a pack may re-hue the status colours
  but must keep their order and separation, and the build constraints that stop
  the dashboard and the extension drifting apart.
- **A test guards the two pack registries.** A pack is declared both in the
  dashboard and in the Settings gallery, and nothing checked the two agreed, so
  a pack could be selectable but unlabelled, or labelled but unpickable. It also
  fails a pack missing its light or true-black block.
- **Fixes**: the Settings picker labelled every pack "(pinky v2)" and drew its
  active outline in pink whichever pack was chosen; AMOLED now also reaches the
  Settings page's own theme control.
- The ADR-002 implementation plan now matches what shipped, including dropping a
  bullet that still told the reader to make the change that had broken resized
  panels.
- `unreplied.json` and the extension's `dist/` are no longer left untracked.

## v0.2.0 (30) · Black Bombay (baby) · 2026-10-29

Tag `v0.2.30`.

- **Layout presets**: the built-in layouts carry curated panel sizes, and a
  layout you arrange yourself can be saved under a name, then reloaded, renamed
  or deleted. Built-ins stay read-only. A Reset button restores the defaults of
  whichever preset is active — Contributor resets to Contributor, Program to
  Program — and stays disabled while the layout still matches it, so it doubles
  as a sign that something has been changed.
- **Stale indicators quieten with age**: an amber flag on a row nobody has
  touched in 24 hours drops to 0.6 opacity; after 7 days it drops to 0.45 and
  loses its amber border, reading as history rather than urgency. Hover or focus
  restores it. Nothing is hidden at any age — a PR whose checks have been
  failing for ten days still has failing checks.
- **Extension side panel matches the dashboard**: flat lists with status pills,
  the same tiered timestamps, the triage default with its `Show all (N)` toggle,
  and the staleness decay. Extension bumped to 0.2.28.
- **Cleanup**: the last of the pre-redesign vocabulary is gone — the `.group`
  CSS and the two script lookups that kept its count badges in step, and the
  hidden `movetag` span the status pill replaced. The orphan guard now fails if
  any of them comes back.
- ADR-002 records the two places the shipped behaviour departs from the draft:
  decayed indicators are never hidden, and staleness is measured on the row
  rather than on each flag.

## v0.2.0 (29) · Black Bombay (baby) · 2026-10-29

Tag `v0.2.29`.

- **Panel redesign (ADR-002)**: every panel list is one flat list with a status
  pill on each row, replacing the micro-section headings ("Your move", "Waiting
  on others", "Asks something of you") and the three-state colour dots. Covers
  the Your work, Conversations and Your repositories pages and their dashboard
  panels. A row reads in four fixed zones: status, title, repository, time.
- **Exact timestamps**: `Ago()` returns the time itself rather than only a
  relative phrase — `14:32` today, `Yesterday 09:15`, `Mon 09:15`,
  `Oct 27 14:32`, then a full date for anything older. The ISO-8601 string
  stays in the `title` attribute.
- **Triage default**: dashboard panels open showing only what needs you, with a
  `Show all (N)` toggle for the rest.
- **Column sorting**: Status, Updated and Repository on the dedicated pages. On
  the dashboard the sort labels now sit over the columns they sort, with the
  timestamp label above the timestamps.
- **Scrolling**: panels grow to their natural height and the page keeps the
  scroll. A panel you resize yourself still scrolls inside the height you gave
  it, heading pinned.
- **Fixes**: resized panels had a fixed height but no scroll container, so
  anything past the drag height was unreachable; a leftover `.dot` lookup threw
  on every dashboard that had work to show, which silently killed panel
  collapse, the layout dialog, resizing, sorting and the triage default; status
  pills stretched to the full row height instead of drawing as pills.
- **Quieter rows**: the end-of-row repository chip no longer uses the amber the
  design reserves for work that needs doing.
- **Favicon**: dark charcoal with amber brackets.
- ADR-002 recording the research and decisions behind the redesign is now in
  `docs/`.

## v0.2.0 (28) · Black Bombay (baby) · 2026-10-29

Tag `v0.2.28`.

- **Extension visual parity**: added header bottom border and work-sort
  buttons to match the dashboard. Extension bumped to 0.2.27.

## v0.2.0 (27) · Black Bombay (baby) · 2026-10-29

Tag `v0.2.27`.

- **Extension sync to v0.2.26**: Chrome extension bumped to 0.2.26. Toolbar
  removed from board.js, dead CSS cleaned up in extension.css, build.sh check
  fixed. Updated files copied to monitor/extension/.

## v0.2.0 (26) · Black Bombay (baby) · 2026-10-29

Tag `v0.2.26`.

- **Inbox enrichment**: fixed bogus `0001-01-01` timestamps by making
  `comment.CreatedAt` a `*time.Time` with zero-time fallbacks. Added
  `schema_version`, `first_seen_at` and `age_hours` staleness indicators.
  Entries now carry full `body`, `review_state`, `path` and
  `author_association` fields.

## v0.2.0 (25) · Black Bombay (baby) · 2026-10-29

Tag `v0.2.25`.

- **PR Pipeline page**: renamed from "Pipeline" to "PR Pipeline", moved earlier
  in the nav (after Your work). Six new action stat cards show review-requested,
  changes-requested, checks-failing, approved, conflicts and draft counts.
  New repo filter and pending-work filter added to the PR table.

## v0.2.0 (24) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.24`.

- **Unreplied thread tracker**: new `internal/unreplied` package writes
  `unreplied.json` after every board refresh, listing each open PR's review
  threads where the configured user has not replied. Configurable output path.
- **Dashboard toolbar removed**: the search bar, All/PRs/Issues filter,
  Needs-me checkbox, and Group-by controls are removed from the dashboard —
  dedicated Issues and PR Pipeline pages cover that functionality.

## v0.2.0 (23) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.23`.

- **Unresolved threads alert cell**: new alert cell lights up when any of your
  open pull requests have unresolved review threads, with the count and PR names.
  Glossary entry added. Also available in the Chrome extension.

## v0.2.0 (22) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.22`.

- **CI badge**: build status badge added to README.
- **Issue and PR templates**: bug report, feature request and pull request
  templates for contributors.
- **Security policy**: SECURITY.md with vulnerability reporting guidelines,
  response timeline and security design overview.
- **GitHub Releases**: release notes added for v0.2.15–21.

## v0.2.0 (21) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.21`.

- **Contributing guide**: CONTRIBUTING.md with setup instructions, development
  workflow, code style and submission guidelines.

## v0.2.0 (20) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.20`.

- **CI workflow**: GitHub Actions build and test pipeline for the Go project —
  `go build`, `go vet` on Ubuntu, `go test` on Ubuntu and macOS.

## v0.2.0 (19) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.19`.

- **CSS consolidation**: colour custom-property definitions deduplicated from four
  blocks to one per theme context; duplicate CSS rules and IDs removed.
- **Collapse button fix**: icon state preserved correctly on toggle.
- **Settings cleanup**: inline styles moved to CSS classes; wording aligned with
  dashboard terminology.
- **Type size floor**: minimum font-size raised to 11px across the board.
- **Button CSS**: remaining near-duplicate button styles merged into the shared
  bordered-button rule.
- **Clock-add select toggle**: fixed JS bug where style.display conflicted with the
  hidden attribute.

## v0.2.0 (18) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.18`.

- **Mascot responsive**: mascot image hidden below 900px to prevent tab overlap.
- **LED clock theme support**: clock text uses theme-aware colours; pink theme
  gets its own clock tint in both light and dark modes.
- **Sort arrow consistency**: all sort indicators use the same ▲ asc / ▼ desc
  convention across Your Work and Tracked Repos.
- **Input border contrast**: borders raised to at least 3:1 contrast in all themes.
- **Settings fixes**: sidebar gap under header closed, aria-current on active tab,
  dismiss button always visible, keyboard shortcut off-switch added.
- **Accessibility**: field labels for screen readers, hover-only controls made
  always reachable, arrow keys on repo tabs.
- **Smart auto-reload**: page reload deferred while the user is typing in a field.
- **Button CSS consolidation**: ~15 near-duplicate button styles merged into a
  shared rule set.

## v0.2.0 (17) · Black Bombay (baby) · 2026-10-28

Tag `v0.2.17`.

- **Pink theme status palette (pinky v2)**: status colours are now a distinct
  pink-family temperature gradient — blush rose (ok), warm coral (caution),
  deep magenta (danger) — readable at a glance in both pink-light and pink-dark.
- **Settings panel fixes**: theme picker now persists correctly, Auto/Light/Dark
  switch works on the Settings page, dead Layout preset and Compact cells
  controls removed, all toggles have screen reader labels.
- **Header/layout/keyboard**: Collapse and Layout buttons hidden on subpages
  where they don't apply, phone-width horizontal scroll fixed, Enter/Space on
  alert cells and arrow keys on repo tabs, empty alert cell contrast raised.

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
