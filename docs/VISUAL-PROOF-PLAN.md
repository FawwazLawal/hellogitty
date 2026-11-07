# VISUAL-PROOF-PLAN

**Status:** describes the visual acceptance contract as enforced by the code
at `dev` / `af89abd` (2026-11-06). A reviewer at a later SHA should re-run
the greps in §7 before trusting these tables.

**Reads with:** ADR-UI-002 (the Premium Frontend ADR, held outside the
public repo) §5 (visual system acceptance contract), §6 (definition of
premium quality), §8 (quality gates and evidence). This document closes the §11 deliverable of the same
name — ADR asked for it before coding, it was never written. It records how
a visual claim gets *proved* here, in a form a reviewer can rerun.

The ADR is the goal; this is the method. Where they disagree about method,
this document is wrong — trust the suite, not this prose.

## 1. The three identities

| Identity    | Scheme | Canvas    | Surface   | Primary ink  | Accent     | Defined at                                                                 |
| ----------- | ------ | --------- | --------- | ------------ | ---------- | -------------------------------------------------------------------------- |
| vermilion   | dark   | `#0A0F1C` | `#151016` | `#F1EFEE`    | `#F22D3D`  | [frontend/src/theme/tokens.ts](../frontend/src/theme/tokens.ts) `IDENTITIES.vermilion` |
| azure       | dark   | `#060B20` | `#0E1631` | `#E6EEFF`    | `#005BFF`  | `IDENTITIES.azure`                                                         |
| bone        | light  | `#F5F7FF` | `#FFFFFF` | `#0A0F1C`    | `#2A4F9C`  | `IDENTITIES.bone`                                                          |

Each is a complete palette — not a light/dark pair with the lights swapped.
`ColorTokens` in [tokens.ts](../frontend/src/theme/tokens.ts) has 24 fields.
Every one is measured, and every measured pair is enforced; see §3.

## 2. Identity, appearance, and dark as the absence

ADR §5: "Theme **identity** and OS **appearance** preference must be modeled
independently." The code models them orthogonally and the convention is
consistent across the Go side and the React side — worth writing down
because the convention is *implicit*, which is exactly the kind of knowledge
that rots.

**The two axes:**

| Axis       | Values                              | DOM carrier                                             |
| ---------- | ----------------------------------- | ------------------------------------------------------- |
| identity   | `vermilion` \| `azure` \| `bone`    | `document.documentElement.dataset.identity`             |
| appearance | `auto` \| `light` \| `dark`         | `document.documentElement.dataset.appearance`           |

An explicitly chosen identity always wins over the OS. An `appearance: auto`
resolves against `prefers-color-scheme`; the resolved scheme sets
`document.documentElement.style.colorScheme` so native form controls and
scrollbars match. See [ThemeProvider.tsx](../frontend/src/theme/ThemeProvider.tsx).

**Dark is the absence, not a value.** On the Go side the convention is
visible in [web/index.html:576](../web/index.html) and the alert templates:
`:root[data-theme="light"]` and `:root[data-theme="amoled"]` are the branches
written out, and dark is what `:root:not([data-theme="light"])` and the
bare `:root` block match. A viewer with no stored appearance and dark OS
preference has no `data-theme` attribute at all — the dark palette is the
unqualified baseline, not a value you can grep for. A reviewer looking at the
React tree sees the same pattern: `dataset.appearance` is `"auto"` under
default conditions, and the identity's own `scheme` (defined in `tokens.ts`)
carries whether that identity is a dark or light world. There is no
`dataset.theme` key, by design.

**Preserved behavior:** both sides share the storage keys
`hellogitty-theme` (appearance) and `hellogitty-visual-theme` (identity). A
founder who picks a theme on the Go dashboard finds the same choice applied
on the React one.

## 3. Contrast floors, as enforced

Not an aspirational list. The two gates below *recompute* contrast from the
tokens and fail the build when a number drops.

**The token-level gate** — [frontend/src/theme/tokens.contrast.test.ts](../frontend/src/theme/tokens.contrast.test.ts).
Runs under `vitest`, with no browser.

- For each identity in `IDENTITY_ORDER`, every ink in `TEXT_INKS` (`text`,
  `textMuted`, `accent`, `success`, `warning`, `danger`) must clear **4.5:1**
  on every surface in `TEXT_SURFACES` (`canvas`, `surface`, `surfaceSunken`,
  `surfaceRaised`).
- `accentInk` on `accentFill` must clear 4.5:1.
- The focus ring (`focus`) must clear **3:1** on every surface — SC 1.4.11.
- The formula itself is self-checked against three known pairs (`#767676` on
  white at 4.54:1, `#000`/`#fff` at 21:1, `#fff`/`#fff` at 1:1).

Why it exists as prose is covered in the top-of-file comment: the Go side
once shipped a stylesheet with inline contrast ratios the colours did not
have. One false figure poisons the rest. This computes rather than asserts.

**The browser-level sweep** — [frontend/e2e/app.spec.ts](../frontend/e2e/app.spec.ts),
test "every text node clears its contrast floor", per identity.

- Playwright walks every leaf text node in the live React app.
- For each node, it reads the computed foreground and walks up for the
  first ancestor that actually paints a background. That is the only
  measurement that has been trustworthy; reading tokens and assuming the
  effective paint was the Go side's own mistake.
- The floor is **3:1** for text at 24px, or 18.66px bold; **4.5:1**
  otherwise.
- The failure message names the text, the measured ratio, the floor and the
  font size.

The two gates sit at different altitudes: the vitest suite catches a token
change before a build; the Playwright one catches a layer, scrim or
`backdrop-filter` that drops the effective contrast after compositing.

## 4. Viewport and visual projects

Two configs, two surfaces.

**`frontend/playwright.config.ts`** — the fixture-backed visual gate. Runs
against `e2e/fixture/dashboard.html` served by `python3 -m http.server`, so
the markup is frozen and every pixel diff is attributable to CSS, art or
layout. Tight by measurement: `maxDiffPixelRatio: 0.0002`, `threshold: 0.02`,
`animations: 'disabled'`. Projects:

| Project        | Viewport  | Purpose                                           |
| -------------- | --------- | ------------------------------------------------- |
| `desktop-1400` | 1400×1000 | Reference captures (what the renders describe).   |
| `desktop-1280` | 1280×900  | ADR §8 P0 target.                                 |
| `laptop-1024`  | 1024×800  | ADR §8 P0 target.                                 |
| `mobile-390`   | 390×844   | ADR §8 P0 target (phone).                         |

**`frontend/playwright.app.config.ts`** — the React app gate, run against
the Go binary at `http://127.0.0.1:7342` (configurable via `HG_APP_URL`).
This is where `app.spec.ts` and `budget.spec.ts` live. Covers:

- Three identities × two appearances, each getting the axe serious/critical
  wall.
- Per-identity contrast sweep.
- Per-focusable-control focus-indicator check.
- 390px horizontal-overflow check.
- **768px tablet width** (added here).
- **Forced-colors emulation** (added here).

The 768 and forced-colors gates are the two that close ADR §8's "support
1280, 1024, 768 and 390 CSS-pixel widths" and "forced-colors usability"
requirements. Each one was proved red before being committed; see §6.

## 5. The acceptance method

In the order a reviewer runs it, not in the order it was built.

1. **Token sanity.** `cd frontend && pnpm vitest run` — contrast, art
   registry both-directions, component tests. Fast. A failure here usually
   means a token was nudged for art-direction reasons and the ripple was
   not measured.
2. **Build and binary.** `cd frontend && pnpm build` writes
   `../web/app/`. `go build -o /tmp/hg-app ./cmd/hellogitty` picks it up
   through `//go:embed all:app`.
3. **Fixture gate.** `pnpm exec playwright test` — fixture-backed visual
   captures across the four viewports. Snapshots come from the frozen
   markup; any diff is a CSS or art change.
4. **App gate.** With the binary serving on 7342 and a real config:
   `pnpm exec playwright test --config=playwright.app.config.ts`. This is
   where axe, the contrast sweep, the focus-indicator check, the 390 and
   768 overflow checks, the forced-colors render, and the budget suite
   run.
5. **Eyes on glass.** The P0 contract in ADR §8 includes "three theme
   captures match reference composition ... with founder-accepted residual
   differences." No pixel-diff percentage can judge invented details in an
   image-generation reference. A side-by-side review is the method, and
   Rule 19 governs how it is submitted.

## 6. Rule 19: before/after screenshots and owner approval

Any visual change that could move one pixel in the shipped app does not
push until:

- **Before and after screenshots** are attached to the PR, taken from the
  binary (not the dev server), at identity × appearance × viewport for the
  pair the change plausibly moves. One pair per axis the change touches.
- **Owner approval** is recorded against those screenshots, not against the
  diff. A reviewer looking at a token change does not have the eye for a
  seigaiha wave the owner does.

The reason is in the top comment of `playwright.config.ts`: every visual
failure the project has had was a feedback-loop failure, not a framework
one. Screenshots-in-PR is the cheapest feedback loop. The method is the
guard on it being respected.

## 7. Asset inventory and provenance

Lives in [frontend/src/art/registry.ts](../frontend/src/art/registry.ts),
not here. The registry is the single source of truth: file, intrinsic size,
safe zone, intended placement, provenance, responsive variants and
fallback, keyed by `(identity, slot)`. Nine entries at this SHA.

- Every entry declares a `Provenance` from the discriminated union
  (`ai-generated-in-session` | `licensed` | `original`) — no "unknown" arm.
  As of this PR the AI-generated block's `ownerDecision` is `approved`
  (see the PR for this ADR gap closure).
- The both-directions test
  [frontend/src/art/registry.test.ts](../frontend/src/art/registry.test.ts)
  asserts every registered file exists on disk and every file on disk is
  registered, against `frontend/public/art/`.
- The budget test "a single identity does not download every identity's
  art" asserts that vermilion does not fetch `*azure*` or `*bone*` files —
  ADR §8 P1 "no wasted huge assets for inactive themes."

An asset change starts in `registry.ts` and the filesystem together. A new
slot means a new union variant in `ArtSlot`, which turns a typo at a call
site into a TypeScript error rather than a silent dangling URL. That union
is the design.

## 8. What a reviewer must look at before approving a visual change

In order of fastest-to-catch. Do not skip ahead — each later check assumes
the earlier one passed.

1. **The token diff, if any.** `git diff -- frontend/src/theme/tokens.ts`.
   A change here affects every surface that uses the token. The vitest
   contrast suite will say if any pair dropped; read its output, don't just
   trust green.
2. **The both-directions art check.** `pnpm vitest run art/registry`.
   Named filenames must exist; files on disk must be declared. A reviewer
   who sees an art change with no registry change is seeing one of the two
   failure modes described in §7.
3. **The fixture visual gate.** Every captured snapshot that moved is
   attributable to the change; the reviewer reads the diffs as a list.
4. **The app gate** — forced-colors, 768px, 390px, axe, focus indicator,
   contrast sweep. Serious and critical axe violations are a wall.
5. **The budget suite.** A change that grew the shell crosses the ceiling
   before it ships, not after.
6. **The screenshots in the PR** against the reference render for the
   identity touched. This is the eye-on-glass step; see §6.

## 9. How to verify this document against the code

- **Identities:** `grep -n '^export const IDENTITIES' frontend/src/theme/tokens.ts`.
- **DOM carriers:** `grep -n 'dataset\.' frontend/src/theme/ThemeProvider.tsx`.
- **Contrast floors:** `cat frontend/src/theme/tokens.contrast.test.ts`.
- **Visual projects:** `cat frontend/playwright.config.ts`.
- **App gates:** `cat frontend/playwright.app.config.ts frontend/e2e/app.spec.ts`.
- **Budget:** `cat frontend/e2e/budget.spec.ts`.
- **Art registry:** `cat frontend/src/art/registry.ts frontend/src/art/registry.test.ts`.

If any table above drifts from those commands on the HEAD you are reading,
trust the commands and open a PR against this document.
