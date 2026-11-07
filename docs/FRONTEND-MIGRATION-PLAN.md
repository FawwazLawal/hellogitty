# FRONTEND-MIGRATION-PLAN

**Status:** describes what is on `dev` at `af89abd` (2026-11-06), not an
aspiration. Subsequent commits change the picture, so a reviewer checking a
later SHA should re-run the greps below rather than trust this paragraph.

**Reads with:** ADR-UI-002 (the Premium Frontend ADR, held outside the
public repo) §7 (phased execution and approval gates), §4 (system
boundaries) and §12 (outstanding questions). This document closes the §11
deliverable of the same name — ADR asked for it before coding, it was never
written, and the migration continued anyway. What follows is reconstructed from the code: by reading the Go router,
the React shell and the config package, not by trusting the brief that put me
here.

## 1. The migration switch

Which dashboard the front door opens onto is one JSON field:

```json
{ "ui": "legacy" }
```

Defined in [internal/config/config.go:59](../internal/config/config.go) as
`UI string`. Its `finish()` method validates with
`fmt.Errorf("ui: %q is not a known dashboard; use \"legacy\" or \"react\"")` —
a typo is a startup error, not a silent fallback to legacy. The default,
when the key is missing, is `legacy`.

The main binary reads it in [cmd/hellogitty/main.go:276](../cmd/hellogitty/main.go)
and hands the handler a single boolean, `ReactIsDefault = cfg.UI == "react"`.
That boolean is the whole of the migration's front-door control.

**Flipping it:** edit one word in `hellogitty.json`, restart the binary. There
is no separate build, no feature-flag service, no runtime toggle: the React
bundle is compiled into the binary either way (see §3). Rollback is the same
edit in reverse.

## 2. Routes, as they actually are

From [internal/dashboard/handler.go:769](../internal/dashboard/handler.go)
onward, in the switch in `ServeHTTP`. The flag flips four front doors; it does
not change what the React app is reachable at.

| Path                 | `ui: legacy` (default) | `ui: react`                |
| -------------------- | ---------------------- | -------------------------- |
| `/`                  | Go template            | React shell (dashboard)    |
| `/work`              | Go template            | React shell (work view)    |
| `/pipeline`          | Go template            | React shell (pipeline view) |
| `/settings`          | Go template            | React shell (settings view) |
| `/issues`            | Go template            | React shell (issues view)¹ |
| `/repos`             | Go template            | React shell (repos view)   |
| `/legacy`            | Go template            | Go template (unchanged)    |
| `/legacy/work`       | Go template            | Go template (unchanged)    |
| `/legacy/pipeline`   | Go template            | Go template (unchanged)    |
| `/legacy/settings`   | Go template            | Go template (unchanged)    |
| `/legacy/issues`     | Go template            | Go template (unchanged)    |
| `/legacy/repos`      | Go template            | Go template (unchanged)    |
| `/app/` (and below)  | React shell            | React shell                |
| `/app/api/*.json`    | typed JSON             | typed JSON                 |

¹ `/issues` is the one converted route that still answers JSON on its own
path. Its case is guarded on the `Accept` header: a document request gets the
React shell, and `Accept: application/json` falls through to `serveIssues`
exactly as before. That arm already carried pagination and search, which is
why the issues conversion needed no new endpoint — §4 of the ADR asks for
typed endpoints only "if the migration actually requires them", and here it
did not. Anything already reading `/issues` as JSON is unaffected.

Everything else — `/feed`, `/conversations`,
`/your-repos`, `/help`, every `/alerts/*` page, `/notifications/clear`,
`/watch`, `/feed.json`, `/feed/ack`, `/favicon.svg`, `/mascot/*`, `/art/*`,
`/health` — serves the same handler under both flag values. Those pages have
no React equivalent yet.

`/legacy` is present under both flag values on purpose: a bookmark survives
the flip either way, and reviewing a React screen next to the templated one
is one tab each.

## 3. One-binary packaging

ADR §7 Phase 2 asks that "Go can serve built assets locally without Node at
runtime." It can: there is one binary, and the React bundle is inside it.

- **Embed point:** [web/web.go:120](../web/web.go) declares
  `//go:embed all:app\nvar App embed.FS`. The `all:` prefix is deliberate —
  Go's default `//go:embed` skips files beginning with `.` or `_`, and Vite's
  hashed `assets/` directory can legitimately produce either.
- **Vite output:** `frontend/vite.config.ts` sets `build.outDir` to
  `../web/app` so the embed sees the production build without a copy step. The
  bundle is built with `base: '/app/'`, which is why the SPA fallback at
  `handler.go:1495` works: every route under `/app/` that names no file
  returns `index.html`.
- **Placeholder commit:** `web/app/` carries a committed placeholder page. The
  comment in `web.go` states the reason — `//go:embed` fails on a missing
  directory, and the placeholder is what keeps a fresh checkout compiling
  before anyone has run `pnpm build`.
- **Static art:** `/art/*` is served out of a second embed, `web/art/`. The
  React build mirrors those files at `frontend/public/art/` so Vite's dev
  server can serve the same URL space. The test
  `frontend/src/art/registry.test.ts` asserts both directions — every
  registered asset exists on disk, and every file on disk is registered —
  against `frontend/public/art/`, so a divergence between the two mirrors is
  the kind of thing the suite catches once the Go copy is wired in the same
  way (today it is not; see §6).
- **Node at runtime:** none. `pnpm`, `vite` and `tsc` are build-time
  dependencies. The shipped binary ships no JavaScript tooling.

## 4. Converted surfaces and their endpoints

The React app at `/app/` is a single document with a six-way path switch in
[frontend/src/App.tsx:48](../frontend/src/App.tsx) — not a router in the
`react-router` sense, which §3 of the ADR explicitly warns against adding
early. The switch keys off `location.pathname` and chooses `dashboard |
settings | pipeline | work | issues | repos`.

| React view   | URL (when `ui: react`) | Backing endpoint                     | Fallback when the endpoint fails |
| ------------ | ---------------------- | ------------------------------------ | -------------------------------- |
| dashboard    | `/`                    | `/app/api/dashboard.json`            | fixture (`fixtures/dashboard.ts`) |
| work         | `/work`                | `/app/api/work.json`                 | fixture                          |
| pipeline     | `/pipeline`            | `/app/api/pipeline.json`             | fixture                          |
| settings     | `/settings`            | `/app/api/settings.json` (+ `/session.json`) | partial degrade              |
| issues       | `/issues`              | `/issues` with `Accept: application/json` | error state (no fixture)    |
| repos        | `/repos`               | `/app/api/dashboard.json` (`repos`)  | error state (no fixture)         |

The dashboard fallback is deliberate: it is a fallback for *no answer*, not
for a quiet one. Once `useDashboard` resolves with data, that data is the
truth even when it is empty — the fixture is only shown while the query is
pending or failed. The reason is in the shell comment at `App.tsx:98` and
worth repeating: the first version treated an empty live answer as "no
answer" and painted the fixture, which reads as demo data wearing the clothes
of real data.

**Validation at the boundary:** every endpoint response parses through a Zod
schema (`frontend/src/data/dashboard.ts`, `frontend/src/data/settings.ts`). A
Go struct change that drops or renames a field surfaces as a parse error that
the UI handles, not as `undefined` painted into a tile.

**Dashboard sub-components already in React:**

- `KpiRail` — the four stat tiles (needs, PRs, repos, api). Live.
- `ConversationsPanel` — empty state / count. Live via
  `/app/api/dashboard.json`'s `conversations` field.
- `TrackedRepos` — the tracked repository table. Live via the same endpoint's
  `repos` and `repoTotals`.
- `PipelinePanel`, `YourWorkPanel` — rails on the dashboard. Live.

**What `/legacy/*` still serves and why it is still compiled in:**

- `/legacy` — the full Go-templated dashboard. Served under both flag values
  as the always-available baseline.
- `/legacy/work`, `/legacy/pipeline`, `/legacy/settings`, `/legacy/issues`,
  `/legacy/repos` — the templated pages for each converted view. §7 Phase 4 is explicit that legacy "comes
  out only after replacement passes regression tests and approval"; the
  settings React page does not yet carry the clock controls, and the pipeline
  React port does not yet carry the per-stage board, so the templated
  originals stay compiled in and reachable until those gaps close.

## 5. What is still Go-rendered

Unconverted at this SHA. The handler serves each of these with the same
template-and-static-helpers it always has, under both flag values.

**Standalone pages:**

- `/feed` — the live activity feed.
- `/feed.json`, `/feed/ack` — the feed's own JSON and acknowledgement
  endpoint (no React equivalent).
- `/conversations` — the conversations page (distinct from the empty-state
  panel on the dashboard).
- `/your-repos` — the repositories owned by the viewer.
- `/help` — the Help page.
- `/notifications/clear`, `/watch` — small action endpoints.

**Alerts:** ten `/alerts/*` pages (`your-move`, `watched-claimed`,
`watched-closed`, `check-failed`, `repo-health`, `unresolved-threads`,
`data-stale`, `repo-flagged`, `stage-failed`, `api-low`). Each is its own
template under `web/alert-*.html`.

## 6. What remains before legacy templates can be deleted

In rough order of effort, measured from this SHA:

1. **Owner approval of the six converted React views.** §7 Phase 4 blocks
   removal "only after replacement passes regression tests and approval."
   Settings and pipeline carry acknowledged feature gaps (settings' clock
   controls, pipeline's per-stage board); work, dashboard, issues and repos
   do not.
2. **Build the React versions of the remaining standalone pages** — feed,
   conversations, your-repos, help — and their endpoints where none exists.
   Conversations partially exists as a dashboard panel; the standalone page
   is a different, denser view. Issues and repos are done (see §4); repos
   needed no new endpoint, reading the dashboard document's `repos` array,
   and issues needed none either, reading `/issues`' own JSON arm.
3. **Build React versions of the ten alert pages.** These are static pages
   with one or two action links, so the lift per page is small, but the ten
   of them are the long tail that determines when the alert templates can be
   deleted.
4. **Decide what the feed looks like in React.** `/feed.json` + `/feed/ack`
   already exists; `/feed` the page is a thin template over them. This is
   the smallest conversion that unblocks deleting the most alert HTML.
5. **Wire the Go side of the art directory to a single source of truth with
   `frontend/public/art/`.** The two mirrors are maintained by hand today.
   The test at `frontend/src/art/registry.test.ts` already enforces
   `public/art/` and the registry; a build-time copy from one to the other
   would close the loop without renaming any file.
6. **Remove `web/*.html` templates and their `//go:embed`s** once (1)–(5) are
   signed off. The `web.go` embed lines, the handler cases and the HTML
   files go together.

Each of those is its own PR. None of them belongs in this one.

## 7. Impacts, risks and rollback

**Rollback is edit-one-word, documented above.** No deploy, no database
migration, no cache invalidation. The React bundle is compiled in either way,
so a build downgrade is not part of rolling back — only the config field is.

**Risks that survive the config flag:**

- **Endpoint schema drift.** A Go struct change that drops a field reaches
  the React app as a Zod parse failure, which `useDashboard` surfaces and
  the UI falls back on the fixture. Covered. A change that *renames* a field
  the same way surfaces identically; a change that *silently changes a
  value's meaning* does not. That one needs a Go-side schema test in
  `internal/dashboard/api_test.go`, which is outside this PR.
- **Bundle size growth unobserved.** `frontend/e2e/budget.spec.ts` sets a
  measured ceiling (~25% above the 2026-11-07 baseline) and fails if the
  gzipped shell crosses it. The gate is useful only if it runs; it currently
  runs via `playwright.app.config.ts`.
- **Art drift between mirrors.** Discussed in §3 and §6. Hand-maintained
  until a build step closes the gap.
- **One SPA fallback for every unknown `/app/*` path.** This is deliberate:
  `handler.go:1500` comments "a client-routed application owns its own URL
  space." A reviewer who sees `/app/anything-at-all` return `index.html` is
  seeing the design, not a defect. It does mean that typos under `/app/`
  look like empty React routes rather than 404s; that is the cost of the
  SPA fallback and the one currently judged acceptable.

**Not impacted:** the Go test suite, which neither knows nor cares about the
React bundle; the `/health` endpoint; the embed-based offline-first posture
(no CDN, no network reach — the budget suite asserts this directly).

## 8. Dependency rationale

Only the libraries actually imported by `frontend/src/`. Compared with
ADR-UI-002 §3, which listed many more as *conditional*.

| Package                     | In use | Where                                              | Rationale                                                                                                                                         |
| --------------------------- | ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| react, react-dom            | yes    | app shell                                          | §3 required.                                                                                                                                      |
| vite                        | yes    | build                                              | §3 required.                                                                                                                                      |
| typescript                  | yes    | source                                             | §3 required; `strict`, no broad `any`.                                                                                                            |
| tailwindcss v4              | yes    | `index.css`, components                            | §3 required.                                                                                                                                      |
| @tanstack/react-query       | yes    | `data/dashboard.ts`, `data/settings.ts`            | §3 conditional. Adopted because the Go endpoint polls and the client wants `isPending / isSuccess / error / refetch` with a cache, which is what Query gives us. |
| @tanstack/react-table       | **no** | —                                                  | §3 conditional. Reviewed and declined a second time. The first rationale ("reopen if client-side sort appears") treated every client-side sort as equivalent; the `/repos` conversion disproved that. `/repos` has client-side sort — name / open / good-first / commit — and a health filter and a search over 80 cards, driven by two `<select>`s and an `<input type="search">` (not column headers), and the port to react-table v9 turned out to be roughly 2.5× the lines of code and 6× the concepts of the imperative version, because the library's value is in column-oriented interactions (header-click sort, multi-column sort, column resize, column visibility, pagination, virtualization) that this UI does not have. The reopen condition is now specific: column-header or multi-column sort UI, column resize or visibility toggles, or virtualization at sizes a simple `.slice()` cannot cover (probably >200 rows of card markup). Dropdown-driven single-sort over a small list is handled by `Array.prototype.sort` with unknown-last comparators inline — see `ReposPage.tsx` and its `repos.spec.ts` gate on unknown ages. |
| zod                         | yes    | `data/*`                                           | §3 conditional. Adopted at the API boundary; see §4.                                                                                              |
| lucide-react                | yes    | components                                         | §3 conditional. Functional icons only — identity marks are hand-authored.                                                                         |
| motion for react            | yes    | `ReposPage.tsx`                                    | §3 required *where interaction warrants*. Adopted for the `/repos` card reorder on sort change — CSS cannot animate a discrete layout change in a CSS grid, and motion's FLIP (`layout="position"`) is the cheapest honest way to show the viewer where their row went. `useReducedMotion()` short-circuits the whole `motion.li` wrapper to a plain `<li>` under `prefers-reduced-motion: reduce`, not a shorter duration — a 10ms transition is still a transition. §8 P0 is satisfied by the hook, and `repos-motion.spec.ts` gates both branches. Not adopted anywhere else: dialog / popover / tooltip / collapsible open-close is handled by CSS on the Radix primitives. |
| shadcn/ui + Radix           | **no** | —                                                  | §3 required *where applicable*. No primitive in the shipped shell needed one yet (the primitives in use are a plain `<button>`, `<table>`, `<a>`). Reopen when the first menu/dialog/combobox lands. |
| storybook                   | yes    | `*.stories.tsx` files                              | §3 required. Three themes × realistic data × key states covered for `ConversationsPanel`, `KpiRail`, `Masthead`, `NavTabs`, `PipelinePanel`, `TrackedRepos`, `YourWorkPanel`. |
| playwright + @axe-core      | yes    | `e2e/`                                             | §3 required. Two configs: `playwright.config.ts` (fixture-backed visual gate) and `playwright.app.config.ts` (React app against the Go binary).   |
| vitest + @testing-library   | yes    | `*.test.ts(x)`                                     | §3 required. Includes `tokens.contrast.test.ts` and `art/registry.test.ts`.                                                                       |
| pnpm                        | yes    | lockfile                                           | §3 proposed.                                                                                                                                      |
| GSAP / Rive / Three.js      | **no** | —                                                  | §3 not baseline. Not added and not proposed.                                                                                                      |
| Next.js                     | **no** | —                                                  | §3 not selected. No SSR, no public SEO requirement, and adding a second server conflicts with the single-binary posture.                          |

**No framework stacking by prestige.** Every "no" above has a specific reason
to reopen; none is permanent. A conversion that genuinely needs a Radix combo
box or a Motion transition adds the dependency when it adds the UI.

## 9. How to verify this document against the code

- **Routes:** `grep -nE 'r\.URL\.Path ==' internal/dashboard/handler.go`.
- **Config flag:** `grep -n '"ui"' internal/config/config.go`.
- **React views:** `cat frontend/src/App.tsx` — the `ROUTES` constant is the
  whole list.
- **Legacy templates still compiled in:** `grep -n 'go:embed' web/web.go`.
- **Converted React API endpoints:** `grep -n 'r\.URL\.Path == "/app/api' internal/dashboard/handler.go`.
- **Dependency reality:** `jq .dependencies frontend/package.json`.

If any table above drifts from those commands on the HEAD you are reading,
trust the commands and open a PR against this document.
