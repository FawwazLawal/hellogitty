import { useState, type ReactNode } from 'react'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import { usePageTitle } from '../hooks/usePageTitle'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { useTheme } from '../theme/ThemeProvider'
import type { Appearance, Pack, PackInfo } from '../theme/ThemeProvider'
import { useSettings, useSession, useRepoMutation } from '../data/settings'
import {
  CLOCK_STYLES,
  WORLD_ZONES,
  useClockPreferences,
  useWorldClocks,
  type ClockFormat,
  type ClockStyle,
} from '../data/clock'

/**
 * The settings page.
 *
 * The first secondary page converted under §7 Phase 4, which requires that the
 * conversion "preserve deep links, keyboard interactions, search/sort,
 * drag/resize/collapse, persistence, and semantics".
 *
 * WHAT CARRIES OVER AND WHAT DOES NOT. The templated page has six sections:
 * Appearance, Clock, Repositories, Polling & API, Server and About.
 *
 * Appearance, Clock and Repositories are here. The clock controls (time
 * format, show seconds, show date, fifteen visual styles, world clocks) write
 * the same `hellogitty-clock` / `hellogitty-worldclocks` keys the templated
 * page already used, and the React Masthead now reads them — so a visitor
 * crossing from /legacy finds their saved preference honoured, and flipping a
 * toggle here reflects in the masthead immediately.
 *
 * Everything shown read-only is read-only on both pages. The two write actions
 * are the ones the templated page already had, calling the same endpoints.
 */

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b px-4 py-3 last:border-b-0" style={{ borderColor: 'var(--hg-line)' }}>
      <div className="min-w-0">
        <div className="text-[12.5px]" style={{ color: 'var(--hg-text)' }}>{label}</div>
        {hint && <div className="mt-0.5 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>{hint}</div>}
      </div>
      {/*
        `min-w-0` and the shrink allowance, because the Server section's values
        are absolute filesystem paths. Without them a long path refused to
        shrink and drew straight through its own label — visible immediately on
        the first render of this page, invisible in a fixture where every path
        was short.
      */}
      <div className="flex min-w-0 shrink items-center justify-end gap-2">{children}</div>
    </div>
  )
}

/** A value the server reports and nobody can edit here. */
function Readout({ value, unknown }: { value: string; unknown?: boolean }) {
  // An em dash, never a blank and never a zero — the same rule the rest of the
  // dashboard follows for a figure the server does not have.
  return (
    <span
      className="truncate font-mono text-[11.5px] tabular-nums"
      // The full value in the title, since truncation hides the end of a path
      // and the end is the part that identifies it.
      title={unknown || !value ? undefined : value}
      style={{ color: unknown ? 'var(--hg-text-muted)' : 'var(--hg-text)', direction: 'rtl', textAlign: 'right' }}
    >
      {/*
        `direction: rtl` truncates from the LEFT, so a path shows its filename
        rather than its first forty characters of home directory. The span is
        isolated with a bidi marker so the text itself still reads normally.
      */}
      <bdi>{unknown || !value ? '—' : value}</bdi>
    </span>
  )
}

function SegmentedControl<T extends string>({
  label, options, value, onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  // Radix ToggleGroup gives the WAI-ARIA radiogroup behaviour (arrow-key
  // navigation and roving tabindex) that the hand-rolled button row above
  // lacked. The `v && onChange(v)` guards Radix's "unset" state — a user
  // clicking the active item would otherwise clear the selection, which
  // this segmented control is not meant to allow.
  return (
    <ToggleGroup
      aria-label={label}
      size="md"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function SettingsPage() {
  usePageTitle('Settings · HelloGitty')
  const { pack, setPack, appearance, setAppearance, packHasAmoled, packs } = useTheme()
  const settings = useSettings()
  const session = useSession()
  const repoMutation = useRepoMutation(session.data?.token)
  const [repoInput, setRepoInput] = useState('')
  const clock = useClockPreferences()
  const worldClocks = useWorldClocks()
  const [worldClockPick, setWorldClockPick] = useState('')

  const d = settings.data
  const writable = session.data?.writable === true

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-4">
      <h1 className="mb-3 text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>Settings</h1>

      {settings.isError && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>Settings could not be read: {settings.error.message}</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Panel>
          <PanelHeader title="Appearance" />
          <Row label="Appearance" hint="Auto follows your operating system. AMOLED is only available on packs that ship a true-black variant.">
            <SegmentedControl<Appearance>
              label="Appearance"
              value={appearance}
              onChange={setAppearance}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                ...(packHasAmoled ? [{ value: 'amoled' as Appearance, label: 'AMOLED' }] : []),
              ]}
            />
          </Row>
        </Panel>

        <Panel>
          <PanelHeader title="Theme pack" />
          <div className="px-4 py-3">
            <p className="mb-3 text-[11.5px]" style={{ color: 'var(--hg-text-muted)' }}>
              A theme pack is a colour overlay on top of the Appearance setting. Each pack carries
              its own identity and, where it ships one, its own AMOLED mode. Pick one or leave it
              at Default.
            </p>
            {/*
              The swatch grid mirrors `web/settings.html`'s layout — preview
              + name + description + badge — so the two surfaces look the
              same and a reader can tell which pack is which by eye, not
              by the pack id. #302 asked for this exact shape rather than
              a list of names.
            */}
            <PackGrid packs={packs} current={pack} onPick={setPack} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Clock" />
          <Row label="Time format" hint="24-hour reads unambiguously; 12-hour adds AM / PM.">
            <SegmentedControl<ClockFormat>
              label="Time format"
              value={clock.prefs.format}
              onChange={clock.setFormat}
              options={[
                { value: '24h', label: '24-hour' },
                { value: '12h', label: '12-hour' },
              ]}
            />
          </Row>
          <Row label="Show seconds" hint="Off also slows the clock's tick, so a quiet masthead stays quiet.">
            <SegmentedControl<'on' | 'off'>
              label="Show seconds"
              value={clock.prefs.seconds ? 'on' : 'off'}
              onChange={(v) => clock.setSeconds(v === 'on')}
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </Row>
          <Row label="Show date" hint="The weekday, month and date beneath the time.">
            <SegmentedControl<'on' | 'off'>
              label="Show date"
              value={clock.prefs.date ? 'on' : 'off'}
              onChange={(v) => clock.setDate(v === 'on')}
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </Row>
          <ClockStyleRow value={clock.prefs.style} onChange={clock.setStyle} />
        </Panel>

        <Panel>
          <PanelHeader title="World clocks">
            <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
              {worldClocks.clocks.length === 0 ? 'None added' : `${worldClocks.clocks.length} shown`}
            </span>
          </PanelHeader>
          {/*
            The list and the picker share one card. A fixed picker row, then
            one row per added clock. Every row has a Remove — a chip without a
            way to drop it collects stale timezones forever.
          */}
          <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--hg-line)' }}>
            <label className="flex min-w-0 flex-1 items-center">
              <span className="sr-only">Timezone to add</span>
              <select
                value={worldClockPick}
                onChange={(e) => setWorldClockPick(e.target.value)}
                className="w-full border px-3 py-1.5 text-[12px]"
                style={{ background: 'var(--hg-surface-sunken)', borderColor: 'var(--hg-line)', color: 'var(--hg-text)' }}
              >
                <option value="">Add a timezone…</option>
                {WORLD_ZONES.filter((z) => !worldClocks.clocks.some((c) => c.tz === z.tz)).map((z) => (
                  <option key={z.tz} value={z.tz}>
                    {z.long}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!worldClockPick}
              onClick={() => {
                worldClocks.add(worldClockPick)
                setWorldClockPick('')
              }}
              className="flex items-center gap-1.5 border px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--hg-accent-fill)', borderColor: 'var(--hg-accent-fill)', color: 'var(--hg-accent-ink)' }}
            >
              <Plus size={13} aria-hidden="true" />
              Add
            </button>
          </div>

          {worldClocks.clocks.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
              No world clocks added yet.
            </p>
          )}

          <ul>
            {worldClocks.clocks.map((c) => {
              const zone = WORLD_ZONES.find((z) => z.tz === c.tz)
              return (
                <li
                  key={c.tz}
                  className="flex items-center justify-between gap-3 border-b px-4 py-2 last:border-b-0"
                  style={{ borderColor: 'var(--hg-line)' }}
                >
                  <span className="truncate text-[12px]" style={{ color: 'var(--hg-text)' }}>
                    {zone?.long ?? c.tz}
                  </span>
                  <button
                    type="button"
                    onClick={() => worldClocks.remove(c.tz)}
                    className="flex shrink-0 items-center gap-1 border px-2 py-1 text-[11px]"
                    style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text-muted)' }}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                    Remove<span className="sr-only"> {zone?.long ?? c.tz}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="Repositories">
            <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
              {d ? `${d.repos.count} tracked` : '—'}
            </span>
          </PanelHeader>

          {writable ? (
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--hg-line)' }}>
              <label className="flex min-w-0 flex-1 items-center">
                <span className="sr-only">Repository to track, as owner/name or a GitHub link</span>
                <input
                  type="text"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter submits, because a text field beside one button
                    // that does not is a small daily irritation.
                    if (e.key === 'Enter' && repoInput.trim()) {
                      repoMutation.mutate({ repo: repoInput.trim(), action: 'add' })
                      setRepoInput('')
                    }
                  }}
                  placeholder="owner/name or GitHub link"
                  className="w-full border px-3 py-1.5 text-[12px]"
                  style={{ background: 'var(--hg-surface-sunken)', borderColor: 'var(--hg-line)', color: 'var(--hg-text)' }}
                />
              </label>
              <button
                type="button"
                disabled={!repoInput.trim() || repoMutation.isPending}
                onClick={() => {
                  repoMutation.mutate({ repo: repoInput.trim(), action: 'add' })
                  setRepoInput('')
                }}
                className="flex items-center gap-1.5 border px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
                style={{ background: 'var(--hg-accent-fill)', borderColor: 'var(--hg-accent-fill)', color: 'var(--hg-accent-ink)' }}
              >
                <Plus size={13} aria-hidden="true" />
                {repoMutation.isPending ? 'Working…' : 'Track'}
              </button>
            </div>
          ) : (
            <p className="border-b px-4 py-3 text-[12px]" style={{ borderColor: 'var(--hg-line)', color: 'var(--hg-text-muted)' }}>
              This build reads its repository list from a file, so it cannot be changed here.
            </p>
          )}

          {/* The server's own words on a rejection, which are more use than
              "something went wrong" — it says which repository and why. */}
          {repoMutation.isError && (
            <p role="alert" className="border-b px-4 py-2 text-[12px]" style={{ borderColor: 'var(--hg-line)', color: 'var(--hg-danger)' }}>
              {repoMutation.error.message}
            </p>
          )}

          {d && d.repos.tracked.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
              Nothing tracked yet.
            </p>
          )}

          <ul className="max-h-[320px] overflow-y-auto">
            {(d?.repos.tracked ?? []).map((slug) => (
              <li key={slug} className="flex items-center justify-between gap-3 border-b px-4 py-2 last:border-b-0" style={{ borderColor: 'var(--hg-line)' }}>
                <a
                  href={`https://github.com/${slug}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate font-mono text-[12px] no-underline hover:underline"
                  style={{ color: 'var(--hg-text)' }}
                >
                  {slug}
                </a>
                {writable && (
                  <button
                    type="button"
                    onClick={() => repoMutation.mutate({ repo: slug, action: 'remove' })}
                    className="flex shrink-0 items-center gap-1 border px-2 py-1 text-[11px]"
                    style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text-muted)' }}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                    Remove<span className="sr-only"> {slug}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/*
            Removed, but still in the last snapshot.

            Without this the removal looked like it had failed: the request
            returned 200 and the row simply stayed, because the snapshot is
            written by the poller and still held it. Saying so is better than
            either leaving the row or vanishing it silently — the repository is
            genuinely still in the data until the next cycle.
          */}
          {d && d.repos.removed.length > 0 && (
            <div className="border-t px-4 py-3" style={{ borderColor: 'var(--hg-line)' }}>
              <div className="mb-1.5 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                Removed — still in the last snapshot until the next poll
              </div>
              <ul className="flex flex-col gap-1">
                {d.repos.removed.map((slug) => (
                  <li key={slug} className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>{slug}</span>
                    {writable && (
                      <button
                        type="button"
                        onClick={() => repoMutation.mutate({ repo: slug, action: 'add' })}
                        className="shrink-0 border px-2 py-1 text-[11px]"
                        style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text)' }}
                      >
                        Track again<span className="sr-only"> {slug}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            MAINTAIN LIST. Read-only — the entries come from hellogitty.json's
            `maintain:` key, which means editing them is editing the config
            file and restarting. The templated page gated the whole section on
            `{{if .ConfigMaintain}}`; this gates on length for the same
            reason, so a user without a maintain list sees nothing rather
            than an empty "Maintain list (0)" strip.
          */}
          {d && d.config.maintain.length > 0 && (
            <div className="border-t px-4 py-3" style={{ borderColor: 'var(--hg-line)' }}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                <span>Maintain list — orgs and repositories whose PRs land under &ldquo;Waiting on you&rdquo;</span>
                <span
                  className="whitespace-nowrap border px-1.5 text-[10px] uppercase tracking-wide"
                  style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text-muted)' }}
                  title="Set in hellogitty.json; editing requires a restart"
                >
                  config file
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {d.config.maintain.map((slug) => (
                  <li key={slug} className="truncate font-mono text-[12px]" style={{ color: 'var(--hg-text)' }}>
                    {slug}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Polling and API" />
          <Row label="Poll interval">
            <Readout value={d ? `${d.polling.intervalMinutes} min` : ''} />
          </Row>
          <Row label="Last poll" hint={d && !d.polling.known ? 'No poll has completed yet.' : undefined}>
            <Readout value={d?.polling.lastPollUtc ?? ''} unknown={d ? !d.polling.known : true} />
          </Row>
          <Row label="Next poll">
            <Readout value={d?.polling.nextPollUtc ?? ''} unknown={d ? !d.polling.known : true} />
          </Row>
          <Row
            label="API quota"
            hint={d && !d.api.known ? 'Not checked yet this hour.' : undefined}
          >
            <Readout
              value={d && d.api.known ? `${d.api.used} of ${d.api.limit} used (${d.api.percent}%)` : ''}
              unknown={d ? !d.api.known : true}
            />
          </Row>
          <Row label="Quota resets">
            <Readout value={d?.api.resetUtc ?? ''} unknown={d ? !d.api.known : true} />
          </Row>
        </Panel>

        <Panel>
          <PanelHeader title="Server" />
          {/* Paths, not contents. Nothing here opens a file. */}
          <Row label="Listening on"><Readout value={d?.config.listen ?? ''} /></Row>
          <Row label="Database"><Readout value={d?.config.database ?? ''} /></Row>
          <Row label="Snapshot"><Readout value={d?.config.snapshot ?? ''} /></Row>
          <Row label="Repositories file" hint="When set, the tracked list is read from here.">
            <Readout value={d?.config.reposFile ?? ''} />
          </Row>
          <Row label="Inbox"><Readout value={d?.config.inbox ?? ''} /></Row>
          {/*
            PIPELINE TARGETS. Only meaningful when a `pipeline_command` is
            configured; `inPipeline === 0` on a dashboard with no pipeline is
            the same number as `inPipeline === 0` on a dashboard WITH one
            and no matches, and the second is a useful signal while the first
            is noise. Gating on `hasPipeline` keeps the two apart.
          */}
          {d?.hasPipeline && (
            <Row label="Pipeline targets" hint="How many tracked repositories the pipeline command covers.">
              <Readout value={String(d.repos.inPipeline)} />
            </Row>
          )}
          <Row label="Version"><Readout value={d?.version ?? ''} /></Row>
        </Panel>

      </div>
    </main>
  )
}

/**
 * The 15 clock-style swatches, reinstated per the owner's reversal of the
 * decision that #268 was built on. Fifteen visual variants (Default plus
 * fourteen named: Neon / Matrix / Nixie / LED / Flip and the rest). Each
 * swatch previews the style as a live "12:34" string using the same
 * `data-clock-style` attribute the Masthead reads — so what the picker
 * shows is what the user gets when they select it, and a future change to
 * one of the CSS blocks reflects in both surfaces with no second place to
 * edit.
 *
 * Grid is `minmax(120px, 1fr)` on auto-fit; the picker's own 390px gate is
 * covered by the overall /settings overflow check, so this does not need a
 * horizontal scroll container.
 */
function ClockStyleRow({ value, onChange }: { value: ClockStyle; onChange: (v: ClockStyle) => void }) {
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0" style={{ borderColor: 'var(--hg-line)' }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[12.5px]" style={{ color: 'var(--hg-text)' }}>Clock style</div>
          <div className="mt-0.5 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
            Fifteen visual variants on the masthead clock.
          </div>
        </div>
      </div>
      <ul
        role="radiogroup"
        aria-label="Clock style"
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}
      >
        {CLOCK_STYLES.map((s) => {
          const active = s.id === value
          const styleAttr = s.id === 'default' ? undefined : s.id
          return (
            <li key={s.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(s.id)}
                className="flex w-full flex-col items-center gap-1 border px-2 py-2.5 transition-colors"
                style={{
                  background: s.id === 'default' ? 'var(--hg-surface-sunken)' : stylePreviewBg(s.id),
                  borderColor: active ? 'var(--hg-accent)' : 'var(--hg-line)',
                  color: 'var(--hg-text)',
                }}
                data-clock-style={styleAttr}
              >
                {/*
                  The preview uses the exact same markup+classes the Masthead
                  uses, so the `data-clock-style` CSS rules apply identically.
                  No stand-in "preview style" that could drift from the real one.
                */}
                <span className="hg-clock-time block font-mono text-[18px] font-bold leading-none tabular-nums">
                  12:34
                </span>
                <span className="hg-clock-date block font-sans text-[10px] font-medium leading-none">
                  {s.name}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Backgrounds the templated picker swatches use so a dark-on-dark style like
 * Neon or Matrix reads at all inside a bright panel. Mirrors the inline
 * styles the templated `.clock-swatch[data-style="neon"]` etc. CSS set on
 * the swatch container, not on the clock itself.
 */
function stylePreviewBg(id: ClockStyle): string {
  switch (id) {
    case 'neon':
    case 'led':
      return '#0a0a0a'
    case 'ember':
      return '#1a0a00'
    case 'matrix':
    case 'terminal':
      return '#0a0f0a'
    case 'arctic':
      return '#0a1520'
    case 'midnight':
      return '#0f0a1a'
    case 'rose':
      return '#1a0a10'
    case 'nixie':
      return '#0f0800'
    case 'flip':
      return '#111'
    default:
      return 'var(--hg-surface-sunken)'
  }
}

/**
 * Pack swatch gallery — the pack picker that did not exist in React.
 *
 * Shape matches `web/settings.html:580` exactly: a swatch preview (a dot,
 * three bars, a name and a description), an optional corner badge, and a
 * "None" option for the default cascade. Selected pack carries a focus
 * ring and an aria-pressed. The swatch colours come from `PACKS` in
 * ThemeProvider, keyed by pack id; they are intentionally stated in that
 * file rather than reading live tokens here, because the preview should
 * show what the pack will look like whatever the user's current theme is.
 */
function PackGrid({ packs, current, onPick }: { packs: PackInfo[]; current: Pack; onPick: (p: Pack) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme pack"
      className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]"
    >
      <PackCard
        pack=""
        current={current}
        onPick={onPick}
        label="None"
        description="Default dashboard colours"
      />
      {packs.map((p) => (
        <PackCard
          key={p.id}
          pack={p.id}
          current={current}
          onPick={onPick}
          label={p.label}
          description={p.description}
          badge={p.badge}
          swatch={p.swatch}
        />
      ))}
    </div>
  )
}

function PackCard({
  pack,
  current,
  onPick,
  label,
  description,
  badge,
  swatch,
}: {
  pack: Pack
  current: Pack
  onPick: (p: Pack) => void
  label: string
  description: string
  badge?: PackInfo['badge']
  swatch?: PackInfo['swatch']
}) {
  const active = pack === current
  const preview = swatch ?? {
    bg: 'var(--hg-surface-sunken)',
    dot: 'var(--hg-text-muted)',
    bar1: 'var(--hg-text-muted)',
    bar2: 'var(--hg-line-strong)',
    bar3: 'var(--hg-line)',
    name: 'var(--hg-text)',
    desc: 'var(--hg-text-muted)',
  }
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onPick(pack)}
      className="relative flex min-h-[112px] flex-col gap-2 border p-3 text-left transition-colors"
      style={{
        borderColor: active ? 'var(--hg-accent)' : 'var(--hg-line)',
        background: active ? 'var(--hg-surface-raised)' : 'var(--hg-surface)',
        boxShadow: active ? '0 0 0 2px color-mix(in srgb, var(--hg-accent) 30%, transparent)' : undefined,
      }}
    >
      {badge && (
        <span
          className="absolute right-2 top-2 border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: badge.bg, color: badge.ink, borderColor: badge.bg }}
        >
          {badge.text}
        </span>
      )}
      <div className="flex items-center gap-2" style={{ background: preview.bg, padding: 10, border: '1px solid var(--hg-line)' }}>
        <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-full" style={{ background: preview.dot }} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span aria-hidden="true" className="block h-[4px] rounded-[2px]" style={{ background: preview.bar1, width: '80%' }} />
          <span aria-hidden="true" className="block h-[4px] rounded-[2px]" style={{ background: preview.bar2, width: '55%' }} />
          <span aria-hidden="true" className="block h-[4px] rounded-[2px]" style={{ background: preview.bar3, width: '70%' }} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-semibold" style={{ color: 'var(--hg-text)' }}>
          {label}
        </span>
        <span className="line-clamp-2 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          {description}
        </span>
      </div>
    </button>
  )
}
