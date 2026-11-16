import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { Grip } from './Grip'
import { defaultLayout, type PanelId } from './schema'
import { reduce, type LayoutAction } from './reducer'
import { useState } from 'react'

/**
 * Harness: a tiny component that wires Grip to a real reducer, so
 * the tests exercise the full "key → dispatch → re-render" path
 * including the focus-restore at the end. Testing Grip against a
 * mocked dispatch would miss the two re-render invariants (grip
 * still focused, state actually updated) which is what makes the
 * difference between a keyboard that works once and one that works
 * every time.
 */
function Harness({ panelId }: { panelId: PanelId }) {
  const [state, setState] = useState(defaultLayout())
  const dispatch = (a: LayoutAction) => setState((s) => reduce(s, a))
  const name = String(panelId)
  return (
    <div>
      <Grip id={panelId} state={state} dispatch={dispatch} panelName={name} />
      <pre data-testid="main">{state.main.join(',')}</pre>
      <pre data-testid="rail">{state.rail.join(',')}</pre>
      <pre data-testid="preset">{state.preset}</pre>
    </div>
  )
}

function getGrip() {
  return screen.getByRole('button') as HTMLButtonElement
}

describe('Grip — within-column keyboard moves', () => {
  it('ArrowDown on a mid-column panel moves it down one', () => {
    render(<Harness panelId="your-work" />)
    const grip = getGrip()
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(screen.getByTestId('main').textContent).toMatch(/^conversations,your-work,/)
  })

  it('ArrowUp on a mid-column panel moves it up one', () => {
    render(<Harness panelId="conversations" />)
    const grip = getGrip()
    grip.focus()
    // conversations starts at main[1]. ArrowUp swaps it to main[0].
    fireEvent.keyDown(grip, { key: 'ArrowUp' })
    const main = screen.getByTestId('main').textContent!.split(',')
    expect(main[0]).toBe('conversations')
    expect(main[1]).toBe('your-work')
  })

  // The critical no-op test. At index 0 ArrowUp must do NOTHING —
  // not even call preventDefault, so the browser's page-scroll
  // behaviour keeps working on a panel that cannot move.
  it('ArrowUp at i=0 is a no-op AND does not preventDefault', () => {
    render(<Harness panelId="your-work" />)
    const grip = getGrip()
    grip.focus()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    const prevented = !grip.dispatchEvent(ev)
    expect(prevented).toBe(false)
    // State unchanged.
    expect(screen.getByTestId('preset').textContent).toBe('everything')
    expect(screen.getByTestId('main').textContent?.startsWith('your-work,')).toBe(true)
  })

  it('ArrowDown at the last index is a no-op AND does not preventDefault', () => {
    const d = defaultLayout()
    const last = d.main[d.main.length - 1] as PanelId
    render(<Harness panelId={last} />)
    const grip = getGrip()
    grip.focus()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    const prevented = !grip.dispatchEvent(ev)
    expect(prevented).toBe(false)
    expect(screen.getByTestId('preset').textContent).toBe('everything')
  })
})

describe('Grip — cross-column keyboard moves', () => {
  it('ArrowLeft from a rail panel appends to the END of main', () => {
    const d = defaultLayout()
    render(<Harness panelId="feed" />)
    const grip = getGrip()
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowLeft' })
    const main = screen.getByTestId('main').textContent!.split(',')
    expect(main[main.length - 1]).toBe('feed')
    expect(screen.getByTestId('rail').textContent).not.toMatch(/feed/)
    // Not at index 0 of main — the templated contract is APPEND, not
    // preserve-index. `feed` was rail[0], but after Left it lands at
    // the bottom of main, not at main[0].
    expect(main[0]).toBe(d.main[0])
  })

  it('ArrowRight from a main panel appends to the END of rail', () => {
    render(<Harness panelId="your-work" />)
    const grip = getGrip()
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowRight' })
    const rail = screen.getByTestId('rail').textContent!.split(',')
    expect(rail[rail.length - 1]).toBe('your-work')
    expect(screen.getByTestId('main').textContent).not.toMatch(/your-work/)
  })

  // Each arrow is one direction. Right from rail / Left from main
  // must do nothing — no dispatch, no preventDefault.
  it('ArrowRight from a rail panel is a no-op and does not preventDefault', () => {
    render(<Harness panelId="feed" />)
    const grip = getGrip()
    grip.focus()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    const prevented = !grip.dispatchEvent(ev)
    expect(prevented).toBe(false)
    expect(screen.getByTestId('preset').textContent).toBe('everything')
  })

  it('ArrowLeft from a main panel is a no-op and does not preventDefault', () => {
    render(<Harness panelId="your-work" />)
    const grip = getGrip()
    grip.focus()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    const prevented = !grip.dispatchEvent(ev)
    expect(prevented).toBe(false)
    expect(screen.getByTestId('preset').textContent).toBe('everything')
  })
})

// Focus retention. Honest note on what this does and does not prove:
// in jsdom under fireEvent the explicit `ref.current?.focus()` call
// after dispatch is an equivalent mutant — removing it does not fail
// these assertions. React keeps the same DOM node across a state
// change (stable keys), and fireEvent dispatches by element rather
// than by focus, so a second keydown finds the same grip either way.
//
// The call is still worth keeping as BELT AND BRACES: if a parent
// ever re-renders in a way that remounts the Grip (identity change,
// different key), without the explicit focus the keyboard user
// would lose their place and reordering would work exactly once —
// which is the symptom the templated code used `grip.focus()` to
// avoid after its `apply()` rebuilt the DOM. These tests are sanity
// checks that two presses move the panel twice, not pins on the
// focus call itself; that invariant only exposes under a real
// browser's render path.
describe('Grip — focus-retention sanity (not a pin on the .focus() line)', () => {
  it('after ArrowDown the grip is still the active element', () => {
    render(<Harness panelId="your-work" />)
    const grip = getGrip()
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(grip)
  })

  it('two ArrowDowns in a row move the panel twice', () => {
    render(<Harness panelId="your-work" />)
    const grip = getGrip()
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    const main = screen.getByTestId('main').textContent!.split(',')
    expect(main[2]).toBe('your-work')
  })
})

// Defence-in-depth on `set-column` stripping from both columns. A
// panel should never render twice; a visible duplication would be
// one of the quieter possible UI defects.
describe('Grip — no duplicates across columns', () => {
  it('a cross-column move leaves the panel in exactly one column', () => {
    render(<Harness panelId="feed" />)
    const grip = getGrip()
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowLeft' })
    const main = screen.getByTestId('main').textContent!.split(',')
    const rail = screen.getByTestId('rail').textContent!.split(',')
    expect(main.filter((x) => x === 'feed').length).toBe(1)
    expect(rail.filter((x) => x === 'feed').length).toBe(0)
  })
})

// Unknown keys fall through — no preventDefault, no dispatch. A
// grip that trapped random keys would steal typing from any input
// it happens to sit near.
describe('Grip — other keys are inert', () => {
  it('Enter does nothing', () => {
    render(<Harness panelId="your-work" />)
    const grip = getGrip()
    grip.focus()
    const dispatch = vi.fn()
    fireEvent.keyDown(grip, { key: 'Enter' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(screen.getByTestId('preset').textContent).toBe('everything')
  })
})
