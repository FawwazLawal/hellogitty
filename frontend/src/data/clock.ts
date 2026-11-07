import { useEffect, useState } from 'react'
import { z } from 'zod'

/**
 * The clock preferences and a live-ticking clock.
 *
 * PRESERVE THE TEMPLATED SEMANTICS. The Go template keeps the three preferences
 * under `hellogitty-clock`, defaulting to 24-hour, seconds-on, date-on. A
 * visitor who already set 12-hour on `/legacy/settings` must find it set here
 * too — the migration is of the interface, not the preference store, so the
 * key, the shape and every default match. Changing any of them silently
 * strands a saved choice.
 *
 * NOT A SNAPSHOT. The old React Masthead rendered `data.generatedAt` as the
 * clock, which froze the time at the server's last poll — clock-shaped,
 * clock-looking, and quietly wrong by whatever the poll interval is. A clock
 * is a live measurement. `useLiveClock` returns the current moment and ticks.
 */

export const ClockFormat = z.enum(['24h', '12h'])
export type ClockFormat = z.infer<typeof ClockFormat>

export const ClockPreferences = z.object({
  format: ClockFormat.default('24h'),
  seconds: z.boolean().default(true),
  date: z.boolean().default(true),
})
export type ClockPreferences = z.infer<typeof ClockPreferences>

export const CLOCK_KEY = 'hellogitty-clock'
export const WORLD_CLOCKS_KEY = 'hellogitty-worldclocks'

/**
 * The timezone catalogue the templated settings page offered. Kept identical
 * so a `hellogitty-worldclocks` entry saved on /legacy resolves to the same
 * row here.
 *
 * The label is intentionally short — this lands in a chip beside the main
 * clock, not in a settings dropdown. The settings dropdown gets the long
 * form constructed from this list.
 */
export const WORLD_ZONES: { tz: string; label: string; long: string }[] = [
  { tz: 'UTC', label: 'UTC', long: 'UTC' },
  { tz: 'America/New_York', label: 'EST', long: 'EST — America/New York' },
  { tz: 'America/Chicago', label: 'CST', long: 'CST — America/Chicago' },
  { tz: 'America/Denver', label: 'MST', long: 'MST — America/Denver' },
  { tz: 'America/Los_Angeles', label: 'PST', long: 'PST — America/Los Angeles' },
  { tz: 'Europe/London', label: 'GMT', long: 'GMT — Europe/London' },
  { tz: 'Europe/Paris', label: 'CET', long: 'CET — Europe/Paris' },
  { tz: 'Europe/Berlin', label: 'CET', long: 'CET — Europe/Berlin' },
  { tz: 'Asia/Tokyo', label: 'JST', long: 'JST — Asia/Tokyo' },
  { tz: 'Asia/Shanghai', label: 'CST (CN)', long: 'CST — Asia/Shanghai' },
  { tz: 'Asia/Kolkata', label: 'IST', long: 'IST — Asia/Kolkata' },
  { tz: 'Australia/Sydney', label: 'AEST', long: 'AEST — Australia/Sydney' },
  { tz: 'Pacific/Auckland', label: 'NZST', long: 'NZST — Pacific/Auckland' },
  { tz: 'America/Sao_Paulo', label: 'BRT', long: 'BRT — America/Sao Paulo' },
]

/** Templated defaults — never diverge from these without accepting that a saved
 * preference will quietly flip when a visitor crosses from /legacy. */
export const CLOCK_DEFAULTS: ClockPreferences = {
  format: '24h',
  seconds: true,
  date: true,
}

function read(): ClockPreferences {
  try {
    const raw = localStorage.getItem(CLOCK_KEY)
    if (!raw) return CLOCK_DEFAULTS
    // The templated writer stores a partial object (only the keys ever
    // touched), so the parse tolerates missing fields by filling defaults.
    // zod's `.default()` covers that; anything else keeps the defaults.
    const parsed = ClockPreferences.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : CLOCK_DEFAULTS
  } catch {
    return CLOCK_DEFAULTS
  }
}

function write(next: ClockPreferences) {
  try {
    localStorage.setItem(CLOCK_KEY, JSON.stringify(next))
  } catch {
    // Private mode, blocked site data, over-quota. A preference that doesn't
    // persist still works for this session, which is strictly better than
    // throwing from an effect and taking the page down.
  }
}

/**
 * The event name is the same one the templated page listens on, so a tab
 * crossing from /legacy to / picks up the saved preference without a reload.
 * Firing it ourselves keeps every instance of this hook in a single tab in
 * sync too — a change in /settings reflects in the Masthead immediately.
 */
const CHANGE_EVENT = 'hellogitty:clock'

export function useClockPreferences() {
  const [prefs, setPrefs] = useState<ClockPreferences>(() => read())

  useEffect(() => {
    const onChange = () => setPrefs(read())
    // `storage` fires in OTHER tabs when localStorage changes here — so a
    // visitor with /settings open in one tab and the dashboard in another
    // sees the Masthead flip when they toggle.
    window.addEventListener('storage', onChange)
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener(CHANGE_EVENT, onChange)
    }
  }, [])

  const update = (patch: Partial<ClockPreferences>) => {
    const next: ClockPreferences = { ...prefs, ...patch }
    write(next)
    setPrefs(next)
    try {
      window.dispatchEvent(new Event(CHANGE_EVENT))
    } catch {
      /* no CustomEvent in jsdom-less contexts */
    }
  }

  return {
    prefs,
    setFormat: (format: ClockFormat) => update({ format }),
    setSeconds: (seconds: boolean) => update({ seconds }),
    setDate: (date: boolean) => update({ date }),
  }
}

/**
 * The live clock.
 *
 * Ticks every second when `seconds` is true, every fifteen seconds otherwise.
 * The slower interval exists because re-rendering twice a minute to flip the
 * same minute digit is noise — React does no visible work, but every tick
 * crosses a VDOM pass and schedules a reconciliation we don't need.
 *
 * `now` is a `Date`, not a formatted string, because the Masthead decides how
 * it wants to display it (and the tests want to assert on parts of it
 * without re-implementing the formatting).
 */
export function useLiveClock({ seconds }: { seconds: boolean }): Date {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const periodMs = seconds ? 1000 : 15_000
    const id = window.setInterval(() => setNow(new Date()), periodMs)
    // One tick straight away so a prefs change takes effect without waiting
    // for the next interval. Without this, flipping seconds-on would show a
    // stale minute until the next second boundary — small but visible.
    setNow(new Date())
    return () => window.clearInterval(id)
  }, [seconds])

  return now
}

/** The templated page's day and month short names, kept so the React date
 * stamp matches character-for-character. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/* ─────────────────────────── World clocks ────────────────────────────── */

export interface WorldClock {
  tz: string
  /** The short label the templated page stores; UI uses this as the chip caption. */
  label: string
}

const WorldClockSchema = z.object({
  tz: z.string(),
  label: z.string(),
})

/**
 * The templated page accepts either a bare string ("UTC") or an object; this
 * normalises to the object form so the Masthead and settings UI deal with
 * exactly one shape, without rewriting what /legacy has saved.
 */
function normaliseWorldClocks(raw: unknown): WorldClock[] {
  if (!Array.isArray(raw)) return []
  const out: WorldClock[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const zone = WORLD_ZONES.find((z) => z.tz === item)
      out.push({ tz: item, label: zone?.label ?? item })
    } else {
      const parsed = WorldClockSchema.safeParse(item)
      if (parsed.success) out.push(parsed.data)
    }
  }
  return out
}

function readWorldClocks(): WorldClock[] {
  try {
    const raw = localStorage.getItem(WORLD_CLOCKS_KEY)
    if (!raw) return []
    return normaliseWorldClocks(JSON.parse(raw))
  } catch {
    return []
  }
}

function writeWorldClocks(next: WorldClock[]) {
  try {
    localStorage.setItem(WORLD_CLOCKS_KEY, JSON.stringify(next))
  } catch {
    /* ignore — same-session reads still work */
  }
}

const WC_CHANGE_EVENT = 'hellogitty:worldclocks'

export function useWorldClocks() {
  const [clocks, setClocks] = useState<WorldClock[]>(() => readWorldClocks())

  useEffect(() => {
    const onChange = () => setClocks(readWorldClocks())
    window.addEventListener('storage', onChange)
    window.addEventListener(WC_CHANGE_EVENT, onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener(WC_CHANGE_EVENT, onChange)
    }
  }, [])

  const commit = (next: WorldClock[]) => {
    writeWorldClocks(next)
    setClocks(next)
    try {
      window.dispatchEvent(new Event(WC_CHANGE_EVENT))
    } catch {
      /* no CustomEvent in jsdom-less environments */
    }
  }

  return {
    clocks,
    add: (tz: string) => {
      if (!tz) return
      if (clocks.some((c) => c.tz === tz)) return
      const zone = WORLD_ZONES.find((z) => z.tz === tz)
      commit([...clocks, { tz, label: zone?.label ?? tz }])
    },
    remove: (tz: string) => commit(clocks.filter((c) => c.tz !== tz)),
  }
}

/**
 * Format `now` in `tz` as HH:MM (24h). The templated page prints world-clock
 * times as 24h regardless of the main clock's format, which is a reasonable
 * choice — a wall of 12h chips with meridiems next to each other is harder to
 * scan than a block of 24h numbers.
 */
export function formatInTz(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    let h = ''
    let m = ''
    for (const p of parts) {
      if (p.type === 'hour') h = p.value
      if (p.type === 'minute') m = p.value
    }
    // Intl may emit "24" for midnight in hour12=false depending on locale/engine;
    // normalise to "00" so a chip never shows "24:03".
    if (h === '24') h = '00'
    return `${h}:${m}`
  } catch {
    return '—'
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export interface FormattedClock {
  /** The HH:MM or HH:MM:SS string, without the meridiem. */
  time: string
  /** "AM" / "PM" in 12-hour mode, empty in 24-hour mode. */
  meridiem: string
  /** The date stamp, e.g. "Wed, Nov 6 2026". Empty when the date is hidden. */
  date: string
  /** An ISO-ish datetime string for the <time> element's dateTime attr. */
  iso: string
}

/**
 * Format `now` for display per the templated page's exact rules:
 *  - 24h or 12h with optional meridiem
 *  - optional seconds
 *  - optional date stamp
 *
 * Kept pure so the Masthead and tests can share one definition. The templated
 * page uses the browser's local time, so this does too.
 */
export function formatClock(now: Date, prefs: ClockPreferences): FormattedClock {
  const hours = now.getHours()
  const minutes = now.getMinutes()
  const secs = now.getSeconds()

  let displayHours = hours
  let meridiem = ''
  if (prefs.format === '12h') {
    meridiem = hours >= 12 ? 'PM' : 'AM'
    displayHours = hours % 12 || 12
  }

  let time = `${pad(displayHours)}:${pad(minutes)}`
  if (prefs.seconds) time += `:${pad(secs)}`

  const date = prefs.date
    ? `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()} ${now.getFullYear()}`
    : ''

  // `toISOString` is UTC, which is the right choice for a machine-readable
  // attribute: it reads unambiguously regardless of the viewer's tz.
  const iso = now.toISOString()
  return { time, meridiem, date, iso }
}
