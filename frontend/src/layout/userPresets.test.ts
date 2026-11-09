import { describe, expect, it } from 'vitest'
import { readUserPresets, writeUserPresets } from './userPresets'
import { defaultLayout, STORAGE_KEYS } from './schema'

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

describe('readUserPresets', () => {
  it('empty storage reads as empty map', () => {
    const s = new FakeStorage()
    const r = readUserPresets(s)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.value).toEqual({})
  })

  // The user may have named presets on /legacy before React landed —
  // bare JSON, no version envelope. Must round-trip without loss.
  it('reads the templated bare-JSON shape and keeps names', () => {
    const s = new FakeStorage()
    s.plant(
      STORAGE_KEYS.presets,
      JSON.stringify({
        'my-triage': defaultLayout(),
        'reading-mode': { ...defaultLayout(), hidden: ['feed', 'watched'] },
      }),
    )
    const r = readUserPresets(s)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(Object.keys(r.value).sort()).toEqual(['my-triage', 'reading-mode'])
    expect(r.value['reading-mode'].hidden).toContain('feed')
  })

  // Same "unreachable vs empty" invariant as readLayout: storage
  // disabled must not read as "no presets yet".
  it('a getItem throw reads as kind=unreachable, not empty', () => {
    const s = new FakeStorage()
    s.throwOnGet = new Error('SecurityError: storage disabled')
    const r = readUserPresets(s)
    expect(r.kind).toBe('unreachable')
    if (r.kind === 'unreachable') expect(r.detail).toContain('storage disabled')
  })

  it('a malformed JSON reads as empty, not as error', () => {
    const s = new FakeStorage()
    s.plant(STORAGE_KEYS.presets, '{broken')
    const r = readUserPresets(s)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.value).toEqual({})
  })

  // A preset carrying a panel id that no longer exists must drop
  // THAT id, not the whole preset.
  it('normalizes each entry, keeping presets even when one panel id went away', () => {
    const s = new FakeStorage()
    s.plant(
      STORAGE_KEYS.presets,
      JSON.stringify({
        'half-there': {
          ...defaultLayout(),
          main: ['your-work', 'nonexistent-panel'],
        },
      }),
    )
    const r = readUserPresets(s)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.value['half-there'].main).toContain('your-work')
    expect(r.value['half-there'].main).not.toContain('nonexistent-panel' as never)
  })
})

describe('writeUserPresets', () => {
  it('writes the map as JSON and reads back identically', () => {
    const s = new FakeStorage()
    const presets = { foo: defaultLayout() }
    const out = writeUserPresets(presets, s)
    expect(out.ok).toBe(true)
    const stored = JSON.parse(s.getItem(STORAGE_KEYS.presets)!)
    expect(stored.foo.preset).toBe('everything')
  })

  // Same visible-write-failure rule as writeLayout: a failed save
  // must surface, not go silent.
  it('a setItem throw returns {ok:false, detail}, not {ok:true}', () => {
    const s = new FakeStorage()
    s.throwOnSet = new Error('QuotaExceededError')
    const out = writeUserPresets({ foo: defaultLayout() }, s)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.detail).toContain('Quota')
  })
})
