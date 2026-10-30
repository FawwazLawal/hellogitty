# Theme packs

**Status:** Reference
**Date:** 2026-10-29

A theme pack is a colour overlay on top of Auto/Light/Dark. The system is already in the tree
— one pack (`pink`) shipped in v0.2.15 — and this file is what the system looks like, so the
next pack can be authored without reverse-engineering `web/index.html`.

Line references point at `dev` at the time of writing. Treat them as pointers to the right
area, not immovable addresses.

---

## 1. The two axes

Both live on `<html>` and are applied before first paint, so there is no flash:

| Axis | Attribute | localStorage key | Values |
|---|---|---|---|
| Appearance | `data-theme` | `hellogitty-theme` | absent (follows system) · `light` · `dark` · `amoled` (see §5) |
| Visual pack | `data-visual-theme` | `hellogitty-visual-theme` | absent (default) · a pack id |

The pre-paint initialisers are at `web/index.html:533` (appearance) and `web/index.html:535`
(pack). The switch handlers that run after load are in the `theme-js` `{{define}}` block
starting at `web/index.html:623`.

---

## 2. The five-step recipe

A pack is five edits. Nothing else: no new file, no new JS module, no build step. The shipped
`pink` pack is the reference implementation — read it first.

1. **Dark token block** in `web/index.html` beside `web/index.html:579`:
   `:root[data-visual-theme="<id>"] { … }`. About a dozen token declarations plus
   `color-scheme: dark`.
2. **Light token block** at `web/index.html:592`:
   `:root[data-theme="light"][data-visual-theme="<id>"] { … }`, with `color-scheme: light`.
3. **Entry in `VISUAL_THEMES`** at `web/index.html:641`:
   `{ label: "(name)" }`. The label replaces `(baby)` beside the version in the header.
4. **Swatch entry** in the `VISUAL_THEMES` array at `web/settings.html:580`: `id`, `name`,
   `desc`, an optional `badge` with its colours, and the four swatch preview colours
   (`bg`, `dot`, `bar1-3`, `nameCl`, `descCl`). This drives the picker grid at
   `web/settings.html:305`.
5. **Decorative rules, if any** — each one prefixed with its own
   `:root[data-visual-theme="<id>"]` selector. The pink pack's decorative rules begin near
   `web/index.html:773`. See §6 for the budget.

The two registries (the object in `index.html`, the array in `settings.html`) are hand-synced
and have different shapes. Nothing enforces that they agree. Keep both in step; losing an
entry in one is a silent half-break.

---

## 3. The semantic triad rule

**The most important thing in this document.**

`--caution` is amber (`#e9aa3b`). It means *work that needs doing* and is referenced over
thirty times across the dashboard. PR #149 deliberately took amber off the end-of-row
repository chip because the colour is reserved. A pack that re-tints every surface in a
single hue family destroys that reservation at the scale of the whole interface.

A pack **may** change the hue of `--nom`, `--caution` and `--warn`. A pack **must** preserve:

- Their ordering: ok → caution → danger, visually distinguishable from each other.
- Their contrast separation, measured against the pack's **own** themed background and not
  the default one.
- A hue gap wide enough that "needs doing" and "something is broken" don't collide.

The shipped pink pack states the precedent in a comment at `web/index.html:590`:

> Same temperature gradient: dusty rose (ok) → vivid coral (caution) → deep magenta (danger).

Pink does not preserve amber. It re-tints the triad while keeping the temperature
relationship between its three members. That is the pattern. If a candidate palette can't
hold the triad apart against its own panel colour, pick a different candidate — don't
compress the gap.

---

## 4. The three build constraints

`monitor/extension/build.sh` ships the Chrome side panel by lifting the dashboard's inline
`<style>` block into `dashboard.css` with `awk`:

```sh
awk '/<style>/{f=1;next} /<\/style>/{f=0} f && !/\{\{/' web/index.html > dashboard.css
```

It then asserts the result still contains `--caution-fill`, `.wi blockquote`, `.head-right`
and `visual-theme`, and **fails the build if any `{{` survives** in the lifted output.

Three rules follow and are not negotiable:

1. **Theme CSS stays inside that `<style>` block, or inside a `{{define}}` CSS block
   (`base-css`, `header-css`, `feed-css`) that `<style>` includes via `{{template}}`.** CSS
   moved to a separate file never reaches the extension, and the two surfaces drift apart —
   which is the problem PRs #152 and #153 were spent closing.
2. **Every line of theme CSS must be static.** A line containing a `{{...}}` action is
   silently dropped by that `awk` filter, with no error — the rule is simply absent on the
   extension side.
3. **`bash build.sh` passing is part of Definition of Done** for any theme change. The
   `check()` assertions near the end of that script are the regression test.

---

## 5. The `amoled` appearance

A pack may offer a **third appearance**: true black, a variant of dark and never of light.
It is offered only when the active pack declares it. The worked example is on
`feat/muertos-theme-pack` (commit `cea63c3`); the pattern is:

- The pack entry in `VISUAL_THEMES` adds `amoled: true`:
  `{ label: "(muertos)", amoled: true }`.
- A short AMOLED-only block overrides a few ground tokens for the pack:
  `:root[data-theme="amoled"][data-visual-theme="<id>"] { … }`. The muertos example collapses
  the panel fill into the page and raises `--rule` to clear 3:1 against black, since the
  border becomes the only thing marking the panel.
- The `AMOLED` button is injected by the shared `theme-js` block when a pack with
  `amoled: true` is active, so one change covers every page template and the extension.
  Losing the pack falls back to the dark the amoled variant varies.
- The pre-paint initialiser accepts `amoled` alongside `light` and `dark`.

Do not add an `:root[data-theme="amoled"] { … }` block without a pack selector. True black
is a pack-scoped appearance.

---

## 6. The decoration budget

Tokens travel through the system by construction: every surface the dashboard draws already
reads them, so a token change themes the whole interface for free. Decorative rules do not —
they are new rules, often new assets, and they behave differently:

- **Nothing scopes itself.** Every decorative rule needs its
  `:root[data-visual-theme="<id>"]` prefix, or it leaks into the default theme. Grep for
  your pack id before you push: every decorative selector should contain it.
- **Assets need `go:embed` entries** in `web/web.go`. The `web/mascot/` directive at
  `web/web.go:79` is the precedent — a directory embed covers added files, but the directive
  itself must exist for a new asset folder.
- **No blur, filter or box-shadow on anything that repeats per row.** The dashboard renders
  dozens of `.wi` rows. A glow on a panel heading costs nothing; the same glow on `.wi` is
  paid dozens of times per page. Panel headings, cards, modals and buttons are fine.
- **Decorative rules inflate `dashboard.css`**, which ships inside the extension's zip. If
  the budget is unclear for a given pack, agree a rule cap and an asset-byte cap in the
  issue before writing the code.

Light mode is not optional. The pack axis is independent of appearance, so a user can select
your pack and then choose Light. Define the light variant (step 2 above), or make the pack
dark-only in its token blocks and have the picker say so — but decide it in the issue, not
on discovery.

---

## 7. Verifying a pack change

Templates are `go:embed`-ed by `web/web.go`, so `web/*.html` edits are not visible until the
binary rebuilds. `./start.sh` rebuilds and restarts.

Verify on a running page with real rows, not an empty board. The fixture is in the tree:

- `workFixture()` in `internal/dashboard/workpanels_test.go:15` builds a `work.Board` with
  every row kind the panels draw.
- `get()` in `internal/dashboard/handler_test.go:58` renders the page through the real
  handler so you can dump the HTML, serve it, and drive it.

Measure contrast on the rendered page, not on the token values. Translucent fills
(`color-mix(in srgb, var(--caution) 20%, transparent)` is common) composite over their
parent, so tokens alone lie. Handle both `rgb()` and `color(srgb …)` notation when picking
pixels.

Checklist for Definition of Done:

- `go build ./...`, `go vet ./...`, `go test ./...` all pass.
- `bash monitor/extension/build.sh` (with `HELLOGITTY_ROOT` set) passes every `check()`.
- No `{{` reaches `dist/hellogitty/dashboard.css`.
- Selecting the pack, reloading, and switching between appearances all behave; no flash on
  first paint.
- No decorative rule applies without `:root[data-visual-theme="<id>"]`.
- Contrast checked against the themed background, in every appearance the pack supports.
- The side panel is verified by loading the built extension, not by reading the diff.

---

## 8. Not in scope

A pack changes colour and ornament. Not behaviour, data, routing, layout, typography scale
or component shape. If a pack wants a layout change, that is a separate issue, scoped on its
own merits.

Do not add a manifest format, a compatibility matrix, a token-reference generator or a
second registry file. The whole theme layer is about 25 lines of CSS and one JavaScript
object; governance heavier than the thing governed is explicitly out of scope.
