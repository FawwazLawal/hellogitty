import { describe, expect, it } from 'vitest'
import { humanTime } from './humanTime'

/**
 * These tests pin the format #296 restored — the one the templated
 * pages carried and the first React port lost. Each case is one line
 * from the Go `help.Ago` tests, translated to TS so the two stay in
 * step as rules evolve.
 *
 * `now` is fixed per test so a local zone doesn't drift the answers;
 * all timestamps and the reference `now` are constructed in local
 * time (via the Date(y, m, d, hh, mm) overload) so same-day /
 * yesterday compares are deterministic regardless of CI's zone.
 */

const now = new Date(2026, 9, 29, 14, 30, 0) // 2026-10-29 14:30 local

describe('humanTime', () => {
  it('empty or zero → em-dash', () => {
    // The Go function returns "—" for a zero time, which the alert
    // pages render as "— open" / "— GFI" meaning "we have no value
    // yet, not zero of them".
    expect(humanTime(undefined, now)).toBe('—')
    expect(humanTime('', now)).toBe('—')
    expect(humanTime('not-a-date', now)).toBe('—')
    expect(humanTime('1970-01-01T00:00:00Z', now)).toBe('—')
  })

  it('less than a minute → "just now"', () => {
    const t = new Date(now.getTime() - 30_000).toISOString()
    expect(humanTime(t, now)).toBe('just now')
  })

  it('a few minutes → "N min ago"', () => {
    const t = new Date(now.getTime() - 17 * 60_000).toISOString()
    expect(humanTime(t, now)).toBe('17 min ago')
  })

  it('today → "HH:MM" (no "today" word, matching the templated form)', () => {
    const t = new Date(2026, 9, 29, 9, 15).toISOString()
    expect(humanTime(t, now)).toBe('09:15')
  })

  it('yesterday → "Yesterday HH:MM"', () => {
    // The reproduction from #296's title: "Yesterday 22:27" — this is
    // the exact format the issue asks for, so this is the test it
    // lives or dies by.
    const t = new Date(2026, 9, 28, 22, 27).toISOString()
    expect(humanTime(t, now)).toBe('Yesterday 22:27')
  })

  it('within the last week → "Mon HH:MM" (short weekday)', () => {
    // Three days before now (Thu) is Mon 2026-10-26.
    const t = new Date(2026, 9, 26, 11, 2).toISOString()
    expect(humanTime(t, now)).toBe('Mon 11:02')
  })

  it('this year, more than a week → "Mon D HH:MM"', () => {
    const t = new Date(2026, 0, 14, 11, 2).toISOString()
    expect(humanTime(t, now)).toBe('Jan 14 11:02')
  })

  it('older than this year → "YYYY-MM-DD"', () => {
    const t = new Date(2024, 2, 7, 11, 2).toISOString()
    expect(humanTime(t, now)).toBe('2024-03-07')
  })

  it('late-yesterday → early-today still reads as Yesterday', () => {
    // The whole reason the Go version uses calendar-day compare
    // rather than a 24h duration: a reader looking at 06:00 should
    // see "Yesterday 23:50" rather than "6h ago" or "just now
    // yesterday".
    const t = new Date(2026, 9, 28, 23, 50).toISOString()
    const today0600 = new Date(2026, 9, 29, 6, 0)
    expect(humanTime(t, today0600)).toBe('Yesterday 23:50')
  })

  it('clock skew (future timestamp) → "just now" (matches Go fallthrough)', () => {
    // A row the server stamps a few seconds ahead of the browser's
    // clock should not render as a negative duration or an empty
    // string; the Go version falls through its switch to the first
    // branch and so does the TS version.
    const t = new Date(now.getTime() + 15_000).toISOString()
    expect(humanTime(t, now)).toBe('just now')
  })
})
