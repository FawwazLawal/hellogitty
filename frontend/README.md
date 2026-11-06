# frontend

Two things live here: the **visual gate**, which works today against the
existing Go-rendered dashboard, and the **scaffold** for the React migration
proposed in ADR-UI-002.

## The visual gate

Run it:

```
pnpm install
pnpm test:visual
```

It renders a captured page fixture at a fixed viewport, applies every
appearance x visual-pack pair the app actually ships, and compares each against
a committed baseline.

### Why it exists

Every visual failure in the Azure Oni work was a feedback-loop failure. Art was
authored by something that could not see its own output; three consecutive
header fixes were each reasoned correctly from coordinates and each wrong on
screen. Two defects shipped or nearly shipped that no diff could have caught:

- a decorative layer at `z-index: 0` painting *over* the dashboard it was meant
  to sit behind
- a metal plate filled with a token that sits within 0.02 of the surface under
  it — 1.02:1, so the ornament was not subtle, it was absent

Both are invisible in source review and obvious in a screenshot.

### Why a fixture rather than the live app

The first version pointed at a running HelloGitty and failed on every capture —
not because anything looked wrong, but because the board's data moves. Counts,
relative timestamps, feed rows and rate-limit headroom all change between runs
minutes apart. A gate that fails when nothing is broken gets switched off.

Masking was the wrong answer, because most of the page is data. The split is:
the Go suite's 186 tests cover what markup is produced, and this covers how
that markup looks. Re-capture with `pnpm fixture:update` when markup changes,
then review every changed baseline rather than blessing them in bulk.

`HG_BASE_URL` points the suite at a live instance for authoring. The gate
itself stays on the fixture. There is deliberately no default resolving to
:7340 — that is the owner's own dashboard.

### Thresholds, and why they are tight

`maxDiffPixelRatio: 0.0002`, `threshold: 0.02`. These were derived by
experiment, not taste. The first attempt used 0.002 / 0.15 — defensible-looking
numbers that made the suite useless: re-introducing the real `z-index` bug
flagged **zero of eighteen** captures, because a 5%-alpha overlay moves each
pixel less than 0.15 so nothing counted as changed.

Against a static fixture at fixed viewport and DPR on one machine, an unchanged
run diffs zero pixels, so the tolerance can be near zero — and has to be,
because the failures worth catching are subtle by nature.

### Proven to fail

A gate that cannot go red is not a gate. Verified by injecting each real bug
class into the fixture and confirming the suite catches it:

| injected | result |
|---|---|
| nothing (run twice) | passes, zero diff |
| decorative layer moved to `z-index: 0` | 2 of 18 flagged — correct, light sets that layer to zero amplitude |
| ornament ink set equal to its background | 2 of 18 flagged — correct, the token is shared by two packs' dark blocks |
| registry emptied | fails the vacuity assertion rather than passing on zero packs |

## Scaffold status

Vite + React 19 + TypeScript, Tailwind v4, Motion, Lucide, Zod, TanStack
Table/Query, Vitest + Testing Library, Playwright, axe-core. **Nothing is wired
to the Go app yet** and no component has been built. See
`APPROVAL-REQUEST.md` in the ADR package for the open decisions, chiefly
whether `go install` must keep working.
