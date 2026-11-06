import { LayoutGrid, CircleHelp, Settings, Rows3 } from 'lucide-react'
import { ClockBracket } from './chrome/Chrome'
import { useTheme } from '../theme/ThemeProvider'
import type { Appearance } from '../theme/ThemeProvider'
import type { DashboardData } from '../fixtures/dashboard'

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

const CONTROLS = [
  { id: 'collapse', label: 'Collapse all', Icon: Rows3 },
  { id: 'layout', label: 'Layout', Icon: LayoutGrid },
  { id: 'help', label: 'Help', Icon: CircleHelp },
] as const

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function Masthead({ data }: { data: DashboardData }) {
  const { identity, identities, order, setIdentity, appearance, setAppearance } = useTheme()
  const art = identities[identity].id

  const time = new Date(data.generatedAt)
  const hh = String(time.getUTCHours() % 12 || 12).padStart(2, '0')
  const mm = String(time.getUTCMinutes()).padStart(2, '0')
  const ss = String(time.getUTCSeconds()).padStart(2, '0')
  const meridiem = time.getUTCHours() >= 12 ? 'PM' : 'AM'
  const datestamp = time
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase()

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
        style={{ backgroundImage: `url(/art/header-${art}.webp)`, backgroundSize: '100% auto' }}
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
        <div className="min-w-0">
          <h1 className="text-[19px] font-bold leading-tight" style={{ color: 'var(--hg-text)' }}>
            HelloGitty
          </h1>
          <p className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
            {data.version} · {data.codename} <em>(baby)</em>
          </p>
        </div>

        <div className="flex items-center gap-1 pt-1 md:mx-auto">
          <ClockBracket side="left" />
          <div className="text-center">
            <time
              className="block font-mono text-[27px] font-bold leading-none tabular-nums tracking-tight"
              style={{ color: 'var(--hg-accent)' }}
              dateTime={data.generatedAt}
            >
              {hh}:{mm}:{ss}{' '}
              <span className="text-[16px]">{meridiem}</span>
            </time>
            <span className="mt-1 block text-[10px] tracking-widest" style={{ color: 'var(--hg-text-muted)' }}>
              {datestamp}
            </span>
          </div>
          <ClockBracket side="right" />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {CONTROLS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className="flex items-center gap-1.5 border px-2.5 py-1.5 text-[12px] transition-colors"
              style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text)', background: 'var(--hg-surface)' }}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Settings"
            className="border p-1.5 transition-colors"
            style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text)', background: 'var(--hg-surface)' }}
          >
            <Settings size={14} aria-hidden="true" />
          </button>

          {/* Appearance: auto / light / dark. Independent of identity. */}
          <div
            role="group"
            aria-label="Appearance"
            className="flex border"
            style={{ borderColor: 'var(--hg-line-strong)' }}
          >
            {APPEARANCES.map(({ value, label }) => {
              const active = appearance === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAppearance(value)}
                  className="px-2.5 py-1.5 text-[12px] transition-colors"
                  style={{
                    background: active ? 'var(--hg-accent-fill)' : 'var(--hg-surface)',
                    color: active ? 'var(--hg-accent-ink)' : 'var(--hg-text-muted)',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/* Identity. A separate control, by §5. */}
          <div
            role="group"
            aria-label="Visual identity"
            className="flex border"
            style={{ borderColor: 'var(--hg-line-strong)' }}
          >
            {order.map((id) => {
              const active = identity === id
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setIdentity(id)}
                  title={identities[id].description}
                  className="px-2.5 py-1.5 text-[12px] transition-colors"
                  style={{
                    background: active ? 'var(--hg-accent-fill)' : 'var(--hg-surface)',
                    color: active ? 'var(--hg-accent-ink)' : 'var(--hg-text-muted)',
                  }}
                >
                  {identities[id].label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </header>
  )
}
