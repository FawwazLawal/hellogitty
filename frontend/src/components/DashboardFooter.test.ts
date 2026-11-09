import { describe, it, expect } from 'vitest'
import { relativeAgo } from './DashboardFooter'

/**
 * Only the pure formatter goes here — the component itself is a Playwright
 * concern (it reads live settings and ticks from `useLiveClock`, which only
 * means anything in a browser).
 *
 * The ladder matches the templated page's own wording: "just now", then
 * minutes, then hours, then days. A rephrasing of any band changes a
 * literal comparison here, which is the whole point — if the owner retunes
 * the words, the one place to change them is this file plus the ladder in
 * DashboardFooter.ts, and every row in the dashboard moves together.
 */

function at(seconds: number): Date {
  return new Date(Date.UTC(2026, 10, 8, 12, 0, 0) + seconds * 1000)
}

const NOW = at(0)

describe('relativeAgo', () => {
  it('reads "just now" for anything under 45 seconds', () => {
    expect(relativeAgo(NOW, at(-5))).toBe('just now')
    expect(relativeAgo(NOW, at(-44))).toBe('just now')
  })

  it('reads "a minute ago" between 45 and 89 seconds', () => {
    expect(relativeAgo(NOW, at(-45))).toBe('a minute ago')
    expect(relativeAgo(NOW, at(-89))).toBe('a minute ago')
  })

  it('counts minutes between 90s and 44 minutes', () => {
    expect(relativeAgo(NOW, at(-2 * 60))).toBe('2 minutes ago')
    expect(relativeAgo(NOW, at(-44 * 60))).toBe('44 minutes ago')
  })

  it('rounds into hours and days', () => {
    expect(relativeAgo(NOW, at(-60 * 60))).toBe('an hour ago')
    expect(relativeAgo(NOW, at(-3 * 60 * 60))).toBe('3 hours ago')
    expect(relativeAgo(NOW, at(-25 * 60 * 60))).toBe('a day ago')
    expect(relativeAgo(NOW, at(-3 * 24 * 60 * 60))).toBe('3 days ago')
  })

  it('returns null when `then` is null', () => {
    expect(relativeAgo(NOW, null)).toBe(null)
  })

  it('clamps future timestamps to "just now" rather than reading negative', () => {
    // A clock-skew between the browser's `Date.now` and the server's
    // `lastPollUtc` can land the two sides a few seconds apart in either
    // direction. "2 seconds in the future" shouldn't print "-1 minutes ago".
    expect(relativeAgo(NOW, at(5))).toBe('just now')
  })
})
