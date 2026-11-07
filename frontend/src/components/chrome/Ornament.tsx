import { useId } from 'react'

/**
 * The ornament library: chrome as geometry, not as pictures.
 *
 * ADR-UI-002 §5, Chrome: "reusable scalable angular SVG corners, tabs, seams,
 * rivets, directional highlights and accent rails. Build geometry once and
 * reuse it consistently; avoid rasterizing full controls or baking labels into
 * PNGs."
 *
 * WHY THIS FILE EXISTS. The first pass had scenic raster art in the header and
 * essentially nothing else, and it read as flat beside the reference renders.
 * The richness in those renders is not the photograph behind the masthead — it
 * is the armoured plate on every KPI tile, the rivets pinning it, the notched
 * silhouette of the active tab, the brackets at panel corners, the ornamental
 * glyphs flanking the clock. All of that is linework.
 *
 * Linework is also the answer to the asset gap. Only Vermilion had raster
 * ornaments, so Azure and Bone were rendering bare. Geometry takes its colour
 * from `currentColor` and the identity tokens, so one definition serves all
 * three and gains a fourth for free.
 *
 * Every export here is decorative: `aria-hidden`, `hg-decor` (which pins
 * `pointer-events: none`), and never a carrier of text or data.
 */

/* ─────────────────────────── Seigaiha ──────────────────────────────────── */

/**
 * The overlapping-arc wave pattern, as a tiling SVG.
 *
 * Seigaiha is concentric arcs on an offset grid; three nested rings per scale
 * reads as the traditional pattern without becoming noise at small sizes. It
 * returns a `background-image` data URI rather than an element, so it can sit
 * on a panel's own background and be clipped by the same chamfer.
 *
 * `color` must be a resolved colour, not a `var()` — a data URI is parsed
 * outside the document and cannot see custom properties. Callers pass the value
 * they read from the computed style.
 */
export function seigaihaDataUri(color: string, opacity = 0.14, size = 44): string {
  const r = size / 2
  const rings = [1, 0.68, 0.36]
    .map((k) => `<circle cx="${r}" cy="${r}" r="${(r * k).toFixed(2)}" />`)
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${r}" viewBox="0 0 ${size} ${r}">` +
    `<g fill="none" stroke="${color}" stroke-width="1.1" opacity="${opacity}">` +
    `<g transform="translate(0,0)">${rings}</g>` +
    `<g transform="translate(${-r},0)">${rings}</g>` +
    `<g transform="translate(${r},0)">${rings}</g>` +
    `</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/* ─────────────────────────── Armour plate ──────────────────────────────── */

/**
 * The riveted armour plate that anchors the trailing edge of a KPI tile.
 *
 * This is the single strongest piece of chrome in the reference renders, and
 * the thing most responsible for the tiles reading as objects rather than as
 * boxes. Construction: an angular plate with a clipped corner, a bevelled top
 * highlight, a darker under-edge, four rivets, and a strap crossing it at an
 * angle with its own highlight.
 *
 * It is drawn in the identity's own metal tones, passed as props, so Bone's
 * plate is slate-blue on paper and Vermilion's is near-black steel.
 */
export function ArmourPlate({
  className = '',
  width = 86,
  height = 92,
}: {
  className?: string
  width?: number
  height?: number
}) {
  const id = useId().replace(/:/g, '')
  return (
    <svg
      aria-hidden="true"
      className={`hg-decor ${className}`}
      width={width}
      height={height}
      viewBox="0 0 86 92"
      fill="none"
    >
      <defs>
        <linearGradient id={`plate-${id}`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="var(--hg-plate-hi)" />
          <stop offset="0.55" stopColor="var(--hg-plate)" />
          <stop offset="1" stopColor="var(--hg-plate-lo)" />
        </linearGradient>
        <linearGradient id={`strap-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--hg-plate-hi)" />
          <stop offset="1" stopColor="var(--hg-plate-lo)" />
        </linearGradient>
      </defs>

      {/*
        A broad angular plate, leading edge cut back at the top and bottom so
        it seats into the tile instead of floating on it.

        The first version drew a wide diagonal strap across the middle in the
        same dark gradient as the plate, which swallowed the plate and read as
        a smudge at tile size. The strap is now a narrow band near the leading
        edge, and the plate itself carries the surface.
      */}
      <path
        d="M30 4 L78 4 L84 12 L84 80 L78 88 L30 88 L18 72 L18 20 Z"
        fill={`url(#plate-${id})`}
        stroke="var(--hg-plate-edge)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Bevel: lit along the top and leading edges, shadowed along the base. */}
      <path
        d="M31 9 L77 9 M23 23 L23 70"
        stroke="var(--hg-plate-hi)"
        strokeWidth="1.3"
        opacity="0.65"
        strokeLinecap="round"
      />
      <path d="M31 83 L77 83" stroke="var(--hg-plate-lo)" strokeWidth="1.4" opacity="0.8" strokeLinecap="round" />

      {/* A seam across the plate, so it reads as two pieces bolted together. */}
      <path d="M18 48 L84 48" stroke="var(--hg-plate-lo)" strokeWidth="1.2" opacity="0.65" />
      <path d="M18 50 L84 50" stroke="var(--hg-plate-hi)" strokeWidth="0.8" opacity="0.3" />

      {/* The strap: narrow, near the leading edge, with its own lit side. */}
      <path d="M36 0 L48 0 L41 92 L29 92 Z" fill={`url(#strap-${id})`} />
      <path d="M36 0 L39 0 L32 92 L29 92 Z" fill="var(--hg-plate-hi)" opacity="0.5" />
      <path d="M36 0 L48 0 L41 92 L29 92 Z" stroke="var(--hg-plate-edge)" strokeWidth="1" fill="none" />

      {/* Rivets: domed, lit from above, placed on the plate not the strap. */}
      {[
        [60, 20],
        [74, 34],
        [60, 64],
        [74, 76],
      ].map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy + 0.8} r="4" fill="var(--hg-plate-lo)" opacity="0.9" />
          <circle cx={cx} cy={cy} r="3.2" fill="var(--hg-rivet)" />
          <circle cx={cx - 0.9} cy={cy - 1} r="1.2" fill="var(--hg-plate-hi)" opacity="0.95" />
        </g>
      ))}
    </svg>
  )
}

/* ─────────────────────────── Corner bracket ────────────────────────────── */

/**
 * An angular bracket for a panel corner.
 *
 * Two strokes and a tick, mirrored by the caller through `corner`. It reads as
 * machined rather than drawn, which is what keeps the chrome from looking
 * decorative-for-its-own-sake next to dense data.
 */
export function CornerBracket({
  corner = 'tl',
  size = 18,
  className = '',
}: {
  corner?: 'tl' | 'tr' | 'bl' | 'br'
  size?: number
  className?: string
}) {
  const flip = {
    tl: 'none',
    tr: 'scaleX(-1)',
    bl: 'scaleY(-1)',
    br: 'scale(-1,-1)',
  }[corner]
  return (
    <svg
      aria-hidden="true"
      className={`hg-decor ${className}`}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      style={{ transform: flip === 'none' ? undefined : flip }}
    >
      <path d="M1 7 L1 1 L7 1" stroke="var(--hg-accent)" strokeWidth="1.4" strokeLinecap="square" />
      <path d="M4 10 L4 4 L10 4" stroke="var(--hg-accent)" strokeWidth="1" opacity="0.4" />
    </svg>
  )
}

/* ─────────────────────────── Clock ornament ────────────────────────────── */

/**
 * The glyph flanking the clock: a double chevron closing on a diamond.
 *
 * The reference renders put an ornament here that no font glyph matches, and
 * baking it into the header raster would make it unscalable and untintable —
 * precisely what §5 forbids.
 */
export function ClockOrnament({ side, className = '' }: { side: 'left' | 'right'; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`hg-decor ${className}`}
      width="46"
      height="18"
      viewBox="0 0 46 18"
      fill="none"
      style={{ transform: side === 'right' ? 'scaleX(-1)' : undefined }}
    >
      <path d="M44 3 L36 9 L44 15" stroke="var(--hg-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M36 4 L29 9 L36 14" stroke="var(--hg-accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.72" />
      <path d="M28 4.5 L22 9 L28 13.5" stroke="var(--hg-accent)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.42" />
      <path d="M14 9 L9 5.5 L4 9 L9 12.5 Z" fill="var(--hg-accent)" opacity="0.85" />
      <path d="M19 9 L16.5 7.2 L14 9 L16.5 10.8 Z" fill="var(--hg-accent)" opacity="0.45" />
    </svg>
  )
}

/* ─────────────────────────── Oni mark ──────────────────────────────────── */

/**
 * The brand mark: a horned oni helm in profile-front, drawn flat.
 *
 * Deliberately geometric rather than illustrative. It has to hold at 34px in a
 * masthead and stay legible in a light identity where it is ink on paper, and
 * a shaded illustration would turn to mud at that size.
 */
export function OniMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`hg-decor ${className}`}
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
    >
      {/* Horns */}
      <path
        d="M7 13 C5 7 7 3 10 2 C9 6 11 9 13 11 Z M29 13 C31 7 29 3 26 2 C27 6 25 9 23 11 Z"
        fill="var(--hg-accent)"
      />
      {/* Helm */}
      <path
        d="M18 7 C25 7 30 12 30 19 C30 26 25 32 18 32 C11 32 6 26 6 19 C6 12 11 7 18 7 Z"
        fill="var(--hg-plate)"
        stroke="var(--hg-plate-edge)"
        strokeWidth="1.2"
      />
      {/* Brow and crest */}
      <path d="M9 17 L18 13 L27 17" stroke="var(--hg-accent)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M18 8 L18 13" stroke="var(--hg-accent)" strokeWidth="1.4" strokeLinecap="round" />
      {/* Eyes, lit */}
      <path d="M11.5 21 L16 19.5 L15 23 Z" fill="var(--hg-accent)" />
      <path d="M24.5 21 L20 19.5 L21 23 Z" fill="var(--hg-accent)" />
      {/* Mouth guard */}
      <path d="M13 26 L23 26 M14.5 29 L21.5 29" stroke="var(--hg-plate-edge)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/* ─────────────────────────── Tab silhouette ────────────────────────────── */

/**
 * The notched silhouette of the active navigation tab.
 *
 * The renders cut the trailing edge of the active tab at an angle so it reads
 * as a plate seated into the bar rather than a rectangle with a line under it.
 * `clip-path` rather than SVG, because it has to clip the tab's own background
 * and the label inside it.
 *
 * `clip-path` also clips `box-shadow`, so a clipped tab cannot carry a
 * shadow-based focus ring. The global focus style uses `outline`, which is
 * drawn outside the clip and survives.
 */
export const TAB_NOTCH =
  'polygon(0 0, calc(100% - 12px) 0, 100% 100%, 0 100%)'

/** The same silhouette for a trailing-edge pennant, pointing the other way. */
export const PENNANT_NOTCH =
  'polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%)'
