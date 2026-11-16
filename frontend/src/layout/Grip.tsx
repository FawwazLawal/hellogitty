import { useRef, type KeyboardEvent } from 'react'
import { GripVertical } from 'lucide-react'
import type { LayoutState, PanelId } from './schema'
import { columnOf, type LayoutAction } from './reducer'

/**
 * The reorder grip on a panel's heading.
 *
 * ADR-UI-002 §5 requires every interactive affordance to be a real
 * control, not a decoration. The grip is a <button> with its own
 * keyboard contract — the templated page at `web/index.html` (just
 * above `function place`) is the contract this port honours exactly:
 *
 *   ArrowUp   — move up within column, no-op at i=0
 *   ArrowDown — move down within column, no-op at last index
 *   ArrowLeft — RAIL only, moves to the END of main
 *   ArrowRight — MAIN only, moves to the END of rail
 *
 * Three subtleties that bit the templated version first and have
 * tests here to make them stay fixed:
 *
 * 1. `preventDefault` ONLY on an actual move. ArrowUp at i=0 falls
 *    through every branch and the key keeps its default (page
 *    scroll). Preventing unconditionally would trap the key on a
 *    panel that cannot move — the symptom reads as a broken page.
 *
 * 2. Each arrow is ONE direction. Right from rail does nothing;
 *    Left from main does nothing. The dialog's Column select is
 *    the way to pick either direction on either column; the grip
 *    keyboard is deliberately the shortest path, not the only one.
 *
 * 3. Cross-column keyboard moves APPEND to the destination, not
 *    project the current index. `set-column` is the reducer action
 *    that appends; `move-across-columns` (unused here, saved for an
 *    eventual drag-drop) is the one that would preserve index.
 *
 * Focus is restored to the grip after dispatch because the parent
 * re-renders after a reorder: the keyboard user is expected to be
 * able to press ArrowDown twice in a row and move the panel twice,
 * which the templated page gets with `grip.focus()` inside its
 * handler. In React, the ref persists across the re-render and
 * calling `.focus()` right after dispatch is enough.
 */

export interface GripProps {
  id: PanelId
  state: LayoutState
  dispatch: (action: LayoutAction) => void
  /** Accessible label; the panel's own name reads here. */
  panelName: string
  className?: string
}

export function Grip({ id, state, dispatch, panelName, className = '' }: GripProps) {
  const ref = useRef<HTMLButtonElement>(null)

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const col = columnOf(state, id)
    if (!col) return // panel is in neither column; grip would not usually render

    const arr = state[col]
    const i = arr.indexOf(id)

    if (e.key === 'ArrowUp') {
      if (i <= 0) return // no-op, no preventDefault — page scroll remains
      e.preventDefault()
      dispatch({ type: 'move-within-column', id, delta: -1 })
      ref.current?.focus()
      return
    }
    if (e.key === 'ArrowDown') {
      if (i < 0 || i >= arr.length - 1) return
      e.preventDefault()
      dispatch({ type: 'move-within-column', id, delta: 1 })
      ref.current?.focus()
      return
    }
    // Each arrow is one direction. Left: rail → main. Right: main → rail.
    // The other two combinations fall through — no preventDefault.
    if (e.key === 'ArrowLeft' && col === 'rail') {
      e.preventDefault()
      dispatch({ type: 'set-column', id, column: 'main' })
      ref.current?.focus()
      return
    }
    if (e.key === 'ArrowRight' && col === 'main') {
      e.preventDefault()
      dispatch({ type: 'set-column', id, column: 'rail' })
      ref.current?.focus()
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      onKeyDown={onKeyDown}
      className={`inline-flex items-center justify-center p-1 ${className}`}
      aria-label={`Reorder ${panelName}: Arrow Up and Arrow Down to move within the column, Arrow Left and Arrow Right to move between columns`}
      style={{
        color: 'var(--hg-text-muted)',
        cursor: 'grab',
      }}
      data-grip-for={id}
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  )
}
