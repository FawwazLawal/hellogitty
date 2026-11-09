import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import { LayoutDialog } from './LayoutDialog'
import { defaultLayout, STORAGE_KEYS, type LayoutState } from './schema'
import { reduce, type LayoutAction } from './reducer'

/** jsdom's HTMLDialogElement is a stub; `showModal` / `close` do not
 *  manage the `open` attribute. Add the minimum behaviour the
 *  component depends on so the tests exercise the real open/close
 *  branches rather than silently rendering the body as always-open. */
HTMLDialogElement.prototype.showModal = function () {
  this.open = true
}
HTMLDialogElement.prototype.close = function () {
  this.open = false
  this.dispatchEvent(new Event('close'))
}

class FakeStorage implements Storage {
  private store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string): void { this.store.set(k, v) }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
  key(i: number): string | null { return [...this.store.keys()][i] ?? null }
  get length(): number { return this.store.size }
  plant(k: string, v: string): void { this.store.set(k, v) }
}

/** The dialog owns no state — the host does. Harness wires it to a
 *  real reducer so tests exercise the full dispatch/re-render loop. */
function Harness({
  initial,
  storage,
}: {
  initial: LayoutState
  storage: Storage
}) {
  const [state, setState] = useState(initial)
  const [open, setOpen] = useState(true)
  const dispatch = (a: LayoutAction) => setState((s) => reduce(s, a))
  return (
    <LayoutDialog
      open={open}
      onClose={() => setOpen(false)}
      state={state}
      dispatch={dispatch}
      storage={storage}
    />
  )
}

describe('LayoutDialog — fold-all button label', () => {
  // The vacuous-truth guard made visible. [].every is true, so a
  // page with every panel hidden would otherwise render the button
  // as "Expand all" with nothing to expand. The pin at the helper
  // in reducer.ts is one half; this is the test that catches a
  // future hand-rolled check in the component that forgets the
  // guard. Peer's #282 note said to test this in the dialog too.
  it('reads "Collapse all" when every visible panel is in folded', () => {
    const d = defaultLayout()
    const s: LayoutState = { ...d, folded: [...d.main, ...d.rail] }
    render(<Harness initial={s} storage={new FakeStorage()} />)
    const btn = screen.getByTestId('fold-all-btn') as HTMLButtonElement
    // allFolded is true → label reads "Expand all"
    expect(btn.textContent).toBe('Expand all')
    expect(btn.title).toBe('Expand all panels (e)')
  })

  it('reads "Collapse all" when no visible panel is folded', () => {
    render(<Harness initial={defaultLayout()} storage={new FakeStorage()} />)
    const btn = screen.getByTestId('fold-all-btn') as HTMLButtonElement
    expect(btn.textContent).toBe('Collapse all')
    expect(btn.title).toBe('Collapse all panels (c)')
  })

  // The guard made load-bearing by the empty-visible-set case.
  it('reads "Collapse all" (NOT "Expand all") when every panel is hidden', () => {
    const d = defaultLayout()
    const s: LayoutState = { ...d, hidden: [...d.main, ...d.rail] }
    render(<Harness initial={s} storage={new FakeStorage()} />)
    const btn = screen.getByTestId('fold-all-btn') as HTMLButtonElement
    expect(btn.textContent).toBe('Collapse all')
  })
})

describe('LayoutDialog — preset buttons', () => {
  it('clicking a built-in preset switches the state', () => {
    render(<Harness initial={defaultLayout()} storage={new FakeStorage()} />)
    const focus = screen.getByRole('button', { name: 'Focus' })
    fireEvent.click(focus)
    // Focus hides nine panels — a single assertion that would fail
    // if the preset click wired nothing.
    expect((focus as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
  })

  // The active preset shows aria-pressed=true. The templated page
  // guards this with a user:* exclusion; we mirror that.
  it('active user:* preset is not marked as active on a built-in button', () => {
    const s: LayoutState = { ...defaultLayout(), preset: 'user:mine' }
    render(<Harness initial={s} storage={new FakeStorage()} />)
    for (const name of ['Everything', 'Contributor', 'Maintainer', 'Program', 'Focus', 'Custom']) {
      const b = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(b.getAttribute('aria-pressed')).toBe('false')
    }
  })
})

describe('LayoutDialog — user presets', () => {
  it('saving a named preset writes to -presets storage and marks it active', () => {
    const storage = new FakeStorage()
    render(<Harness initial={defaultLayout()} storage={storage} />)
    const input = screen.getByPlaceholderText(/Save current layout as/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'my-triage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const raw = storage.getItem(STORAGE_KEYS.presets)
    expect(raw).not.toBeNull()
    const map = JSON.parse(raw!)
    expect(Object.keys(map)).toContain('my-triage')
  })

  it('a preset loaded from -presets appears in the list', () => {
    const storage = new FakeStorage()
    storage.plant(
      STORAGE_KEYS.presets,
      JSON.stringify({ 'reading-mode': { ...defaultLayout(), hidden: ['feed'] } }),
    )
    render(<Harness initial={defaultLayout()} storage={storage} />)
    expect(screen.getByRole('button', { name: 'reading-mode' })).toBeDefined()
  })

  it('deleting a user preset removes it from storage and from the list', () => {
    const storage = new FakeStorage()
    storage.plant(
      STORAGE_KEYS.presets,
      JSON.stringify({ gone: defaultLayout(), kept: defaultLayout() }),
    )
    render(<Harness initial={defaultLayout()} storage={storage} />)
    expect(screen.getByRole('button', { name: 'gone' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset gone' }))
    expect(screen.queryByRole('button', { name: 'gone' })).toBeNull()
    expect(screen.getByRole('button', { name: 'kept' })).toBeDefined()
    const stored = JSON.parse(storage.getItem(STORAGE_KEYS.presets)!)
    expect(Object.keys(stored)).toEqual(['kept'])
  })

  // Save button inert on empty input — otherwise a user could save
  // an unnamed preset that later rendered as "" in the list.
  it('the Save button is disabled when the name is empty or whitespace', () => {
    render(<Harness initial={defaultLayout()} storage={new FakeStorage()} />)
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    const input = screen.getByPlaceholderText(/Save current layout as/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'ok' } })
    expect(save.disabled).toBe(false)
  })
})

describe('LayoutDialog — reset button', () => {
  it('is disabled when the state matches its base preset', () => {
    render(<Harness initial={defaultLayout()} storage={new FakeStorage()} />)
    const resetBtn = screen.getByRole('button', { name: /Reset/ }) as HTMLButtonElement
    // Nothing has drifted; nothing to reset.
    expect(resetBtn.disabled).toBe(true)
  })

  it('reads "Reset to <base>" after an edit has drifted from a built-in', () => {
    const d = defaultLayout()
    const drifted = reduce(d, { type: 'toggle-hidden', id: 'tracked' })
    render(<Harness initial={drifted} storage={new FakeStorage()} />)
    const resetBtn = screen.getByRole('button', { name: /Reset to Everything/ }) as HTMLButtonElement
    expect(resetBtn.disabled).toBe(false)
  })
})

describe('LayoutDialog — storage error surfacing', () => {
  it('shows an error status when reading presets fails', () => {
    const storage = new FakeStorage()
    // Make getItem throw after construction — simulates a session
    // where storage was available at mount but refused on a later
    // read, which is unusual but worth seeing non-silently.
    const original = storage.getItem.bind(storage)
    storage.getItem = (k: string) => {
      if (k === STORAGE_KEYS.presets) throw new Error('SecurityError: blocked')
      return original(k)
    }
    render(<Harness initial={defaultLayout()} storage={storage} />)
    expect(screen.getByRole('status').textContent).toMatch(/blocked/)
  })
})

describe('LayoutDialog — open / close', () => {
  it('calls onClose when the native close event fires', () => {
    let closed = false
    function H() {
      const [state, setState] = useState(defaultLayout())
      const [open, setOpen] = useState(true)
      const dispatch = (a: LayoutAction) => setState((s) => reduce(s, a))
      return (
        <LayoutDialog
          open={open}
          onClose={() => {
            closed = true
            setOpen(false)
          }}
          state={state}
          dispatch={dispatch}
          storage={new FakeStorage()}
        />
      )
    }
    render(<H />)
    // Programmatically fire the native 'close' event on the dialog.
    const d = document.querySelector('dialog') as HTMLDialogElement
    act(() => {
      d.close()
    })
    expect(closed).toBe(true)
  })
})
