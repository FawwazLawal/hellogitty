import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLayout, initialLayout } from './useLayout'
import { STORAGE_KEYS, type LayoutState } from './schema'

/**
 * These tests pin the hook's two contracts the rest of #282 reads:
 *
 *   - popup mode writes NOTHING to storage, not even indirectly;
 *   - a write that throws surfaces as `writeError`, not silence.
 *
 * Per peer's note on uncaught mutations, the popup-never-writes
 * test uses a SPY on `setItem` with zero calls asserted, not a
 * patched-out noop. A spy with no calls is a positive assertion;
 * a patched-out setItem that was never reached and one that was
 * never called look identical, which is category two ("the patch
 * never applied") waiting to happen.
 */

class SpyStorage implements Storage {
  private store = new Map<string, string>()
  readonly getItemCalls: string[] = []
  readonly setItemCalls: Array<[string, string]> = []
  throwOnGet: Error | null = null
  throwOnSet: Error | null = null
  getItem(k: string): string | null {
    this.getItemCalls.push(k)
    if (this.throwOnGet) throw this.throwOnGet
    return this.store.has(k) ? this.store.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.setItemCalls.push([k, v])
    if (this.throwOnSet) throw this.throwOnSet
    this.store.set(k, v)
  }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
  key(i: number): string | null { return [...this.store.keys()][i] ?? null }
  get length(): number { return this.store.size }
  plant(k: string, v: string): void { this.store.set(k, v) }
}

describe('initialLayout — pre-hook resolution', () => {
  it('ext=popup bypasses storage reads and returns the focus preset', () => {
    const s = new SpyStorage()
    s.plant(STORAGE_KEYS.layout, JSON.stringify({ preset: 'maintainer' }))
    const r = initialLayout({ search: '?ext=popup', configDefault: null, storage: s })
    expect(r.source).toBe('popup')
    expect(r.state.preset).toBe('focus')
    // The whole point of ext=popup: the storage read never ran.
    expect(s.getItemCalls).toEqual([])
  })

  it('without popup, reads the planted layout', () => {
    const s = new SpyStorage()
    s.plant(STORAGE_KEYS.layout, JSON.stringify({
      preset: 'maintainer',
      main: ['your-work'], rail: ['feed'], hidden: [], folded: [], sizes: {},
    }))
    const r = initialLayout({ search: '', configDefault: null, storage: s })
    expect(r.source).toBe('saved')
    expect(r.state.preset).toBe('maintainer')
  })

  it('surfaces a storage-disabled read as a warning without blocking render', () => {
    const s = new SpyStorage()
    s.throwOnGet = new Error('SecurityError: storage disabled')
    const r = initialLayout({ search: '', configDefault: null, storage: s })
    expect(r.state.preset).toBe('everything')
    expect(r.warning).toContain('storage disabled')
  })
})

describe('useLayout — popup mode writes nothing', () => {
  it('a popup session dispatches freely and setItem is never called', () => {
    const s = new SpyStorage()
    const { result } = renderHook(() =>
      useLayout({ search: '?ext=popup', configDefault: null, storage: s }),
    )
    expect(result.current.isPopup).toBe(true)
    expect(result.current.state.preset).toBe('focus')

    // Dispatch several edits — these would fire setItem in a normal
    // session. A spy with zero calls after them is the positive
    // assertion the popup half of the ext=popup contract needs.
    act(() => result.current.dispatch({ type: 'toggle-hidden', id: 'tracked' }))
    act(() => result.current.dispatch({ type: 'toggle-folded', id: 'checks' }))
    act(() => result.current.dispatch({ type: 'set-size', id: 'your-work', px: 500 }))

    expect(s.setItemCalls).toEqual([])
    // Reads during initialLayout are also skipped in popup mode.
    expect(s.getItemCalls).toEqual([])
  })
})

describe('useLayout — non-popup persists', () => {
  it('a dispatch writes the resulting state to the layout key', () => {
    const s = new SpyStorage()
    const { result } = renderHook(() =>
      useLayout({ search: '', configDefault: null, storage: s }),
    )
    expect(result.current.isPopup).toBe(false)

    act(() => result.current.dispatch({ type: 'toggle-hidden', id: 'tracked' }))

    expect(s.setItemCalls.length).toBe(1)
    const [key, value] = s.setItemCalls[0]
    expect(key).toBe(STORAGE_KEYS.layout)
    const written = JSON.parse(value)
    expect(written.version).toBe(1)
    expect(written.state.preset).toBe('custom')
    expect(written.state.hidden).toContain('tracked')
  })

  it('a failed write surfaces as writeError, not silence', () => {
    const s = new SpyStorage()
    s.throwOnSet = new Error('QuotaExceededError: storage full')
    const { result } = renderHook(() =>
      useLayout({ search: '', configDefault: null, storage: s }),
    )
    expect(result.current.writeError).toBeUndefined()
    act(() => result.current.dispatch({ type: 'toggle-hidden', id: 'tracked' }))
    expect(result.current.writeError).toContain('QuotaExceededError')
    // The screen still reflects the edit — a failed save does not
    // block rendering, it only tells the user the change is not
    // persisted.
    expect(result.current.state.hidden).toContain('tracked')
  })

  it('a subsequent successful write clears writeError', () => {
    const s = new SpyStorage()
    s.throwOnSet = new Error('QuotaExceededError')
    const { result } = renderHook(() =>
      useLayout({ search: '', configDefault: null, storage: s }),
    )
    act(() => result.current.dispatch({ type: 'toggle-hidden', id: 'tracked' }))
    expect(result.current.writeError).toBeTruthy()
    // Repair the storage and try again.
    s.throwOnSet = null
    act(() => result.current.dispatch({ type: 'toggle-folded', id: 'checks' }))
    expect(result.current.writeError).toBeUndefined()
  })
})

describe('useLayout — warnings and source', () => {
  it('unreachable storage renders the default and carries a warning', () => {
    const s = new SpyStorage()
    s.throwOnGet = new Error('SecurityError: storage disabled')
    const { result } = renderHook(() =>
      useLayout({ search: '', configDefault: null, storage: s }),
    )
    expect(result.current.source).toBe('default')
    expect(result.current.warning).toContain('storage disabled')
    expect(result.current.state.preset).toBe('everything')
  })

  it('a future-version read does NOT clobber the storage', () => {
    const s = new SpyStorage()
    s.plant(STORAGE_KEYS.layout, JSON.stringify({ version: 999, state: { preset: 'maintainer' } }))
    const before = s.setItemCalls.length
    const { result } = renderHook(() =>
      useLayout({ search: '', configDefault: null, storage: s }),
    )
    expect(result.current.source).toBe('default')
    expect(result.current.warning).toContain('version 999')
    // Mount alone writes nothing — persistence is only on dispatch.
    expect(s.setItemCalls.length).toBe(before)
  })

  it('config default is taken when nothing is saved', () => {
    const s = new SpyStorage()
    const { result } = renderHook(() =>
      useLayout({
        search: '',
        configDefault: JSON.stringify({ preset: 'contributor' }),
        storage: s,
      }),
    )
    expect(result.current.source).toBe('config')
    expect(result.current.state.preset).toBe('contributor')
  })
})

// A reducer-by-reducer sanity check: the hook's dispatch really runs
// the pure reducer, and the state it exposes equals reduce(prev, action).
describe('useLayout — reducer transparency', () => {
  it('dispatching move-within-column mutates the state as the reducer says it would', () => {
    const s = new SpyStorage()
    const { result } = renderHook(() =>
      useLayout({ search: '', configDefault: null, storage: s }),
    )
    const before: LayoutState = result.current.state
    act(() =>
      result.current.dispatch({ type: 'move-within-column', id: 'conversations', delta: -1 }),
    )
    expect(result.current.state.main[0]).toBe('conversations')
    expect(before.main[0]).toBe('your-work')
  })
})

// A mutation-defence smoke check: this test uses vi.spyOn to shadow
// the real setItem, and asserts the spy's count. If a future refactor
// replaces the write path with something that circumvents the storage
// argument we pass in (e.g., reaching to window.localStorage
// directly), the spy will see zero calls where the earlier test saw
// one — a positive-count assertion is what catches that, not a
// patched-out noop.
describe('useLayout — the spy proves calls were made', () => {
  it('dispatch triggers setItem on the provided storage, not the ambient one', () => {
    const s = new SpyStorage()
    const setItem = vi.spyOn(s, 'setItem')
    const { result } = renderHook(() =>
      useLayout({ search: '', configDefault: null, storage: s }),
    )
    act(() => result.current.dispatch({ type: 'toggle-hidden', id: 'tracked' }))
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem.mock.calls[0]?.[0]).toBe(STORAGE_KEYS.layout)
  })
})
