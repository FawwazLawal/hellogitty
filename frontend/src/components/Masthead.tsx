import { CircleHelp, Settings } from 'lucide-react'
import { ClockOrnament, OniMark } from './chrome/Ornament'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { useTheme } from '../theme/ThemeProvider'
import type { Appearance } from '../theme/ThemeProvider'
import type { DashboardData } from '../fixtures/dashboard'
import { useArt } from '../art'
import { formatClock, formatInTz, useClockPreferences, useLiveClock, useWorldClocks } from '../data/clock'

/**
 * The application masthead: brand, scenic band, clock, controls.
 *
 * ADR-UI-002 §6 lists the masthead and clock/branding among the signature
 * components requiring art direction, and §5 says the scene is "genuinely
 * illustrated, optimized header and background assets in appropriate safe
 * zones" with decorative images `aria-hidden` and never carrying real UI text.
 *
 * THE SAFE ZONE IS THE WHOLE POINT, and it is where the CSS-pack version of
 * this went wrong. There, the art was dropped into a 66px band with
 * `background-size: cover`, which cropped sixty per cent of its height from the
 * centre — the composed horizon fell outside the visible slice and no scenery
 * ever rendered. The band here is a declared height with the art anchored to
 * its bottom edge at a width-pinned scale, so the horizon stays put as the
 * window widens, and a scrim holds the upper region where the text sits.
 *
 * The scrim is not decoration. Measured on the running page, header controls
 * over this art fell to 1.91:1 without it.
 */

/*
 * The Masthead's "Collapse all" and "Layout" buttons from earlier passes
 * are gone, not disabled. They had no handlers and would have needed state
 * the React shell does not own yet — the collapse feature the templated
 * page offers reads and writes panel-layout keys this app's dashboard does
 * not consult. A focusable button that does nothing is the same lie this
 * audit exists to catch, so the fix is not to style it as disabled but to
 * not render it until the feature it represents exists. Re-add here when
 * the collapse and layout machinery lands.
 *
 * `Help` and `Settings` remain. Both now navigate to the real documents.
 */

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function Masthead({ data }: { data: DashboardData }) {
  const { identity, identities, order, setIdentity, appearance, setAppearance } = useTheme()
  const headerArt = useArt('header')

  return (
    /*
     * `height` only above the narrow breakpoint. At 390px the brand, clock and
     * eleven controls cannot share one row: pinning the height made them
     * overlap rather than wrap, and the first mobile capture had the wordmark
     * sitting on top of the clock with 432px of horizontal overflow behind it.
     * Below `md` the band grows to fit its content instead.
     */
    <header
      className="relative isolate overflow-hidden md:h-[var(--spacing-masthead)]"
    >
      {/* Scene. Anchored to the bottom so the horizon holds as the window widens. */}
      <div
        aria-hidden="true"
        className="hg-decor absolute inset-0 -z-20 bg-bottom bg-no-repeat"
        style={{
          // Registry-resolved. The identity-interpolated URL this replaces
          // could name a file that does not exist, which 404s and paints
          // nothing — indistinguishable from a pack with no art.
          backgroundImage: headerArt.kind === 'present' ? `url(${headerArt.url})` : undefined,
          backgroundSize: '100% auto',
        }}
      />
      {/* Scrim: full strength across the top 38%, gone by 78%. Measured, not guessed. */}
      <div
        aria-hidden="true"
        className="hg-decor absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, var(--hg-canvas) 0%, var(--hg-canvas) 38%, transparent 78%)',
        }}
      />

      <div className="flex h-full flex-wrap items-start gap-x-6 gap-y-3 px-5 py-3 md:flex-nowrap md:py-0 md:pt-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <OniMark size={34} />
          <div className="min-w-0">
          <h1 className="text-[19px] font-bold leading-tight" style={{ color: 'var(--hg-text)' }}>
            HelloGitty
          </h1>
          <p className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
            {data.version} · {data.codename} <em>(baby)</em>
          </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 pt-1 md:mx-auto">
          <div className="flex items-center gap-1">
            <ClockOrnament side="left" />
            <LiveClock />
            <ClockOrnament side="right" />
          </div>
          <WorldClocks />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/*
            Help and Settings are anchors, not buttons, because each is a
            navigation to a document the server renders. A click handler on a
            button here would reinvent what an <a> already gives for free —
            including middle-click, open-in-new-tab, and the back button — and
            that was the exact failure the nav tabs shipped with before #244.
          */}
          <a
            href="/help"
            className="flex items-center gap-1.5 border px-2.5 py-1.5 text-[12px] no-underline transition-colors"
            style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text)', background: 'var(--hg-surface)' }}
          >
            <CircleHelp size={14} aria-hidden="true" />
            Help
          </a>
          <a
            href="/settings"
            aria-label="Settings"
            className="border p-1.5 no-underline transition-colors"
            style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text)', background: 'var(--hg-surface)' }}
          >
            <Settings size={14} aria-hidden="true" />
          </a>

          {/* Appearance: auto / light / dark. Independent of identity. */}
          <ToggleGroup
            aria-label="Appearance"
            value={appearance}
            onValueChange={(v) => v && setAppearance(v as Appearance)}
          >
            {APPEARANCES.map(({ value, label }) => (
              <ToggleGroupItem key={value} value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {/* Identity. A separate control, by §5. */}
          <ToggleGroup
            aria-label="Visual identity"
            value={identity}
            onValueChange={(v) => v && setIdentity(v as typeof identity)}
          >
            {order.map((id) => (
              <ToggleGroupItem key={id} value={id} title={identities[id].description}>
                {identities[id].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
    </header>
  )
}

/**
 * The live clock, isolated from the Masthead so each tick re-renders only
 * its own subtree instead of the whole band.
 *
 * It owns the preferences (format, seconds, date) and ticks at the rate the
 * seconds preference asks for — a visitor who turned seconds off doesn't want
 * React to pass through reconciliation once per second to draw the same
 * minute digit.
 *
 * The <time> dateTime attribute is the full ISO instant; what's rendered is
 * what the viewer asked for. That split keeps the machine-readable value
 * honest regardless of the display format.
 */
function LiveClock() {
  const { prefs } = useClockPreferences()
  const now = useLiveClock()
  const { time, meridiem, date, iso } = formatClock(now, prefs)
  /*
   * `data-clock-style` drives the per-style CSS overrides in index.css, whose
   * selectors target `.hg-clock-time` / `.hg-clock-date` inside the subtree.
   * `default` is the absence of an override, so the attribute is omitted in
   * that case; any other selector matches and takes over colour / weight /
   * text-shadow.
   */
  const styleAttr = prefs.style === 'default' ? undefined : prefs.style
  return (
    <div
      className="flex flex-col items-center gap-0.5 select-none"
      data-clock-style={styleAttr}
    >
      <time
        className="hg-clock-time block font-mono text-[28px] font-bold leading-none tabular-nums"
        dateTime={iso}
      >
        {/*
          Templated clock-js at index.html:4596 appends the meridiem into the
          same string at the same font size (`t += suffix`), and the owner
          reviewed the page against that. A smaller inline span reads as a
          different design, which is what "the clock is off" picked up on.
        */}
        {time}{meridiem && ` ${meridiem}`}
      </time>
      {date && (
        <span className="hg-clock-date block font-sans text-[12px] font-medium leading-none uppercase">
          {date}
        </span>
      )}
    </div>
  )
}

/**
 * The world-clocks chip row.
 *
 * Renders nothing when the viewer has none configured — the templated page
 * does the same, and an empty row would push the main clock up for no reason.
 * The chips update at the same 15-second cadence as a quiet main clock, which
 * is more than enough for timezone-offset precision (every chip's minute is
 * already an offset-away from local minutes; sub-minute updates have no
 * meaning).
 */
function WorldClocks() {
  const { clocks } = useWorldClocks()
  const now = useLiveClock()
  if (clocks.length === 0) return null
  return (
    <ul
      aria-label="World clocks"
      className="flex max-w-[640px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2"
    >
      {clocks.map((c) => (
        <li
          key={c.tz}
          className="flex items-baseline gap-1 text-[10px]"
          style={{ color: 'var(--hg-text-muted)' }}
        >
          <span className="font-mono tabular-nums" style={{ color: 'var(--hg-text)' }}>
            {formatInTz(now, c.tz)}
          </span>
          <span className="tracking-widest">{c.label}</span>
        </li>
      ))}
    </ul>
  )
}
