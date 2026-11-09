import { describe, expect, it } from 'vitest'
import { reduce, stateEq, columnOf, type LayoutAction } from './reducer'
import { defaultLayout, PRESETS, type LayoutState } from './schema'

/**
 * These tests pin the reducer's two load-bearing claims:
 *
 *   1. Every non-preset edit turns the layout into "custom" and
 *      remembers the preset it drifted from in `base`. The Reset
 *      button exists for exactly that signal — losing it would
 *      leave the button pointing nowhere useful.
 *
 *   2. `select-preset` and `reset-to-base` are the only two ways
 *      OUT of custom. Both perform a wholesale replacement because
 *      a preset is the user declaring that custom no longer
 *      describes them, same reasoning as the templated code.
 *
 * Each action also has the obvious correctness tests — swap in
 * bounds, move across columns, toggle idempotent, etc.
 */

const d = defaultLayout()

describe('toggle-hidden', () => {
  it('adds a panel not currently hidden', () => {
    const next = reduce(d, { type: 'toggle-hidden', id: 'tracked' })
    expect(next.hidden).toContain('tracked')
  })
  it('removes a panel that IS currently hidden', () => {
    const start: LayoutState = { ...d, hidden: ['tracked'] }
    const next = reduce(start, { type: 'toggle-hidden', id: 'tracked' })
    expect(next.hidden).not.toContain('tracked')
  })
  it('marks the state as custom and records base', () => {
    const next = reduce(d, { type: 'toggle-hidden', id: 'tracked' })
    expect(next.preset).toBe('custom')
    expect(next.base).toBe('everything')
  })
})

describe('toggle-folded', () => {
  it('toggles folded membership', () => {
    const a = reduce(d, { type: 'toggle-folded', id: 'checks' })
    expect(a.folded).toContain('checks')
    const b = reduce(a, { type: 'toggle-folded', id: 'checks' })
    expect(b.folded).not.toContain('checks')
  })
})

describe('move-within-column', () => {
  it('swaps a panel up by one', () => {
    const next = reduce(d, { type: 'move-within-column', id: 'conversations', delta: -1 })
    // conversations started second in main; after -1 it's first.
    expect(next.main[0]).toBe('conversations')
    expect(next.main[1]).toBe('your-work')
  })
  it('swaps a panel down by one', () => {
    const next = reduce(d, { type: 'move-within-column', id: 'your-work', delta: 1 })
    expect(next.main[0]).toBe('conversations')
    expect(next.main[1]).toBe('your-work')
  })
  it('is a no-op at the top of the column', () => {
    const next = reduce(d, { type: 'move-within-column', id: 'your-work', delta: -1 })
    expect(next).toBe(d)
  })
  it('is a no-op at the bottom of the column', () => {
    const last = d.rail[d.rail.length - 1]
    const next = reduce(d, { type: 'move-within-column', id: last, delta: 1 })
    expect(next).toBe(d)
  })
})

describe('move-across-columns', () => {
  it('moves a main-column panel to the rail at its visual index', () => {
    const next = reduce(d, { type: 'move-across-columns', id: 'your-work' })
    expect(next.rail[0]).toBe('your-work')
    expect(next.main).not.toContain('your-work')
  })
  it('moves a rail panel to main', () => {
    const next = reduce(d, { type: 'move-across-columns', id: 'feed' })
    expect(next.main).toContain('feed')
    expect(next.rail).not.toContain('feed')
  })
  it('clamps the destination index when the other column is shorter', () => {
    // Deep in rail (6 panels) → main (4 panels at start). Index 5 clamps to 4.
    const deep = d.rail[5] // 'checks'
    const next = reduce(d, { type: 'move-across-columns', id: deep })
    // Dropped at the end of main.
    expect(next.main[next.main.length - 1]).toBe(deep)
  })
})

describe('set-column', () => {
  it('moves a panel to the named column, appended at the end', () => {
    const next = reduce(d, { type: 'set-column', id: 'your-work', column: 'rail' })
    expect(next.main).not.toContain('your-work')
    expect(next.rail[next.rail.length - 1]).toBe('your-work')
  })
  it('is a no-op if already in the target column', () => {
    const next = reduce(d, { type: 'set-column', id: 'your-work', column: 'main' })
    expect(next).toBe(d)
  })
})

describe('set-size / clear-size', () => {
  it('rounds and stores a size', () => {
    const next = reduce(d, { type: 'set-size', id: 'your-work', px: 412.4 })
    expect(next.sizes['your-work']).toBe(412)
  })
  it('refuses a zero or negative size', () => {
    expect(reduce(d, { type: 'set-size', id: 'your-work', px: 0 })).toBe(d)
    expect(reduce(d, { type: 'set-size', id: 'your-work', px: -5 })).toBe(d)
  })
  it('clear-size removes the entry', () => {
    const sized = { ...d, sizes: { ...d.sizes, tracked: 400 } }
    const next = reduce(sized, { type: 'clear-size', id: 'tracked' })
    expect(next.sizes.tracked).toBeUndefined()
  })
  it('clear-size on a missing entry is a no-op', () => {
    const clean = { ...d, sizes: {} }
    const next = reduce(clean, { type: 'clear-size', id: 'tracked' })
    expect(next).toBe(clean)
  })
})

describe('select-preset', () => {
  it('wholesale-replaces the state with a built-in preset', () => {
    const next = reduce(d, { type: 'select-preset', preset: 'focus' })
    expect(next.preset).toBe('focus')
    // focus hides nine panels — that's the signature test.
    expect(next.hidden.length).toBeGreaterThanOrEqual(9)
    expect(next.base).toBeUndefined()
  })
  it('clears base, because custom no longer applies', () => {
    const custom: LayoutState = {
      ...d,
      preset: 'custom',
      base: 'contributor',
      hidden: ['checks'],
    }
    const next = reduce(custom, { type: 'select-preset', preset: 'maintainer' })
    expect(next.preset).toBe('maintainer')
    expect(next.base).toBeUndefined()
  })
  it('a user:* preset carries the provided fixture through normalize', () => {
    const user: LayoutState = {
      ...PRESETS.maintainer,
      preset: 'user:my-triage',
      hidden: ['checks', 'security'],
    }
    const next = reduce(d, {
      type: 'select-preset',
      preset: 'user:my-triage',
      userPreset: user,
    })
    expect(next.preset).toBe('user:my-triage')
    expect(next.hidden).toContain('checks')
  })
})

describe('reset-to-base', () => {
  it('restores the preset stored in base and clears custom', () => {
    const start = reduce(d, { type: 'toggle-hidden', id: 'tracked' })
    expect(start.preset).toBe('custom')
    expect(start.base).toBe('everything')
    const next = reduce(start, { type: 'reset-to-base' })
    expect(next.preset).toBe('everything')
    expect(next.hidden).not.toContain('tracked')
    expect(next.base).toBeUndefined()
  })
  it('is a no-op when base is not a built-in (e.g. user: or custom)', () => {
    const start: LayoutState = { ...d, base: 'user:my', preset: 'custom' }
    const next = reduce(start, { type: 'reset-to-base' })
    expect(next).toBe(start)
  })
})

describe('"custom + base" marking', () => {
  // Every non-preset mutation must end in preset=custom with base
  // pointing at where we came from. This is the Reset button's
  // whole contract — if a future action handler forgets to go
  // through asCustom(), this test tells you which.
  it.each<[string, LayoutAction]>([
    ['toggle-hidden', { type: 'toggle-hidden', id: 'tracked' }],
    ['toggle-folded', { type: 'toggle-folded', id: 'checks' }],
    ['move-within-column up', { type: 'move-within-column', id: 'conversations', delta: -1 }],
    ['move-across-columns', { type: 'move-across-columns', id: 'feed' }],
    ['set-column', { type: 'set-column', id: 'your-work', column: 'rail' }],
    ['set-size', { type: 'set-size', id: 'tracked', px: 400 }],
  ])('%s → preset=custom, base=everything', (_, action) => {
    const next = reduce(d, action)
    expect(next.preset).toBe('custom')
    expect(next.base).toBe('everything')
  })
})

describe('stateEq', () => {
  it('ignores preset and base when comparing', () => {
    const a = defaultLayout()
    const b = { ...defaultLayout(), preset: 'custom' as const, base: 'everything' as const }
    expect(stateEq(a, b)).toBe(true)
  })
  it('catches a difference in main ordering', () => {
    const a = defaultLayout()
    const b = { ...a, main: [...a.main].reverse() }
    expect(stateEq(a, b)).toBe(false)
  })
  it('catches a difference in sizes', () => {
    const a = defaultLayout()
    const b = { ...a, sizes: { ...a.sizes, tracked: a.sizes.tracked! + 1 } }
    expect(stateEq(a, b)).toBe(false)
  })
})

describe('columnOf', () => {
  it('finds main and rail panels', () => {
    expect(columnOf(d, 'your-work')).toBe('main')
    expect(columnOf(d, 'feed')).toBe('rail')
  })
})
