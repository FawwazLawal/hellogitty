import { useEffect, useRef } from 'react'
import type { LayoutState } from './schema'
import { visiblePanelIds, type LayoutAction } from './reducer'

/**
 * Window-level keyboard shortcuts for the panel layout.
 *
 * Mirrors the templated handler at web/index.html:5728:
 *
 *   c      fold all panels
 *   e      unfold (expand) all panels
 *   1..9   toggle fold on the panel at the 1-indexed position in the
 *          visible order (main top→bottom, then rail top→bottom)
 *
 * The exclusions matter as much as the keys. A shortcut listener that
 * swallows keys while the user is typing in a search box has broken
 * the dashboard's own form controls — same shape of defect as
 * ArrowUp-at-i=0 trapping the page-scroll key on a panel that cannot
 * move. The guards here are three:
 *
 *   - target is an input, textarea, select, or contenteditable
 *   - any modifier key is held (ctrl/meta/alt)
 *   - the escape hatch on <html data-shortcuts="off">
 *
 * ADR-UI-002 §5 names that opt-out explicitly for accessibility
 * tooling that needs to keep the global key vocabulary.
 *
 * The HOOK is parameterised over `state` and `dispatch` through refs
 * so the window listener attaches ONCE on mount, not once per
 * re-render. A fresh addEventListener per render would otherwise
 * leave the previous listeners attached (React's cleanup runs AFTER
 * the new effect, so the overlap is one extra listener per render
 * until cleanup fires; on a page that re-renders on every poll,
 * that is a leak and a wrong-state dispatch waiting to happen).
 */

export interface UseShortcutsOptions {
  state: LayoutState
  dispatch: (action: LayoutAction) => void
  /** Explicit window override for tests. Defaults to the ambient
   *  `window`. Pass null in server contexts to opt out. */
  target?: Window | null
}

export function useShortcuts(opts: UseShortcutsOptions): void {
  // Latest state/dispatch via refs so the window listener never
  // closes over a stale value — useEffect would otherwise re-attach
  // on every change, which both leaks and briefly runs with the
  // wrong state during the gap between effects.
  const stateRef = useRef(opts.state)
  const dispatchRef = useRef(opts.dispatch)
  stateRef.current = opts.state
  dispatchRef.current = opts.dispatch

  const target = opts.target === undefined ? (typeof window !== 'undefined' ? window : null) : opts.target

  useEffect(() => {
    if (!target) return
    function onKeyDown(e: KeyboardEvent) {
      // Don't swallow keys from the user's own typing. The target is
      // only an Element when the event was fired on one — a keydown
      // dispatched directly on `window` has the window itself as the
      // target, which does not have `matches`/`isContentEditable`.
      // Guard explicitly rather than assume HTMLElement.
      if (e.target instanceof Element) {
        const el = e.target as HTMLElement
        if (el.matches('input, textarea, select')) return
        // isContentEditable is a computed property; jsdom only sets
        // it under some conditions. Check the attribute explicitly
        // too so the test fake is treated the same way a real editor
        // with contenteditable="true" would be.
        if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // The <html data-shortcuts="off"> escape hatch. Reads live
      // because the dashboard page can toggle this at runtime.
      if (typeof document !== 'undefined' && document.documentElement.dataset.shortcuts === 'off') {
        return
      }

      const state = stateRef.current
      const dispatch = dispatchRef.current

      if (e.key === 'c') {
        e.preventDefault()
        dispatch({ type: 'fold-all' })
        return
      }
      if (e.key === 'e') {
        e.preventDefault()
        dispatch({ type: 'unfold-all' })
        return
      }
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1
        // VISIBLE panels, not all panels. Hidden ids drop out so the
        // digits always index what the viewer is looking at: pressing
        // `1` targets the top panel on screen, pressing `2` the next,
        // and so on. Mirrors allPanelIds at web/index.html:5705.
        const order = visiblePanelIds(state)
        if (idx < order.length) {
          e.preventDefault()
          dispatch({ type: 'toggle-folded', id: order[idx] })
        }
        // When idx >= order.length (a digit past the visible count),
        // the key falls through — no preventDefault, same reasoning
        // as ArrowUp-at-i=0 in the Grip.
      }
    }

    target.addEventListener('keydown', onKeyDown)
    return () => target.removeEventListener('keydown', onKeyDown)
  }, [target])
}
