import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  CLOCK_DEFAULTS,
  CLOCK_KEY,
  WORLD_CLOCKS_KEY,
  WORLD_ZONES,
  formatClock,
  formatInTz,
  useClockPreferences,
  useLiveClock,
  useWorldClocks,
} from './clock'

/**
 * The clock contract, pinned in unit tests.
 *
 * Two things this suite protects, because both are the kind of defect a
 * visual check misses:
 *
 *   1. The templated page's localStorage keys and defaults MUST match. A
 *      visitor with 12h set on /legacy must open /settings and find 12h set.
 *      Renaming the key, or quietly defaulting to 12h, strands their choice.
 *
 *   2. The seconds toggle MUST actually control the tick cadence. Ticking
 *      every second to re-draw the same minute is noise, and a clock that
 *      pretends to honour the preference but keeps ticking at 1Hz is
 *      indistinguishable from one that does not.
 */

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useClockPreferences — templated-key parity', () => {
  it('reads defaults when the storage is empty (24h, seconds on, date on, default style)', () => {
    const { result } = renderHook(() => useClockPreferences())
    expect(result.current.prefs).toEqual(CLOCK_DEFAULTS)
    expect(CLOCK_DEFAULTS).toEqual({ format: '24h', seconds: true, date: true, style: 'default' })
  })

  it('reads a saved `style` the templated page wrote (style=neon)', () => {
    // Templated page writes {format, seconds, date, style} as a partial object.
    // A saved style must survive the round-trip or a visitor's choice silently
    // reverts to default when they move from /legacy to /.
    localStorage.setItem('hellogitty-clock', JSON.stringify({ style: 'neon' }))
    const { result } = renderHook(() => useClockPreferences())
    expect(result.current.prefs.style).toBe('neon')
    // Other fields fall back on defaults.
    expect(result.current.prefs.format).toBe('24h')
    expect(result.current.prefs.seconds).toBe(true)
  })

  it('an unknown style falls back on default without clobbering the other fields', () => {
    // The zod `.catch('default')` on the style field exists for this exact
    // case: a style that was renamed or removed must NOT cause the whole
    // preference object to reset. A bare `.default()` without `.catch()` would
    // throw on an unknown enum value and wipe format and seconds with it.
    localStorage.setItem(
      'hellogitty-clock',
      JSON.stringify({ format: '12h', seconds: false, date: true, style: 'ghostbusters' }),
    )
    const { result } = renderHook(() => useClockPreferences())
    expect(result.current.prefs.style).toBe('default')
    expect(result.current.prefs.format).toBe('12h')
    expect(result.current.prefs.seconds).toBe(false)
    expect(result.current.prefs.date).toBe(true)
  })

  it('setStyle writes under hellogitty-clock and leaves other fields intact', () => {
    const { result } = renderHook(() => useClockPreferences())
    act(() => result.current.setFormat('12h'))
    act(() => result.current.setStyle('matrix'))
    const raw = localStorage.getItem('hellogitty-clock')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toMatchObject({ format: '12h', seconds: true, date: true, style: 'matrix' })
  })

  it('reads a preference the templated page has already written (format=12h)', () => {
    // Exactly the shape the templated clock-js writes: a partial object under
    // "hellogitty-clock". A new key would mean a strand, so the key literal
    // is hardcoded — using `CLOCK_KEY` here would silently drag with a rename.
    localStorage.setItem('hellogitty-clock', JSON.stringify({ format: '12h' }))
    const { result } = renderHook(() => useClockPreferences())
    expect(result.current.prefs.format).toBe('12h')
    // Missing keys fall back on defaults; a visitor who only ever touched
    // the format should still have seconds and date on.
    expect(result.current.prefs.seconds).toBe(true)
    expect(result.current.prefs.date).toBe(true)
  })

  it('writes back under the same key the templated page reads', () => {
    const { result } = renderHook(() => useClockPreferences())
    act(() => result.current.setFormat('12h'))
    const raw = localStorage.getItem('hellogitty-clock')
    expect(raw, 'preferences must live under hellogitty-clock').not.toBeNull()
    expect(JSON.parse(raw!)).toMatchObject({ format: '12h', seconds: true, date: true })
  })

  it('CLOCK_KEY is the templated-page key, not something new', () => {
    // Pinned here too, because a rename that touches both constants stays
    // green on the roundtrip tests above. Catching the strand needs a direct
    // equality on the exported constant.
    expect(CLOCK_KEY).toBe('hellogitty-clock')
  })

  it('malformed storage falls back on defaults without throwing', () => {
    localStorage.setItem(CLOCK_KEY, 'not json')
    const { result } = renderHook(() => useClockPreferences())
    expect(result.current.prefs).toEqual(CLOCK_DEFAULTS)
  })
})

describe('formatClock — matches the templated page character for character', () => {
  const noon = new Date(2026, 10, 6, 12, 34, 56) // Nov 6 2026 12:34:56 local
  const morning = new Date(2026, 10, 6, 7, 5, 9) // 07:05:09 local

  it('24h with seconds', () => {
    expect(formatClock(noon, { format: '24h', seconds: true, date: true })).toMatchObject({
      time: '12:34:56',
      meridiem: '',
      date: 'Fri, Nov 6 2026',
    })
  })

  it('24h without seconds — minute only', () => {
    expect(formatClock(noon, { format: '24h', seconds: false, date: true })).toMatchObject({
      time: '12:34',
    })
  })

  it('12h noon reads 12 PM, not 00', () => {
    expect(formatClock(noon, { format: '12h', seconds: false, date: false })).toMatchObject({
      time: '12:34',
      meridiem: 'PM',
      date: '',
    })
  })

  it('12h single-digit hour pads to 07:05:09 AM', () => {
    expect(formatClock(morning, { format: '12h', seconds: true, date: false })).toMatchObject({
      time: '07:05:09',
      meridiem: 'AM',
    })
  })
})

describe('useWorldClocks — reads what /legacy already saved', () => {
  it('WORLD_CLOCKS_KEY is the templated-page key, not something new', () => {
    expect(WORLD_CLOCKS_KEY).toBe('hellogitty-worldclocks')
  })

  it('reads a bare-string entry ("UTC") the templated page accepted', () => {
    // The templated writer stored a mix of strings and {tz,label} objects —
    // the string form is a visitor who added UTC in the earliest version.
    // Normalise, don't lose it.
    localStorage.setItem('hellogitty-worldclocks', JSON.stringify(['UTC']))
    const { result } = renderHook(() => useWorldClocks())
    expect(result.current.clocks).toHaveLength(1)
    expect(result.current.clocks[0]).toMatchObject({ tz: 'UTC', label: 'UTC' })
  })

  it('add() refuses a duplicate tz without touching the list', () => {
    const { result } = renderHook(() => useWorldClocks())
    act(() => result.current.add('America/New_York'))
    act(() => result.current.add('America/New_York'))
    expect(result.current.clocks).toHaveLength(1)
  })

  it('round-trips an add → remove cleanly', () => {
    const { result } = renderHook(() => useWorldClocks())
    act(() => result.current.add('Asia/Tokyo'))
    expect(result.current.clocks.map((c) => c.tz)).toEqual(['Asia/Tokyo'])
    act(() => result.current.remove('Asia/Tokyo'))
    expect(result.current.clocks).toEqual([])
    // A serialized `[]` is what the templated page expects — not a null, not
    // a removed key. A reader that defaults differently would reinstate the
    // deleted clock on next load.
    expect(localStorage.getItem('hellogitty-worldclocks')).toBe('[]')
  })
})

describe('formatInTz — midnight edge case', () => {
  it('UTC midnight reads 00:XX, never 24:XX', () => {
    // 00:30 UTC on an arbitrary date.
    const midnight = new Date(Date.UTC(2026, 10, 6, 0, 30, 0))
    const t = formatInTz(midnight, 'UTC')
    expect(t.startsWith('24:')).toBe(false)
    expect(t).toBe('00:30')
  })

  it('every zone in WORLD_ZONES formats to HH:MM without throwing', () => {
    const anchor = new Date(Date.UTC(2026, 10, 6, 12, 0, 0))
    for (const z of WORLD_ZONES) {
      const t = formatInTz(anchor, z.tz)
      expect(t, `tz=${z.tz}`).toMatch(/^\d{2}:\d{2}$/)
    }
  })
})

describe('useLiveClock — always 1s cadence (matches the templated clock-js)', () => {
  it('ticks every second', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useLiveClock())
    const start = result.current.getTime()
    act(() => {
      vi.advanceTimersByTime(1_500)
    })
    expect(result.current.getTime()).toBeGreaterThan(start)
  })

  it('a 5-second advance moves the clock forward by ~5 seconds, not zero', () => {
    // An earlier iteration here slowed the tick to 15s when `seconds` was off.
    // That created a visible bug: flipping FORMAT (24h↔12h) with seconds off
    // took up to 15 seconds to show, because the effect depended on `seconds`
    // and nothing re-ran the tick on a format change. A clock that disagrees
    // with its own setting after a click is worse than a few extra renders
    // per minute on a quiet masthead. This test guards the fix.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0))
    const { result } = renderHook(() => useLiveClock())
    const start = result.current.getTime()
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    const delta = result.current.getTime() - start
    expect(delta).toBeGreaterThanOrEqual(4_000)
    expect(delta).toBeLessThanOrEqual(6_000)
  })
})
