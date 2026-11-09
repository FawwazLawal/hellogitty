import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Grip } from './Grip'
import { PanelFold } from './PanelFold'
import { PanelResize } from './PanelResize'
import type { LayoutState, PanelId } from './schema'
import type { LayoutAction } from './reducer'

/**
 * The per-panel wrapper the dashboard puts around every rendered
 * panel. Houses the three in-place controls — Grip (top-left),
 * PanelFold (top-right), PanelResize (bottom edge) — plus the
 * data-panel / data-folded attributes the CSS folds against.
 *
 * ADR-UI-002 §5: "every interactive affordance is a real control."
 * The templated page renders .pgrip / .pfold / .presize *inside*
 * the panel's own <section>; this slot renders them *around* the
 * React panel instead. Two reasons:
 *
 * 1. Each panel is its own component with its own PanelHeader call
 *    site (ten of them); adding a leading-slot and trailing-slot
 *    to PanelHeader would touch every panel and spend headroom we
 *    do not have on #335's budget (5,141 B pre-wiring).
 *
 * 2. The templated chrome is an overlay in spirit: the grip and
 *    fold toggle sit on the heading, and the resize bar sits at
 *    the bottom edge, both decorations the panel itself does not
 *    need to know about. Rendering them in the slot keeps the
 *    panel components unchanged — the slot is the parity surface.
 *
 * Measurement. `PanelResize` needs the panel's current rendered
 * height for its keyboard arithmetic (currentHeight ± RESIZE_STEP_PX,
 * floored to MINH). A ResizeObserver on the slot keeps that value
 * current; a `useState` triggers a re-render only when the number
 * actually changes. This is cheap: one observer per panel, and the
 * state transitions only when the pixel count moves.
 *
 * snap plumbing. The slot reads the real DOM to feed
 * snapRowsToBoundary — row heights of the first `ul.items > li`
 * list inside the panel, plus the chrome height (header + borders
 * + resize bar). Only panels carrying `data-snap-rows` opt in;
 * nothing else uses it. The caller passes `snapRows=true` to
 * engage the plumbing.
 */

export interface PanelSlotProps {
  id: PanelId
  /** The panel's display name — read by the Grip, Fold toggle and
   *  resize bar labels. */
  panelName: string
  state: LayoutState
  dispatch: (action: LayoutAction) => void
  /** Opt-in to snap-to-row on commit. Only Your-work carries
   *  `data-snap-rows` in the templated page. */
  snapRows?: boolean
  children: ReactNode
}

export function PanelSlot({
  id,
  panelName,
  state,
  dispatch,
  snapRows,
  children,
}: PanelSlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const folded = state.folded.includes(id)

  // Keep `height` in step with the slot's rendered size so the
  // resize bar's keyboard arithmetic reads the current pixel
  // value, not a stale one. ResizeObserver fires on both layout
  // reflow and ancestor-width changes; cheaper than a RAF loop.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setHeight((h) => (h === el.offsetHeight ? h : el.offsetHeight))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Measurement callback for the snap bar. Returns null for
  // non-opt-in panels so the resize bar does not try to snap
  // against rows the panel has none of.
  const snapCallback = snapRows
    ? () => {
        const el = ref.current
        if (!el) return null
        const section = el.querySelector(':scope > section') as HTMLElement | null
        if (!section) return null
        const rowEls = section.querySelectorAll<HTMLElement>('ul.items > li')
        if (!rowEls.length) return null
        const header = section.querySelector(':scope > header') as HTMLElement | null
        const bar = el.querySelector(':scope > .presize') as HTMLElement | null
        // The border-box arithmetic peer flagged. Omitting borders
        // puts the snap boundary two pixels past the clip and
        // shows a sliver of the next row at the edge (see
        // web/index.html:5711-5713 and snap.test.ts's border-box
        // case). Read live.
        const cs = getComputedStyle(section)
        const borders =
          (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
        const chrome =
          (header?.getBoundingClientRect().height ?? 0) +
          (bar?.getBoundingClientRect().height ?? 0) +
          borders
        const rows: number[] = []
        for (const r of rowEls) {
          if (r.hidden) continue
          const h = r.getBoundingClientRect().height
          if (h >= 1) rows.push(h)
        }
        return { rows, chrome }
      }
    : undefined

  return (
    <div
      ref={ref}
      className="hg-panel-slot"
      data-panel={id}
      data-folded={folded || undefined}
      data-snap-rows={snapRows || undefined}
      style={{
        position: 'relative',
        height: state.sizes[id],
      }}
    >
      {/*
        Grip and Fold toggle overlay the panel's own heading. The
        panel's PanelHeader renders with left+right padding that
        accommodates them in the CSS below (.hg-panel-slot .pgrip
        and .pfold rules set position: absolute).
      */}
      <Grip
        id={id}
        state={state}
        dispatch={dispatch}
        panelName={panelName}
        className="hg-panel-slot__grip"
      />
      <PanelFold
        id={id}
        panelName={panelName}
        folded={folded}
        dispatch={dispatch}
        className="hg-panel-slot__fold"
      />
      {children}
      {/*
        Resize handle. Hidden on folded panels — a folded panel
        shows only its heading, and a resize bar on a header
        is meaningless. See the CSS at the end of index.css.
      */}
      {!folded && (
        <PanelResize
          id={id}
          panelName={panelName}
          dispatch={dispatch}
          currentHeight={height}
          snapRows={snapCallback}
        />
      )}
    </div>
  )
}
