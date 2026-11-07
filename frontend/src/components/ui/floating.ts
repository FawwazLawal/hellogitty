import { CHAMFER } from '../chrome/Chrome'

/**
 * The shared chrome for every floating surface — menu, popover, tooltip,
 * dialog content.
 *
 * JUDGMENT, with reasoning (the one the intake asked for):
 *
 * Floating surfaces get a REDUCED chrome treatment. Chamfer stays, the hairline
 * stays, the raised surface token stays, and the accent rail and armour plate
 * are OFF.
 *
 *   - Chamfer is the identity silhouette. It reads at any size, and a pure
 *     rectangle inside a chamfered app reads as borrowed from another system.
 *     Keep it.
 *   - The accent rail is a leading-edge anchor for a REGION on the page. A
 *     tooltip has no page-level leading edge; a menu has a trigger, not an
 *     edge. The rail on a 180px menu would read as an eyebrow, not a cue, and
 *     distract from the item being pointed at. Drop it.
 *   - Armour plate is tile-scale ornament, built for the trailing corner of a
 *     92px KPI. On a floating surface it would occupy half the width before
 *     the first item is drawn. Drop it.
 *   - Hairline (`--hg-line`) stays — every floating surface needs a boundary
 *     between itself and the canvas, otherwise a popover reads as text that
 *     has broken out.
 *   - Elevation is `--hg-surface-raised` plus the `--shadow-raised` token.
 *     Depth is read from colour separation more than shadow on dark
 *     identities; on bone the shadow does the work.
 *
 * Keeping floating chrome spare also keeps the primitive layer reusable. A
 * tooltip that carries a decorative rail cannot host a form field; one that
 * doesn't, can.
 */
export const FLOATING_SURFACE_STYLE = {
  background: 'var(--hg-surface-raised)',
  borderColor: 'var(--hg-line)',
  clipPath: CHAMFER,
  boxShadow: 'var(--hg-shadow-raised, 0 4px 14px rgba(0,0,0,0.35))',
} as const

/**
 * The shared radius-less corner the chamfer draws. Radix sometimes applies its
 * own `border-radius` through the framework defaults; we zero it on every
 * floating surface so the clip-path is the sole silhouette source.
 */
export const FLOATING_SURFACE_CLASS = 'border rounded-none'

/**
 * Open/close transition. The global `prefers-reduced-motion: reduce` rule in
 * `index.css` collapses the duration to 0.01ms, so this is the reduced-motion
 * path too.
 */
export const FLOATING_TRANSITION =
  'transition-[opacity,transform] duration-150 ease-out ' +
  'data-[state=closed]:opacity-0 data-[state=open]:opacity-100 ' +
  'data-[state=closed]:scale-[0.98] data-[state=open]:scale-100 origin-top'
