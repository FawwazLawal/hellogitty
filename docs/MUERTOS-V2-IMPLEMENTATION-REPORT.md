# Muertos V2 — Implementation report

**Status:** Shipped as a pack. Structural pieces held, see §4.
**Date:** 2026-11-05 · **Pack id:** `muertos-v2`

A new visual theme pack layered on top of Auto / Light / Dark / AMOLED, in the existing two-axis
theme architecture documented in `docs/THEME-PACKS.md`. The existing `muertos` pack is untouched.

## 1. What shipped

Three appearances, each designed as its own atmosphere (not inversions of each other):

| Appearance | Named | Signature |
|---|---|---|
| Light | **Día de Flores** | Cream paper canvas (`#FFF3DF`), pure-white cards (`#FFFFFF`), warm cream raised-surface (`#FBE7CF`), tactile dusty-rose rules, printed-paper rhythm. |
| Dark | **Noche Viva** | Aubergine canvas (`#170F21`), raised plum panels (`#261A34`), warm cream ink, candlelit layering lifted above AMOLED's flat. |
| AMOLED | **Eclipse** | True `#000000` canvas; panels collapse into the canvas with `--rule` carrying the frame, per §5. |

Ornament, all pack-scoped (every rule carries `:root[data-visual-theme="muertos-v2"]`):

- **Papel picado** cut-paper strip on `.site-head::after` — 9px tall, five brand colours, dimmer on AMOLED, over no interactive control.
- **Violet 4-petal medallion** `::before` on the active quicknav tab — identity carrier in `--head-accent`, no caution colour on it.
- **Printed-paper ribbon** inset 3px violet on every `.panel`, light-only. Pays once per panel, no blur, no row-level cost.
- **Paper-grain** SVG noise tiled on `body` background on light-only, at ~5.5% alpha. Only shows between panels.
- **Luz, the Signal Keeper** — new SVG at `web/mascot/luz.svg`, 1.7 KB, covered by the existing `web/mascot/` `go:embed`. Rendered via `::before` on `.empty` and dashboard `p.none`. "All clear" cameo with 9s blink gated behind `prefers-reduced-motion: no-preference`.

## 2. The semantic triad

`docs/THEME-PACKS.md` §3 is binding: `--nom → --caution → --warn` must stay visually distinct, with
a hue gap wide enough that "needs doing" and "something is broken" don't collide, measured against
the pack's own themed background.

Muertos V2 keeps violet as the pack identity carrier and reserves marigold for `--caution`. This is
the honesty move that was accidental in the shipped `muertos` pack and is now a stated principle:
**the only warm light on the page is the thing that needs you**. Decorative marigold, pink and jade
live only in Luz, the papel picado strip and section flower medallions — never on a status chip.

Grayscale verification (relative luminance):

| Token | Dark panel `#261A34` | Light panel `#FFFFFF` | AMOLED panel `#080808` |
|---|---|---|---|
| `--caution` | `#FFC050` (0.60) | `#8E5100` (0.12) | `#FFBD40` (0.58) |
| `--pack-flower-marigold` (decoration) | `#FFC050` (0.60) | `#B25D05` (0.17) | `#FFBD40` (0.58) |
| `--nom` | `#79D8A0` (0.64) | `#0A6B55` (0.11) | `#68DDB5` (0.62) |
| `--warn` | `#FF8690` (0.40) | `#B12845` (0.09) | `#FF7888` (0.38) |

On Dark and AMOLED, decorative marigold shares its hue with `--caution` on purpose: the principle
says the only warm light is caution, so any marigold reads as the same colour — but that marigold
only appears in illustrations (Luz's crown, the picado strip, a flower medallion), never as a flat
chip or background that could be confused with a status cell. On Light, decorative marigold and
caution sit at different luminances (0.17 vs 0.12), so a flower medallion and a "your move" chip
read at different weights even in grayscale.

**Rejected concept:** making marigold a surface/hero wash and shifting caution to a burnt-sienna
`#D96B2B`. In grayscale against a cream panel, a decorative marigold flower and a caution chip
would land at near-identical luminance (0.15–0.17), so a reader skimming the page in grayscale or
with colour vision differences could not distinguish an ornament from a status alert. The brief
itself forbids this ("festival colours must never make a healthy/quiet metric look like an urgent
notification"). Moving caution to make room for ornament trades signal reliability for ornament,
which is the one trade the project's own rules forbid.

## 3. Build and extension constraints

Per `docs/THEME-PACKS.md` §4:

- All pack CSS lives inside `web/index.html`'s `<style>` block or `{{define}}` CSS blocks it
  includes, so `monitor/extension/build.sh` lifts it into `dashboard.css`.
- Every pack line is static — no `{{...}}` actions in pack CSS.
- `bash monitor/extension/build.sh` passes every `check()` after the change; `--caution-fill`,
  `.wi blockquote`, `.head-right` and `visual-theme` all survive the lift.
- No decorative rule applies without `:root[data-visual-theme="muertos-v2"]` in its selector.
- No `box-shadow`, `filter` or `blur` on `.wi` or any other per-row element. Decoration sits on
  singleton elements (`.site-head`, `.panel`, `.quicknav a.active`, `.empty`, `p.none`).

## 4. Explicitly not in this PR

The following are product-level information-architecture improvements that benefit everyone, not
only pack users. They are held pending a separate scoping decision on whether to ship them inside
the pack or as independent PRs in the default theme. Independent PRs are the recommended route,
so that the layout fixes reach every theme rather than only this pack:

1. **Hero statrail** — a 3–4-card metric row (Needs you, Repos, Open PRs, API headroom).
2. **Activity Weave** — the signature cinematic data band.
3. **Needs-You promotion** — moving actionable work out of the narrow sidebar.
4. **Conversations empty-state redesign** — replacing the large void with Luz + compact copy.

Per-state Luz variants (reviewing, error, setup) and additional flower medallions beyond the
active nav tab also wait for #4 to unblock, since they need placement contexts the redesign owns.

## 5. The Activity Weave's data source, when it ships

The dashboard does not poll commit history, so an Activity Weave cannot draw commit events. What
the dashboard does have is `work.Item` timestamps (`CreatedAt`, `ClaimedAt`, `CompletedAt`) across
Sent + Incoming, and pipeline stage transitions. The Weave will bin those hourly across the last
14 days, and the legend will name exactly what is shown AND what is NOT (specifically that commit
events are not in the band). If a scope yields fewer than five events in the window, the panel
renders an empty state that names which scope was empty, not a decorative chart. Stated here so
that a reviewer does not assume the chart will fabricate telemetry when it does land.

## 6. Dark vs AMOLED separation

The token architecture separates them: Dark panels are raised plum above an aubergine canvas
(`--panel #261A34` on `--bg #170F21`), and AMOLED collapses panel into canvas (`--panel #080808`
on `--bg #000000`, with `--rule` lifted to carry the frame). The brief's "layered plum with
lantern glow" vs "large negative space with precise illumination" is partially carried by that
elevation gap and partially by ornament that is more natural to add on the hero rail and the
Weave. Without those pieces in scope, the pack carries the structural half of the separation but
not the full atmospheric contrast — flagged honestly here rather than painted over.

## 7. Preview

Local worktree, separate port from the owner's dashboard:

```sh
./hellogitty -config hellogitty.json      # the owner's existing server, unchanged
```

```sh
# This pack preview, on an alternate port in a worktree build:
go build -o ./hellogitty-v2 ./cmd/hellogitty
./hellogitty-v2 -config <pack-test-config.json>   # listen: "localhost:7341"
```

In the browser: Settings → Visual theme → **Muertos V2**. The AMOLED button appears in the
appearance picker when the pack is active (injected by the shared `theme-js` block because the
pack declares `amoled: true`).

## 8. Screenshots

Under `docs/muertos-v2-screenshots/`:

- `00-slice-tokens-settings-card.jpg` — the new picker card
- `20-retune-light-desktop.jpg` — Día de Flores, 1440×900
- `21-retune-dark-desktop.jpg` — Noche Viva, 1440×900
- `22-retune-amoled-desktop.jpg` — Eclipse, 1440×900
- `23-retune-light-mobile.jpg` — Día de Flores, 390×812
- `16-luz-empty-state-dark.jpg` — Luz on the empty state, Noche Viva
