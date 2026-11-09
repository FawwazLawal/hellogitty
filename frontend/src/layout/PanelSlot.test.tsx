import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { PanelSlot } from './PanelSlot'
import { defaultLayout, type LayoutState } from './schema'
import { reduce, type LayoutAction } from './reducer'

/**
 * The Grip-doesn't-remount pin, now where it belongs.
 *
 * Earlier framing (in #337's commit): "jsdom cannot prove this
 * because fireEvent dispatches to a specific element regardless
 * of focus and React keeps the same node either way." That is
 * true of FOCUS. It is not true of NODE IDENTITY. jsdom reflects
 * remounts faithfully — if a parent's key changes between
 * renders, React unmounts and remounts and `oldNode === newNode`
 * goes false, no browser required. So the invariant worth
 * pinning is: dispatching a fold does not remount the grip,
 * because the slot's key is stable.
 *
 * The negative mutant peer demonstrated — `key={`${id}-${state.folded.length}`}`
 * on PanelSlot — would fail this test by causing the grip to
 * become a new DOM node on every fold. The symptom in a real
 * browser is "keyboard reordering works exactly once" because
 * focus is lost on the remount; `grip.focus()` exists in the
 * component precisely to belt-and-braces that, and the ref
 * would still reach the new node. But the ref re-mounting is
 * itself the defect this test catches — before focus is even
 * at issue.
 */

/**
 * Harness mirrors App.tsx's render pattern — importantly, the
 * `key={id}` on each PanelSlot. A naive test that leaves off the
 * key would rely on React's position-based auto-key and would
 * stay green against the specific mutation peer named on #337:
 * `key={`${id}-${state.folded.length}`}`. By writing the key
 * explicitly here we make the test SENSITIVE to the key choice,
 * which is the whole invariant.
 *
 * An additional `keyFn` prop lets the test inject the mutation
 * directly and prove the tool can see it — see
 * "state-derived key REMOUNTS the grip" below.
 */
function Harness({
  keyFn = (id: string) => id,
}: {
  keyFn?: (id: string, state: LayoutState) => string
}) {
  const [state, setState] = useState(defaultLayout())
  const dispatch = (a: LayoutAction) => setState((s) => reduce(s, a))
  const ids = ['your-work', 'conversations'] as const
  return (
    <>
      <button data-testid="fold-your-work" onClick={() => dispatch({ type: 'toggle-folded', id: 'your-work' })}>
        toggle your-work fold
      </button>
      <button data-testid="fold-conversations" onClick={() => dispatch({ type: 'toggle-folded', id: 'conversations' })}>
        toggle conversations fold
      </button>
      {ids.map((id) => (
        <PanelSlot key={keyFn(id, state)} id={id} panelName={id} state={state} dispatch={dispatch}>
          <section>
            <header>
              <h2>{id}</h2>
            </header>
            <div data-testid={`body-${id}`}>body</div>
          </section>
        </PanelSlot>
      ))}
    </>
  )
}

describe('PanelSlot — Grip identity is stable across dispatch', () => {
  it("dispatching a fold does NOT remount the panel's grip", () => {
    render(<Harness />)
    const gripBefore = document.querySelector('[data-grip-for="your-work"]') as HTMLButtonElement
    expect(gripBefore).not.toBeNull()
    // Dispatch a fold on a DIFFERENT panel so the panel's own
    // fold state has not changed either — if the grip's node
    // moves on this, it is the PARENT re-keying, not anything
    // the slot itself did.
    act(() => {
      fireEvent.click(screen.getByTestId('fold-conversations'))
    })
    const gripAfter = document.querySelector('[data-grip-for="your-work"]') as HTMLButtonElement
    expect(gripAfter).toBe(gripBefore)
  })

  it("dispatching a fold on the SAME panel also keeps the grip identity", () => {
    // This is the stronger case: folding my own panel re-renders
    // this slot. Node identity must still hold — React only
    // unmounts on a key change, and the slot's key is `id`, not
    // state-derived.
    render(<Harness />)
    const before = document.querySelector('[data-grip-for="your-work"]') as HTMLButtonElement
    act(() => {
      fireEvent.click(screen.getByTestId('fold-your-work'))
    })
    const after = document.querySelector('[data-grip-for="your-work"]') as HTMLButtonElement
    expect(after).toBe(before)
  })

  // Prove the tool is sensitive. Peer's mutation on #337 was to
  // change `key={id}` to `key={`${id}-${state.folded.length}`}`
  // in App.tsx. This test applies that exact mutation to the
  // harness (via the keyFn prop) and asserts the grip IS
  // remounted. If this test ever starts passing — meaning the
  // mutated key no longer remounts — the first test above is
  // no longer a pin and the whole scheme is suspect. Belt and
  // braces, plus a demonstration that the identity check
  // genuinely goes red when the key goes wrong.
  it('state-derived key REMOUNTS the grip (sensitivity check for the pin above)', () => {
    render(<Harness keyFn={(id, state) => `${id}-${state.folded.length}`} />)
    const before = document.querySelector('[data-grip-for="your-work"]') as HTMLButtonElement
    act(() => {
      fireEvent.click(screen.getByTestId('fold-your-work'))
    })
    const after = document.querySelector('[data-grip-for="your-work"]') as HTMLButtonElement
    expect(after).not.toBe(before)
  })

  // Sibling observation: the resize bar is REMOVED from the DOM
  // on fold (see PanelSlot: `!folded && <PanelResize ... />`).
  // That is a deliberate different treatment from the grip: a
  // folded header has no visible bottom edge, so the bar's
  // natural behaviour is to not exist. Pin the difference so a
  // well-meaning refactor that hoists the bar outside the fold
  // guard does not go unnoticed.
  it('the resize bar IS removed when the panel folds (grip is not; they differ on purpose)', () => {
    render(<Harness />)
    expect(document.querySelector('[data-presize-for="your-work"]')).not.toBeNull()
    act(() => {
      fireEvent.click(screen.getByTestId('fold-your-work'))
    })
    expect(document.querySelector('[data-presize-for="your-work"]')).toBeNull()
    // Grip is still right where it was.
    expect(document.querySelector('[data-grip-for="your-work"]')).not.toBeNull()
  })

  it('sets data-folded on the slot when the panel is folded', () => {
    render(<Harness />)
    const slot = document.querySelector('[data-panel="your-work"]') as HTMLElement
    expect(slot.getAttribute('data-folded')).toBeNull()
    act(() => {
      fireEvent.click(screen.getByTestId('fold-your-work'))
    })
    expect(slot.getAttribute('data-folded')).toBe('true')
  })
})

/**
 * The snap callback the slot hands to PanelResize measures the
 * real DOM on each invocation. Testing that measurement in jsdom
 * is only honest for the SHAPE of the callback — the arithmetic
 * is pinned in snap.test.ts against the Go case set. Here we
 * only prove the callback is wired and reads from the slot's
 * section.
 */
describe('PanelSlot — snap plumbing', () => {
  it('non-opt-in panels do not expose data-snap-rows', () => {
    render(<Harness />)
    const slot = document.querySelector('[data-panel="your-work"]') as HTMLElement
    expect(slot.getAttribute('data-snap-rows')).toBeNull()
  })

  it('opt-in panels expose data-snap-rows', () => {
    function OptIn() {
      const [state, setState] = useState(defaultLayout())
      const dispatch = (a: LayoutAction) => setState((s) => reduce(s, a))
      return (
        <PanelSlot
          id="your-work"
          panelName="Your work"
          state={state}
          dispatch={dispatch}
          snapRows={true}
        >
          <section>
            <header>
              <h2>Your work</h2>
            </header>
          </section>
        </PanelSlot>
      )
    }
    render(<OptIn />)
    const slot = document.querySelector('[data-panel="your-work"]') as HTMLElement
    expect(slot.getAttribute('data-snap-rows')).toBe('true')
  })
})
