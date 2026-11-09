import { useCallback, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { PanelId } from './schema'
import { MINH, DRAG_THRESHOLD_PX, RESIZE_STEP_PX, snapRowsToBoundary } from './snap'
import type { LayoutAction } from './reducer'

/**
 * The per-panel resize handle — `.presize` in the templated page
 * (web/index.html:38, :6042-6083). Sits at the bottom of a panel,
 * drag to resize, arrow keys to resize by a fixed step, Escape
 * or Home or double-click to clear the stored height back to the
 * panel's natural one.
 *
 * ADR-UI-002 §5: every interactive affordance is a real control
 * with a real accessible name. The `role="separator"` plus
 * `aria-orientation="horizontal"` and a label that TEACHES BOTH
 * interactions (drag AND arrow keys AND double-click) is the only
 * place the double-click is discoverable — the templated code's
 * label is reproduced here for exactly that reason.
 *
 * ## Three subtleties
 *
 * 1. The accessible label is load-bearing. Shortening it to
 *    "Resize panel" loses the only discovery path for double-click.
 *
 * 2. `pointercancel` is removed alongside `pointerup`. A touch
 *    drag the system interrupts (incoming call, OS gesture) has
 *    to end as cleanly as one the user completes — otherwise the
 *    panel's `.resizing` class sticks and the pointermove
 *    listener keeps resizing on the next finger that touches it.
 *
 * 3. The 2-pixel threshold between drag and click. Below
 *    DRAG_THRESHOLD_PX of travel, the handler commits NOTHING and
 *    just re-applies; above it, the new height is stored.
 *    Without this, every click on the handle writes a size
 *    because pixel-level jitter moves clientY by one between
 *    down and up.
 *
 * ## Keyboard
 *
 *   ArrowUp    SHRINKS (handle sits on the bottom edge; up moves it up)
 *   ArrowDown  grows
 *   Escape     clear-size — restores natural height
 *   Home       clear-size — same as Escape, mirrors web/index.html:6082
 *   End        DEFAULT — not in the original; clear-size here too, for
 *              symmetry with Home. An addition, not a port.
 *
 * ## Snap
 *
 * When `snapRows` is provided, every committed height passes
 * through `snapRowsToBoundary` so panels like Your-work land on a
 * whole-row boundary instead of slicing a row at the clip.
 * The caller measures the rows and the panel's own chrome (header
 * + sort bar + resize handle + top/bottom borders) and hands both
 * in. See web/index.html:5704-5740 for why the border-box arithmetic
 * is load-bearing.
 */

export interface PanelResizeProps {
  id: PanelId
  /** The panel's accessible display name — "Live", "Watched issues", etc. */
  panelName: string
  dispatch: (action: LayoutAction) => void
  /** The panel's current rendered height, in CSS pixels. Used as
   *  the starting point for keyboard arrow steps. */
  currentHeight: number
  /** When supplied, every committed height is snapped via
   *  `snapRowsToBoundary` with the measured rows + chrome. Only
   *  panels with `data-snap-rows` opt in; the dashboard supplies
   *  measurement on each resize via a callback. */
  snapRows?: () => { rows: number[]; chrome: number } | null
  className?: string
}

export function PanelResize({
  id,
  panelName,
  dispatch,
  currentHeight,
  snapRows,
  className = '',
}: PanelResizeProps) {
  const ref = useRef<HTMLDivElement>(null)

  const commit = useCallback(
    (px: number | null) => {
      if (px === null) {
        dispatch({ type: 'clear-size', id })
        return
      }
      let final = Math.max(MINH, Math.round(px))
      const snap = snapRows?.()
      if (snap) {
        final = snapRowsToBoundary(snap.rows, snap.chrome, final)
      }
      dispatch({ type: 'set-size', id, px: final })
    },
    [dispatch, id, snapRows],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Primary button only. Secondary / middle must not start a
    // resize; the templated check at :6064 does the same.
    if (e.button !== 0) return
    e.preventDefault()
    const el = ref.current
    if (!el) return
    const startY = e.clientY
    const startH = currentHeight

    // Try pointer capture so the pointermove continues to fire on
    // this element even when the pointer leaves it. jsdom may not
    // implement setPointerCapture; wrap so the handler still runs
    // in tests that stub the API.
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* no-op */
    }

    // Visual state for the panel while dragging. Reaching to the
    // parent via DOM query rather than React state so the preview
    // height does not hit the reducer on every pixel.
    const panel = el.closest('section') as HTMLElement | null
    panel?.classList.add('resizing')

    function onMove(ev: PointerEvent) {
      const h = Math.max(MINH, startH + ev.clientY - startY)
      if (panel) panel.style.height = h + 'px'
    }
    function onEnd(ev: PointerEvent) {
      el?.removeEventListener('pointermove', onMove)
      el?.removeEventListener('pointerup', onEnd)
      el?.removeEventListener('pointercancel', onEnd)
      panel?.classList.remove('resizing')
      const travel = Math.abs(ev.clientY - startY)
      if (travel > DRAG_THRESHOLD_PX) {
        commit(startH + ev.clientY - startY)
      } else {
        // Snap back to the committed height so the mid-drag inline
        // style does not linger over the stored value.
        if (panel) panel.style.height = ''
      }
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onEnd)
    el.addEventListener('pointercancel', onEnd)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        commit(currentHeight - RESIZE_STEP_PX)
        break
      case 'ArrowDown':
        e.preventDefault()
        commit(currentHeight + RESIZE_STEP_PX)
        break
      case 'Escape':
      case 'Home':
      case 'End':
        // End is an addition for symmetry with Home; the templated
        // page does not bind it, and the label does not advertise
        // it. If that reads as surprising, the fix is to drop the
        // `case 'End'` line here.
        e.preventDefault()
        commit(null)
        break
      default:
    }
  }

  const onDoubleClick = () => commit(null)

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize ${panelName}: drag, or use the up and down arrow keys. Double-click to fit its content.`}
      title="Drag to resize. Double-click to fit the content."
      tabIndex={0}
      className={`presize ${className}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      data-presize-for={id}
    />
  )
}
