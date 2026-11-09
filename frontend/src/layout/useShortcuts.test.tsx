import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useShortcuts } from './useShortcuts'
import { defaultLayout, type LayoutState } from './schema'
import { reduce, type LayoutAction } from './reducer'
import { useState } from 'react'

/**
 * These tests pin the invariant that most puts the user at risk:
 * a shortcut listener must NOT swallow keys while the user is
 * typing in an input, must not fire on modifier combos, and must
 * honour the <html data-shortcuts="off"> escape hatch. Each of
 * those failures reads as a different broken thing — typing
 * dropping characters, cmd-1 opening a tab instead of toggling a
 * panel, an accessibility tool that cannot keep its own vocabulary
 * — and all three are silent to the person noticing it.
 */

afterEach(() => {
  // Reset the escape hatch between tests in case one flipped it.
  document.documentElement.removeAttribute('data-shortcuts')
})

/** A wiring harness that threads a real reducer between the window
 *  listener and the state, so the tests see the dispatch/re-render
 *  path end to end. */
function useHarness(initial: LayoutState) {
  const [state, setState] = useState(initial)
  const dispatch = (a: LayoutAction) => setState((s) => reduce(s, a))
  useShortcuts({ state, dispatch })
  return state
}

function keydown(key: string, opts: KeyboardEventInit = {}) {
  // Wrapped in act() so React flushes the state update the listener
  // dispatches; without it, result.current reads the pre-update
  // state and the tests silently pass against stale data.
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }),
    )
  })
}

describe('useShortcuts — c / e / 1-9', () => {
  it('"c" folds every panel in main+rail order', () => {
    const d = defaultLayout()
    const { result } = renderHook(() => useHarness(d))
    expect(result.current.folded).toEqual([])
    keydown('c')
    expect(result.current.folded).toEqual([...d.main, ...d.rail])
    expect(result.current.preset).toBe('custom')
  })

  it('"e" unfolds everything', () => {
    const d = defaultLayout()
    const start: LayoutState = { ...d, folded: [...d.main, ...d.rail] }
    const { result } = renderHook(() => useHarness(start))
    keydown('e')
    expect(result.current.folded).toEqual([])
  })

  it('"1" toggles fold on the first panel in visible order', () => {
    const d = defaultLayout()
    const { result } = renderHook(() => useHarness(d))
    const first = [...d.main, ...d.rail][0]
    keydown('1')
    expect(result.current.folded).toContain(first)
    keydown('1')
    expect(result.current.folded).not.toContain(first)
  })

  it('"5" targets the fifth panel (main[3] when main has 4)', () => {
    const d = defaultLayout()
    const { result } = renderHook(() => useHarness(d))
    const order = [...d.main, ...d.rail]
    keydown('5')
    expect(result.current.folded).toEqual([order[4]])
  })

  // A key whose index exceeds the visible panel count MUST NOT
  // preventDefault — same reasoning as ArrowUp-at-i=0 in the Grip.
  // We can only assert the state did not change, since
  // defaultPrevented on a dispatched KeyboardEvent must be checked
  // on the original event object.
  it('"9" with only 10 panels toggles panel 9; "0" and above-length are inert', () => {
    const d = defaultLayout()
    const { result } = renderHook(() => useHarness(d))
    // default has 10 panels (4 main + 6 rail); 9 is valid.
    keydown('9')
    expect(result.current.folded.length).toBe(1)
    // Dropping main to 1 panel leaves only 7 total: pressing '8'
    // should be inert because idx 7 is out of range.
    const smaller: LayoutState = {
      ...d,
      main: ['your-work'],
      rail: d.rail.slice(0, 6),
      folded: [],
    }
    const { result: r2 } = renderHook(() => useHarness(smaller))
    keydown('8')
    expect(r2.current.folded).toEqual([])
  })
})

describe('useShortcuts — exclusions', () => {
  // Typing in an input must not trigger the shortcut — a page that
  // dropped characters out of a search box would be broken in a way
  // the user would struggle to describe.
  it('does nothing when the target is an input', () => {
    const d = defaultLayout()
    const { result } = renderHook(() => useHarness(d))
    const inp = document.createElement('input')
    document.body.appendChild(inp)
    inp.focus()
    act(() => {
      // Dispatch directly against the input so e.target is the input.
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }))
    })
    expect(result.current.folded).toEqual([])
    inp.remove()
  })

  it('does nothing when the target is contenteditable', () => {
    const d = defaultLayout()
    const { result } = renderHook(() => useHarness(d))
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    document.body.appendChild(div)
    act(() => {
      div.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }))
    })
    expect(result.current.folded).toEqual([])
    div.remove()
  })

  it('does nothing when a modifier is held', () => {
    const d = defaultLayout()
    const { result } = renderHook(() => useHarness(d))
    keydown('c', { metaKey: true })
    keydown('c', { ctrlKey: true })
    keydown('c', { altKey: true })
    expect(result.current.folded).toEqual([])
  })

  it('does nothing when <html data-shortcuts="off">', () => {
    const d = defaultLayout()
    const { result } = renderHook(() => useHarness(d))
    document.documentElement.dataset.shortcuts = 'off'
    keydown('c')
    expect(result.current.folded).toEqual([])
  })
})

// The listener MUST be attached once per mount, not once per render.
// A fresh addEventListener per render leaves the previous listener
// attached until React's cleanup runs, and on a page that re-renders
// on every poll (which this dashboard does), that would pile up
// listeners and fire the shortcut once per re-render.
describe('useShortcuts — listener identity', () => {
  it('attaches exactly one listener for the lifetime of the hook', () => {
    const d = defaultLayout()
    const spyAdd = vi.spyOn(window, 'addEventListener')
    const spyRemove = vi.spyOn(window, 'removeEventListener')
    const { unmount, rerender } = renderHook(() => useHarness(d))
    const addedBefore = spyAdd.mock.calls.filter((c) => c[0] === 'keydown').length
    // Force the hook to re-render; the listener count should not grow.
    rerender()
    rerender()
    rerender()
    const addedAfter = spyAdd.mock.calls.filter((c) => c[0] === 'keydown').length
    expect(addedAfter).toBe(addedBefore)
    unmount()
    const removedAfter = spyRemove.mock.calls.filter((c) => c[0] === 'keydown').length
    expect(removedAfter).toBeGreaterThanOrEqual(1)
    spyAdd.mockRestore()
    spyRemove.mockRestore()
  })
})
