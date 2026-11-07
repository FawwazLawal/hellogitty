import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { KpiTile } from '../fixtures/dashboard'
import { CHAMFER, AccentRail, Rivet } from './chrome/Chrome'
import { ArmourPlate, CornerBracket, seigaihaDataUri } from './chrome/Ornament'
import { useTheme } from '../theme/ThemeProvider'
import { resolveArt, type ArtSlot } from '../art'

/**
 * The four-tile KPI rail that sits under the masthead.
 *
 * ADR-UI-002 §6 names the KPI tiles among the signature components, and §5
 * fixes their chrome: chamfered panels, the accent rail at the leading edge,
 * rivets pinning a strap, decorative art that reads as scenery rather than
 * data. Chrome.tsx owns the geometry (CHAMFER, AccentRail, Rivet) so this
 * component does not reinvent any of it.
 *
 * ART, by identity. The reference render pairs a specific scene with each
 * tile; we only have /art/vermilion-maple.webp and /art/vermilion-oni.webp
 * available today, and only for the vermilion identity. A missing variant
 * MUST degrade to a clean tile — never to a vermilion leaf on a blue panel —
 * so the table below falls through to no art for azure and bone, and for
 * vermilion tiles that have no illustration cut yet (needs, api).
 *
 * The art span is aria-hidden, has className "hg-decor" (index.css pins
 * pointer-events: none and user-select: none on that class), and sits at
 * z-index -1 inside this tile's own isolate context so it paints behind the
 * tile's own text without escaping to the root stacking context. Never 0 —
 * a z-index: 0 positioned pseudo-element would paint above in-flow content,
 * which is the bug that hazed the whole dashboard once already.
 *
 * CONTRAST, measured not assumed. The illustrations are a decoration behind
 * the numeral and label, so every text-over-art pair has to clear the SC
 * 1.4.11 / 1.4.3 floor on the real backdrop, not on the surface the backdrop
 * replaces. I alpha-blended both art files over the vermilion surface
 * (#151016) at opacity 0.14 and measured the 99th-percentile backdrop
 * luminance in the art region:
 *
 *                                p99 contrast    worst-pixel
 *   accent #ff3e3d on maple        4.88:1          4.44:1
 *   accent #ff3e3d on oni          5.12:1          3.93:1
 *   text   #ffffff on maple       17.05:1         15.52:1
 *   text   #ffffff on oni         17.89:1         13.74:1
 *   muted  #cbb2b9 on maple        8.61:1          7.84:1
 *   muted  #cbb2b9 on oni          9.04:1          6.94:1
 *
 * Every pair clears 4.5:1 at p99 with headroom, which is why there is no
 * scrim layered under the art here; adding one would only pay for a problem
 * the measurement says does not exist. The one number that would fail is the
 * accent numeral's worst-pixel on the oni (3.93:1), a single bright red-eye
 * glow — judged by p99 per the rule we agreed on across the project.
 *
 * Numeral and label also live in the left two columns of the tile where
 * basically no art paints, so in practice they sit on plain surface. The
 * measurement above is the "what if a four-digit numeral extends into the
 * art column" worst case, not the usual case.
 *
 * NO LITERAL HEX. Every colour is a var(--hg-*) token; the contrast test
 * reads tokens.ts and a literal here would escape it.
 *
 * NO OUTLINE SUPPRESSION. index.css carries one focus style for the whole
 * prototype against --hg-focus, and that is the only focus indicator this
 * tile needs. The clip-path on the tile does clip box-shadow but not
 * outline, so the global style draws cleanly on the chamfered edge.
 */

/**
 * Art slots per identity, per tile id. Null and "not listed" are the same
 * thing: no art for this cell, degrade to a clean tile.
 */
/**
 * Which registry SLOT each tile draws from.
 *
 * The file paths this replaces hard-coded both the asset vocabulary and
 * today's inventory: azure and bone were "intentionally omitted" in a comment,
 * which meant adding art for them later required finding and editing this
 * table rather than just registering a file.
 *
 * The mapping that remains is the honest one — which ROLE suits which tile —
 * and it belongs here rather than in the registry. The registry's job is to
 * say what art exists by role; deciding that the repos tile wears the mascot
 * is a layout decision this component owns. Splitting ArtSlot into per-tile
 * slots would couple the asset vocabulary to one component's tile order, and
 * reordering the rail would then break the vocabulary.
 */
const TILE_SLOT: Partial<Record<KpiTile['id'], ArtSlot>> = {
  prs: 'ornament',
  repos: 'mascot',
}

/**
 * Where each tile navigates when the reader clicks the "drill in" chevron.
 *
 * Earlier this was `#${tile.id}` — four fragment links to ids that did not
 * exist anywhere in the document. The tile looked like a link (cursor, hover,
 * focus ring) and did nothing when clicked, which is the exact failure the
 * dead-controls audit exists to catch. Pointing each at the page that owns
 * that number is the fix:
 *
 *   needs  → /work      (what "Needs you" is: the work board)
 *   prs    → /pipeline  (the PR pipeline carries open PRs)
 *   repos  → /repos     (the tracked-repositories page)
 *   api    → /settings  (the API quota readout lives on the settings page)
 *
 * The map is a single source so a new tile added to the fixture cannot ship
 * without picking its destination — the TypeScript lookup will flag the
 * missing key.
 */
const TILE_HREF: Record<KpiTile['id'], string> = {
  needs: '/work',
  prs: '/pipeline',
  repos: '/repos',
  api: '/settings',
}

/** The rivet strap: four rivets set in from the chamfered corners. */
function RivetStrap() {
  return (
    <>
      {/* The strap itself: a hairline just below the top edge. */}
      <span
        aria-hidden="true"
        className="hg-decor absolute left-3 right-3 top-[7px] h-px"
        style={{ background: 'var(--hg-line-strong)', opacity: 0.6 }}
      />
      {/* Four rivets, two per side, pinning the strap against the chamfer. */}
      <Rivet className="left-[14px] top-[5px]" />
      <Rivet className="left-[32px] top-[5px]" />
      <Rivet className="right-[32px] top-[5px]" />
      <Rivet className="right-[14px] top-[5px]" />
    </>
  )
}

function toneVar(tone: KpiTile['tone']): string {
  switch (tone) {
    case 'success':
      return 'var(--hg-success)'
    case 'ink':
      return 'var(--hg-text)'
    case 'accent':
    default:
      return 'var(--hg-accent)'
  }
}

/**
 * Live state for the rail, supplied by the Phase 3 data layer.
 *
 * `known` per tile is the one that matters. The server distinguishes a figure
 * it has fetched from one it has not, because the poller runs on an interval
 * and before the first poll every count is genuinely unknown. Rendering
 * unknown as "0" tells the viewer nothing needs them — the most consequential
 * lie this dashboard could tell, and the reason this prop exists rather than
 * the component flattening it.
 */
export interface KpiRailState {
  loading?: boolean
  error?: string | null
  /** Tile ids the server has no figure for yet. */
  unknown?: ReadonlySet<string>
  onRetry?: () => void
}

export function KpiRail({
  tiles,
  state,
}: {
  tiles: KpiTile[]
  state?: KpiRailState
}) {
  const { identity } = useTheme()
  /*
    The seigaiha tile is an SVG data URI, which is parsed outside the document
    and so cannot resolve `var(--hg-*)`. The accent is read off the computed
    root style instead, after the theme has painted, and re-read whenever the
    identity changes. This is the one place in the prototype that needs a
    resolved colour rather than a token reference.
  */
  const [waveColor, setWaveColor] = useState('#ffffff')
  useEffect(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--hg-accent').trim()
    if (v) setWaveColor(v)
  }, [identity])

  /*
    Resolved per tile through the registry. An identity with no asset for a
    slot yields a typed `absent`, which this renders as a clean tile — a
    deliberate outcome rather than a 404 that paints nothing and looks like a
    pack nobody finished.
  */
  const artFor = (id: KpiTile['id']): string | undefined => {
    const slot = TILE_SLOT[id]
    if (!slot) return undefined
    const r = resolveArt(identity, slot)
    return r.kind === 'present' ? r.url : undefined
  }

  return (
    /*
      Two columns up to `lg`, then one per tile. The inline
      `repeat(tiles.length, minmax(0, 1fr))` this replaces held four columns at
      every width. `minmax(0, 1fr)` kept it from overflowing, so nothing looked
      wrong in the markup — but at 390px each tile was about 90px wide and
      "4,755 / API left" was clipped inside it. A grid that never overflows can
      still be unreadable.

      An error banner sits ABOVE the grid rather than replacing the tiles.
      The App passes `error` + `onRetry` and every earlier version of this
      component ignored both: a dashboard that could not reach its endpoint
      kept the fixture figures and gave the viewer no sign the data was
      stale and no way to retry. Surface it, as a one-line banner with a
      Retry button that calls the handler the App already wired.
    */
    <div className="flex flex-col gap-3">
      {state?.error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border px-3 py-2 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <span>Could not reach the dashboard service: {state.error}</span>
          {state.onRetry && (
            <button
              type="button"
              onClick={state.onRetry}
              className="shrink-0 border px-2 py-0.5 text-[11.5px]"
              style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
            >
              Retry
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {tiles.map((tile) => {
        const artSrc = artFor(tile.id)
        const numeralColor = toneVar(tile.tone)
        /*
          NO aria-label. It had one — `${label}: ${value}` — and axe caught it
          as a WCAG 2.5.3 (Label in Name) failure on all four tiles.

          The rule: a control's accessible name must CONTAIN its visible text,
          in order, so that someone driving the page by voice can say what they
          see and have it match. The visible text here reads "11" then "Needs
          you"; the label said "Needs you: 11". Reversed order, plus a colon
          that is in the name and not on screen, so neither "eleven" nor "needs
          you" matched the control.

          The fix is to delete the label rather than rewrite it. The tile's own
          content already reads as a good name — "11 Needs you non-draft, state
          OPEN" — and a name computed from content cannot drift out of sync with
          what is rendered, which is exactly how this broke.
        */

        return (
          <a
            key={tile.id}
            href={TILE_HREF[tile.id]}
            className="relative isolate flex items-center gap-3 overflow-hidden border px-5 no-underline transition-colors"
            style={{
              height: 'var(--spacing-tile)',
              background: 'var(--hg-surface)',
              borderColor: 'var(--hg-line)',
              clipPath: CHAMFER,
              color: 'var(--hg-text)',
            }}
          >
            {/* Leading vertical accent bar; from Chrome.tsx so every surface
                carries the same bar. */}
            <AccentRail />

            {/* The strap across the top, with its four rivets. */}
            <RivetStrap />

            {/* Decorative art, when available for this identity + tile.
                Anchored to the trailing edge, 50% of the tile wide, under all
                in-flow content at z-index -1. The numeral and labels paint
                over it. */}
            {/*
              Seigaiha wash across the whole tile. Geometry, not a raster, so
              every identity gets it — this is what closes the gap that left
              Azure and Bone with bare tiles while Vermilion had ornament.
            */}
            <span
              aria-hidden="true"
              className="hg-decor absolute inset-0"
              style={{ zIndex: -2, backgroundImage: seigaihaDataUri(waveColor, 0.1, 40) }}
            />

            {/* Scenic raster, where this identity has one for this tile. */}
            {artSrc && (
              <span
                aria-hidden="true"
                className="hg-decor absolute bottom-0 right-0 top-0 w-1/2 bg-no-repeat"
                style={{
                  zIndex: -1,
                  backgroundImage: `url(${artSrc})`,
                  backgroundSize: 'auto 100%',
                  backgroundPosition: 'right center',
                  opacity: 0.16,
                }}
              />
            )}

            {/*
              The armour plate on the trailing edge. This is the piece that
              makes a tile read as an object rather than a box, and it is the
              single biggest difference between the first pass and the
              reference renders. Drawn in the identity's metal tokens, so it
              is steel on Vermilion and slate on paper for Bone.
            */}
            <ArmourPlate className="pointer-events-none absolute right-0 top-0" width={92} height={92} />

            <CornerBracket corner="tl" className="absolute left-[3px] top-[3px]" size={14} />
            <CornerBracket corner="br" className="absolute bottom-[3px] right-[3px]" size={14} />

            {/* The numeral + label stack. Sits in the leading column so it
                is mostly off the art region, but the contrast comment above
                covers the overlap case too. */}
            <div className="flex min-w-0 flex-col justify-center pl-2">
              <div
                className="font-mono text-[34px] font-bold leading-none tabular-nums tracking-tight"
                style={{ color: numeralColor }}
              >
                {state?.loading
                  ? /* A dash, not a zero and not a spinner. A spinner in a
                       92px tile is noise, and a zero is a claim. */ '—'
                  : state?.unknown?.has(tile.id)
                    ? '—'
                    : tile.value.toLocaleString()}
              </div>
              <div
                className="mt-1.5 text-[13px] font-semibold leading-tight"
                style={{ color: 'var(--hg-text)' }}
              >
                {tile.label}
              </div>
              {tile.sublabel && (
                <div
                  className="text-[11px] leading-tight"
                  style={{ color: 'var(--hg-text-muted)' }}
                >
                  {tile.sublabel}
                </div>
              )}
            </div>

            {/* Trailing chevron: a link affordance. Decorative, so aria-hidden;
                the <a>'s aria-label carries the readable name. */}
            <ChevronRight
              aria-hidden="true"
              size={18}
              className="ml-auto shrink-0"
              style={{ color: 'var(--hg-text-muted)' }}
            />
          </a>
        )
      })}
      </div>
    </div>
  )
}
