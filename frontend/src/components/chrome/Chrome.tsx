import type { ReactNode } from 'react'

/**
 * Reusable angular chrome, built once and shared.
 *
 * ADR-UI-002 §5, Chrome: "reusable scalable angular SVG corners, tabs, seams,
 * rivets, directional highlights and accent rails. Build geometry once and
 * reuse it consistently; avoid rasterizing full controls or baking labels into
 * PNGs."
 *
 * So none of these take an image. They are geometry in `currentColor` or a
 * token, scale to any size, and carry no text. The one raster in the shell is
 * the scenic header band, which is scenery rather than a control.
 *
 * Every piece here is `aria-hidden` and `pointer-events: none`: it is
 * decoration sitting near controls, and decoration that eats a click is a bug
 * the founder would find before a test would.
 */

/** Shared props for the purely decorative pieces. */
interface DecorProps {
  className?: string
}

/**
 * The chamfered panel silhouette — an octagon that trims each corner.
 *
 * Done with `clip-path` rather than an SVG border because it has to clip the
 * panel's own background and anything inside it. One caveat learned on the Go
 * side: `clip-path` also clips `box-shadow`, so a clipped element cannot carry
 * a shadow-based focus ring. Nothing here is focusable, and the global focus
 * style uses `outline`, which is drawn outside the clip.
 */
export const CHAMFER = 'polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px)'

/**
 * The vertical accent rail down the left edge of a panel.
 *
 * In all three reference renders every major panel is anchored by a bright
 * vertical bar at its leading edge — it is the strongest single piece of
 * identity in the chrome, and the cheapest to get right.
 */
export function AccentRail({ className = '' }: DecorProps) {
  return (
    <span
      aria-hidden="true"
      className={`hg-decor absolute left-0 top-0 bottom-0 w-[3px] ${className}`}
      style={{ background: 'var(--hg-accent)' }}
    />
  )
}

/**
 * The angular brackets flanking the clock: ⟨ time ⟩.
 *
 * Drawn rather than typed. The render's brackets are a long shallow chevron
 * with a tail, which no font glyph matches, and baking them into the header
 * raster would make them unscalable and untintable.
 */
export function ClockBracket({ side, className = '' }: DecorProps & { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 48"
      className={`hg-decor h-12 w-6 ${className}`}
      style={{ transform: side === 'right' ? 'scaleX(-1)' : undefined }}
      fill="none"
    >
      <path d="M22 2 L6 24 L22 46" stroke="var(--hg-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 12 L13 24 L22 36" stroke="var(--hg-accent)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
    </svg>
  )
}

/**
 * A rivet. Four of them pin each KPI tile's strap in the render.
 *
 * A radial gradient rather than a circle element, so the highlight reads as a
 * domed head catching light from above rather than a flat dot.
 */
export function Rivet({ className = '' }: DecorProps) {
  return (
    <span
      aria-hidden="true"
      className={`hg-decor absolute h-[3px] w-[3px] rounded-full ${className}`}
      style={{ background: 'var(--hg-accent)', opacity: 0.8 }}
    />
  )
}

/**
 * A panel: chamfered, ruled, with the accent rail at its leading edge.
 *
 * This is the one surface every content component sits on, so the chamfer,
 * border and rail are defined here once instead of in each of them. A worker
 * building the repo table should not be deciding what a panel looks like.
 */
export function Panel({
  children,
  className = '',
  rail = true,
  sunken = false,
}: {
  children: ReactNode
  className?: string
  /** The leading accent bar. Off for nested or secondary surfaces. */
  rail?: boolean
  /** Use the recessed surface token instead of the standard one. */
  sunken?: boolean
}) {
  return (
    <section
      className={`relative min-w-0 border ${className}`}
      style={{
        background: sunken ? 'var(--hg-surface-sunken)' : 'var(--hg-surface)',
        borderColor: 'var(--hg-line)',
        clipPath: CHAMFER,
      }}
    >
      {rail && <AccentRail />}
      {children}
    </section>
  )
}

/**
 * A panel's heading row: icon, title, and whatever sits at the trailing end.
 */
export function PanelHeader({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <header
      className="flex items-center gap-2 border-b px-4 py-2.5"
      style={{ borderColor: 'var(--hg-line)' }}
    >
      {icon && (
        <span aria-hidden="true" style={{ color: 'var(--hg-accent)' }} className="flex items-center">
          {icon}
        </span>
      )}
      <h2 className="text-[13px] font-semibold tracking-wide" style={{ color: 'var(--hg-text)' }}>
        {title}
      </h2>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  )
}
