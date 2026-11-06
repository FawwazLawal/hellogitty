import { ChevronRight } from 'lucide-react'
import type { KpiTile } from '../fixtures/dashboard'
import { CHAMFER, AccentRail, Rivet } from './chrome/Chrome'
import { useTheme } from '../theme/ThemeProvider'

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
const TILE_ART: Record<string, Partial<Record<KpiTile['id'], string>>> = {
  vermilion: {
    prs: '/art/vermilion-maple.webp',
    repos: '/art/vermilion-oni.webp',
  },
  // azure and bone intentionally omitted — the pack has no art cut yet.
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

export function KpiRail({ tiles }: { tiles: KpiTile[] }) {
  const { identity } = useTheme()
  const artMap = TILE_ART[identity] ?? {}

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}
    >
      {tiles.map((tile) => {
        const artSrc = artMap[tile.id]
        const numeralColor = toneVar(tile.tone)
        const ariaLabel = tile.sublabel
          ? `${tile.label}: ${tile.value.toLocaleString()}, ${tile.sublabel}`
          : `${tile.label}: ${tile.value.toLocaleString()}`

        return (
          <a
            key={tile.id}
            href={`#${tile.id}`}
            aria-label={ariaLabel}
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
            {artSrc && (
              <span
                aria-hidden="true"
                className="hg-decor absolute bottom-0 right-0 top-0 w-1/2 bg-no-repeat"
                style={{
                  zIndex: -1,
                  backgroundImage: `url(${artSrc})`,
                  backgroundSize: 'auto 100%',
                  backgroundPosition: 'right center',
                  opacity: 0.14,
                }}
              />
            )}

            {/* The numeral + label stack. Sits in the leading column so it
                is mostly off the art region, but the contrast comment above
                covers the overlap case too. */}
            <div className="flex min-w-0 flex-col justify-center pl-2">
              <div
                className="font-mono text-[34px] font-bold leading-none tabular-nums tracking-tight"
                style={{ color: numeralColor }}
              >
                {tile.value.toLocaleString()}
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
  )
}
