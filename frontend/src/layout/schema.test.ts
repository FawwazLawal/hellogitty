import { describe, expect, it } from 'vitest'
import {
  readLayout,
  writeLayout,
  normalize,
  resolveLayout,
  defaultLayout,
  migrateStoredSizes,
  isExtPopup,
  popupLayout,
  PRESETS,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  type LayoutState,
} from './schema'

/**
 * These tests pin the "absent is not invalid" rule at the storage boundary.
 *
 * Every invariant is phrased so it would fail against the plan that got
 * talked out of me on #282: "reject unknown versions, fall back to
 * default". The install base has no `version` field at all; treating
 * that as an unknown version deletes the named presets the user built
 * on /legacy. The tests say the correct behaviour in each fixture
 * rather than letting a future refactor silently pass by defaulting.
 */

/** A minimal fake Storage that lets us plant values and simulate
 *  throws — both `getItem` AND `setItem` can throw, and the two are
 *  different signals we must not collapse. */
class FakeStorage implements Storage {
  private store = new Map<string, string>()
  throwOnGet: Error | null = null
  throwOnSet: Error | null = null
  getItem(k: string): string | null {
    if (this.throwOnGet) throw this.throwOnGet
    return this.store.has(k) ? this.store.get(k)! : null
  }
  setItem(k: string, v: string): void {
    if (this.throwOnSet) throw this.throwOnSet
    this.store.set(k, v)
  }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
  key(i: number): string | null { return [...this.store.keys()][i] ?? null }
  get length(): number { return this.store.size }
  plant(k: string, v: string): void { this.store.set(k, v) }
}

// A real unversioned value as the templated page writes it. Taken
// from web/index.html:5224-ish `copy(p, preset)` — six fields, no
// envelope. This fixture is load-bearing: the whole point of the
// migration is that THIS value renders as saved, not as default.
const templatedV0 = {
  preset: 'maintainer',
  main: ['your-repos', 'your-work', 'conversations', 'tracked'],
  rail: ['feed', 'watched', 'issues', 'security', 'pipeline', 'checks'],
  hidden: [],
  folded: ['conversations'],
  sizes: { 'your-repos': 340, 'your-work': 600, tracked: 300 },
}

describe('readLayout — migration from the templated shape', () => {
  it('empty storage reads as kind=empty (first visit)', () => {
    const s = new FakeStorage()
    expect(readLayout(s).kind).toBe('empty')
  })

  // The critical test. A value written by the templated page has no
  // `version` field, and this is NOT an invalid document — it is
  // version 0, the shape we know exactly. The read must return `ok`
  // with the value migrated forward.
  it('a layout saved by the templated page (no version field) reads as saved', () => {
    const s = new FakeStorage()
    s.plant(STORAGE_KEYS.layout, JSON.stringify(templatedV0))
    const out = readLayout(s)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.migratedFrom).toBe(0)
    expect(out.value.preset).toBe('maintainer')
    expect(out.value.main).toEqual(['your-repos', 'your-work', 'conversations', 'tracked'])
    expect(out.value.folded).toEqual(['conversations'])
    expect(out.value.sizes['your-repos']).toBe(340)
  })

  it('a v1-envelope value reads without changing the state', () => {
    const s = new FakeStorage()
    s.plant(STORAGE_KEYS.layout, JSON.stringify({ version: 1, state: templatedV0 }))
    const out = readLayout(s)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.migratedFrom).toBe(1)
    expect(out.value.preset).toBe('maintainer')
  })

  // A value whose version is HIGHER than we understand is a newer
  // build having written. We must NOT clobber it — a user downgrading
  // and losing settings is the very defect the schema-version rule
  // exists to prevent.
  it('a future version returns kind=future and leaves the value in storage', () => {
    const s = new FakeStorage()
    const future = JSON.stringify({ version: SCHEMA_VERSION + 1, state: templatedV0 })
    s.plant(STORAGE_KEYS.layout, future)
    const out = readLayout(s)
    expect(out.kind).toBe('future')
    // Still there — the test proves we did not remove it.
    expect(s.getItem(STORAGE_KEYS.layout)).toBe(future)
  })

  // Storage disabled (incognito with site data blocked, enterprise
  // policies) is distinct from "nothing saved". Collapsing the two
  // tells a user with a saved layout that their first visit is now,
  // which is the exact shape of defect the rule exists to prevent.
  it('a getItem that throws returns kind=unreachable, not empty', () => {
    const s = new FakeStorage()
    s.throwOnGet = new Error('SecurityError: storage disabled')
    const out = readLayout(s)
    expect(out.kind).toBe('unreachable')
    if (out.kind !== 'unreachable') return
    expect(out.detail).toContain('storage disabled')
  })

  it('a malformed JSON value reads as empty, not as a thrown error', () => {
    const s = new FakeStorage()
    s.plant(STORAGE_KEYS.layout, '{garbage')
    expect(readLayout(s).kind).toBe('empty')
  })
})

describe('normalize', () => {
  it('drops unknown panel ids rather than rejecting the whole layout', () => {
    const shape = {
      ...templatedV0,
      main: ['your-work', 'defunct-panel', 'conversations'],
    }
    const out = normalize(shape)
    expect(out.main).not.toContain('defunct-panel' as never)
    expect(out.main).toContain('your-work')
    expect(out.main).toContain('conversations')
  })

  it('places a known panel absent from both columns in its default column', () => {
    const shape = { ...templatedV0, main: ['your-work'], rail: [] }
    const out = normalize(shape)
    // tracked defaults to main; feed defaults to rail; both missing in
    // the input should appear in their default column after normalize.
    expect(out.main).toContain('tracked')
    expect(out.rail).toContain('feed')
  })

  it('does not resurrect a hidden panel across normalize', () => {
    const shape = { ...templatedV0, hidden: ['tracked'] }
    const out = normalize(shape)
    expect(out.hidden).toContain('tracked')
  })

  it('an unrecognised preset becomes "custom" rather than an unknown value', () => {
    const shape = { ...templatedV0, preset: 'invented' }
    const out = normalize(shape)
    expect(out.preset).toBe('custom')
  })

  it('preserves a user:* preset name', () => {
    const shape = { ...templatedV0, preset: 'user:my-triage' }
    const out = normalize(shape)
    expect(out.preset).toBe('user:my-triage')
  })

  it('rounds sizes and drops non-positive values', () => {
    const shape = { ...templatedV0, sizes: { 'your-work': 600.6, feed: 0, tracked: -10 } }
    const out = normalize(shape)
    expect(out.sizes['your-work']).toBe(601)
    expect(out.sizes.feed).toBeUndefined()
    expect(out.sizes.tracked).toBeUndefined()
  })
})

describe('writeLayout', () => {
  it('stamps SCHEMA_VERSION on the written value', () => {
    const s = new FakeStorage()
    const out = writeLayout(templatedV0 as LayoutState, s)
    expect(out.ok).toBe(true)
    const stored = JSON.parse(s.getItem(STORAGE_KEYS.layout)!)
    expect(stored.version).toBe(SCHEMA_VERSION)
    expect(stored.state.preset).toBe('maintainer')
  })

  // A thrown setItem is a user-visible condition — storage is full, or
  // disabled. Returning {ok:false, detail} lets the caller render a
  // state, rather than silently losing the save.
  it('a setItem that throws returns {ok:false, detail}, not {ok:true}', () => {
    const s = new FakeStorage()
    s.throwOnSet = new Error('QuotaExceededError')
    const out = writeLayout(templatedV0 as LayoutState, s)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.detail).toContain('Quota')
  })
})

describe('resolveLayout — precedence saved > config default > everything', () => {
  it('saved value wins over a configured default', () => {
    const r = resolveLayout({
      saved: { kind: 'ok', value: normalize(templatedV0), migratedFrom: 0 },
      configDefault: JSON.stringify({ ...templatedV0, preset: 'focus' }),
    })
    expect(r.source).toBe('saved')
    expect(r.state.preset).toBe('maintainer')
  })

  it('config default wins over the built-in "everything"', () => {
    const r = resolveLayout({
      saved: { kind: 'empty' },
      configDefault: JSON.stringify({ ...templatedV0, preset: 'program' }),
    })
    expect(r.source).toBe('config')
    expect(r.state.preset).toBe('program')
  })

  it('falls through to default when nothing is saved and no config default', () => {
    const r = resolveLayout({ saved: { kind: 'empty' }, configDefault: null })
    expect(r.source).toBe('default')
    expect(r.state).toEqual(defaultLayout())
  })

  // A "future" read keeps what's in storage AND renders a safe layout
  // beneath it. The warning rides along so the UI can surface it.
  it('a future-version read falls through without clobbering and carries a warning', () => {
    const r = resolveLayout({
      saved: { kind: 'future', detail: 'saved layout is version 2; this build understands up to 1' },
      configDefault: null,
    })
    expect(r.source).toBe('default')
    expect(r.warning).toContain('version 2')
  })

  it('unreachable storage falls through to default AND carries a warning', () => {
    const r = resolveLayout({
      saved: { kind: 'unreachable', detail: 'storage disabled' },
      configDefault: null,
    })
    expect(r.source).toBe('default')
    expect(r.warning).toContain('storage disabled')
  })

  it('a malformed configDefault falls through silently (the settings page shows the error)', () => {
    const r = resolveLayout({ saved: { kind: 'empty' }, configDefault: '{broken' })
    expect(r.source).toBe('default')
    expect(r.warning).toBeUndefined()
  })

  // Branches 1 vs 2 of the config-default ladder, per the templated
  // code at web/index.html:5318 and peer's clarification.

  it('configDefault with a known preset name renders that preset', () => {
    const r = resolveLayout({
      saved: { kind: 'empty' },
      configDefault: JSON.stringify({ preset: 'contributor' }),
    })
    expect(r.source).toBe('config')
    expect(r.state.preset).toBe('contributor')
    // The contributor preset folds `tracked`; a smoke test that we
    // did not fall through to `everything`.
    expect(r.state.folded).toContain('tracked')
  })

  it('configDefault with explicit main/rail arrays renders those columns as "custom"', () => {
    const r = resolveLayout({
      saved: { kind: 'empty' },
      configDefault: JSON.stringify({ main: ['your-work', 'tracked'], rail: ['feed'] }),
    })
    expect(r.source).toBe('config')
    expect(r.state.preset).toBe('custom')
    expect(r.state.main[0]).toBe('your-work')
    // Normalize places any missing known panel in its default column,
    // so the sanity check is that OUR two leading entries lead and the
    // rail array starts with `feed`.
    expect(r.state.rail[0]).toBe('feed')
  })

  // Nothing saved + no config → `everything` NAMED preset, not an
  // ad-hoc show-everything. The `preset` field holds the string so
  // the dialog reads it as selected.
  it('final fallback uses the named "everything" preset, not an ad-hoc default', () => {
    const r = resolveLayout({ saved: { kind: 'empty' }, configDefault: null })
    expect(r.source).toBe('default')
    expect(r.state.preset).toBe('everything')
  })
})

describe('stored-size migration', () => {
  // Someone whose storage holds a yesterday's-default pixel value had
  // NEVER dragged that panel — the exact value is the signal. Lift it
  // to today's default so the panel renders the current preset size,
  // the way /legacy does. Mirrors web/index.html:5302.
  it('lifts a yesterday-default stored size to today\'s default', () => {
    const state: LayoutState = {
      ...PRESETS.everything,
      sizes: { ...PRESETS.everything.sizes, 'your-work': 360 },
    }
    const migrated = migrateStoredSizes(state)
    expect(migrated.sizes['your-work']).toBe(720)
  })

  // A value that is NOT a mapped-from entry is treated as a user's
  // drag and preserved exactly — that is the whole discipline of the
  // table: the exact value distinguishes a default from a preference.
  it('leaves a non-default stored size (a user drag) alone', () => {
    const state: LayoutState = {
      ...PRESETS.everything,
      sizes: { ...PRESETS.everything.sizes, 'your-work': 412 },
    }
    const migrated = migrateStoredSizes(state)
    expect(migrated.sizes['your-work']).toBe(412)
  })

  // End-to-end through readLayout: a bare templated v0 value with an
  // old default size reads as the migrated value. This is the
  // happiest-path test for the whole rule.
  it('a v0 templated value with your-work=360 reads as your-work=720', () => {
    const s = new FakeStorage()
    s.plant(STORAGE_KEYS.layout, JSON.stringify({
      preset: 'everything',
      main: ['your-work'],
      rail: ['feed'],
      hidden: [],
      folded: [],
      sizes: { 'your-work': 360 },
    }))
    const out = readLayout(s)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.value.sizes['your-work']).toBe(720)
  })
})

describe('extension popup mode', () => {
  it('isExtPopup recognises the ?ext=popup query on the search string', () => {
    expect(isExtPopup('?ext=popup')).toBe(true)
    expect(isExtPopup('?foo=1&ext=popup')).toBe(true)
    expect(isExtPopup('?ext=popupX')).toBe(false)
    expect(isExtPopup('')).toBe(false)
  })

  // The popup renders `focus`, which hides nine panels. Not a plain
  // fresh default — this is the shape the extension specifically wants.
  it('popupLayout returns the focus preset tagged "focus"', () => {
    const p = popupLayout()
    expect(p.preset).toBe('focus')
    expect(p.hidden.length).toBeGreaterThanOrEqual(9)
  })

  // The documented behaviour is "reads nothing, writes nothing". This
  // module exposes isExtPopup/popupLayout as pure data; the writes-are-
  // suppressed half is the caller's responsibility. The App-side wiring
  // slice will pin that explicitly — a vitest noting that we never
  // touched storage when ext=popup is true.
  it('popupLayout is independent of what is saved', () => {
    // Different popup calls return equivalent layouts regardless of
    // intervening storage state — the caller is expected to short-circuit
    // before ever reading storage. The pure function cannot enforce the
    // suppression; what it CAN promise is that its output is independent.
    const a = popupLayout()
    const b = popupLayout()
    expect(a).toEqual(b)
  })
})
