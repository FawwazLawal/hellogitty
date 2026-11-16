/**
 * Human-readable timestamps for /feed and the watched-* alert pages
 * (issue #296).
 *
 * Ports `internal/help.Ago` (Go). The Go version was the templated
 * pages' timestamp — "Yesterday 22:27", "Thu 09:14", "Jan 14 11:02"
 * — and the templated pages made the reader confident in *when* an
 * event happened. The React port rounded to elapsed time ("5h ago")
 * and quietly took that away.
 *
 * ONE DELIBERATE DIVERGENCE. The "never happened" sentinel branch
 * accepts both Go's `t.IsZero()` (Year 1 Jan 1 UTC) AND JS's 1970
 * epoch, because callers from either side may send either form. Every
 * other rule is one-for-one with the Go function — see the match
 * table below.
 *
 * Rules, verbatim from the Go function so the two agree character
 * for character on the same input:
 *
 *   zero         → "—"            // never happened
 *   < 1 min      → "just now"
 *   < 1 hour     → "N min ago"    // "1 min ago", "17 min ago"
 *   today        → "HH:MM"
 *   yesterday    → "Yesterday HH:MM"
 *   within 7 days → "Mon HH:MM"   // short weekday
 *   this year    → "Jan 2 HH:MM"
 *   older        → "YYYY-MM-DD"
 *
 * The "yesterday" check uses a calendar-day subtraction, not a
 * 24-hour subtraction — the Go side does the same, and this is what
 * keeps "Yesterday 23:50 → today 00:10" reading as "Yesterday
 * 23:50" rather than "6h ago".
 *
 * TIME ZONE. The Go function uses `now.Date()` and `t.Date()` on
 * whatever location `now` is in, so the user's local day boundary
 * governs "today" and "yesterday". The TS port uses `new Date()`
 * methods that read the browser's local zone — same semantics, same
 * user-visible result.
 *
 * NAMING. `humanTime`, not `ago` or `formatTime`: `ago` was already
 * taken by the misleading "5h ago" helper, and `formatTime` is too
 * generic. The new name states the contract — these strings are for
 * human readers.
 */

/** Format an ISO 8601 timestamp against `now`. Pass `now` for tests. */
export function humanTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const t = new Date(iso)
  const ts = t.getTime()
  if (Number.isNaN(ts)) return '—'
  // Go's `t.IsZero()` is the Year 1 Jan 1 UTC sentinel (`time.Time{}`),
  // not the 1970 epoch. The alert pages send the Go zero through as
  // "0001-01-01T00:00:00Z" when upstream forgets a nil guard
  // (alerts_api.go:377 has no guard today). Checking UTC year <= 1
  // catches Go's actual sentinel; the epoch (ts === 0) stays caught
  // too, as a second genuine "never" signal, so the two systems'
  // null representations both resolve to "—". Confirmed by peer on
  // #327 as the condition #292 will want when humanTime is pointed
  // at surfaces beyond /feed.
  if (t.getUTCFullYear() <= 1 || ts === 0) return '—'

  const diffMs = now.getTime() - ts

  // Future timestamps (clock skew, a row with a server-set at > local
  // now) render as "just now" rather than a confusing "0 min ago" or
  // a negative number. The Go side falls through its `switch` to the
  // same branch because `d < time.Minute` catches a negative duration.
  if (diffMs < 60_000) return 'just now'

  const minute = 60_000
  const hour = 60 * minute
  if (diffMs < hour) {
    const n = Math.floor(diffMs / minute)
    return `${n} min ago`
  }

  const hm = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`

  // Calendar-day compare, not duration compare — "today" is the
  // reader's local day, same as the Go version.
  if (sameDay(now, t)) return hm

  const yesterday = new Date(now.getTime())
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(yesterday, t)) return `Yesterday ${hm}`

  const sevenDays = 7 * 24 * hour
  if (diffMs < sevenDays) {
    return `${WEEKDAY[t.getDay()]} ${hm}`
  }

  if (now.getFullYear() === t.getFullYear()) {
    return `${MONTH[t.getMonth()]} ${t.getDate()} ${hm}`
  }

  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
