import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
 * SIX PANES — `appearance`, `clock`, `repos`, `polling`, `server`, `about` — on
 * a sticky left sidebar, matching the templated `/legacy/settings` page. The
 * React page shipped before this one as a single long scroll: everything on one
 * surface, no persistence of which section you were last on, no `#hash` deep
 * links. A visitor crossing from `/legacy` lost their place at the border.
 *
 * Three things the templated handler does that we match verbatim, because the
 * owner reviewed against /legacy:
 *
 *  1. Storage key is literally `hg-settings-pane`. Tests pin this as a string
 *     constant, not by reading it out of the page — if the attribute is
 *     renamed the tests must break, not silently pass.
 *  2. `#hash` wins over the saved pane. A link the user shared points at a
 *     specific pane; respecting their "last pane" and ignoring the hash would
 *     take them somewhere else than the link said.
 *  3. The pane id written to storage is `pane-<slug>`, not `<slug>`. Templated
 *     wrote the DOM id straight into storage; cross-tab sync depends on it
 *     matching character-for-character.
 *
 * The About pane lives here now. Its content — version, API quota, API reset —
 * is shown elsewhere in the dashboard, but a reader who opens Settings → About
 * looking for it expects to find it there, not scrolled off the bottom of a
 * long Server block.
 *
 * Polling and Server carry a card-level "requires a restart" note. The
 * templated page had those; React silently dropped them, and a reader who
 * flipped a value in `hellogitty.json` and refreshed the page could not tell
 * why nothing moved.
 */

const SETTINGS_PANE_KEY = 'hg-settings-pane'

type PaneId =
  | 'pane-appearance'
  | 'pane-clock'
  | 'pane-repos'
  | 'pane-polling'
  | 'pane-server'
  | 'pane-about'

interface PaneDef {
  id: PaneId
  hash: string
  label: string
}

const PANES: readonly PaneDef[] = [
  { id: 'pane-appearance', hash: 'appearance', label: 'Appearance' },
  { id: 'pane-clock', hash: 'clock', label: 'Clock' },
  { id: 'pane-repos', hash: 'repos', label: 'Repositories' },
  { id: 'pane-polling', hash: 'polling', label: 'Polling & API' },
  { id: 'pane-server', hash: 'server', label: 'Server' },
  { id: 'pane-about', hash: 'about', label: 'About' },
] as const

const PANE_IDS = new Set<PaneId>(PANES.map((p) => p.id))
const HASH_TO_ID = new Map<string, PaneId>(PANES.map((p) => [p.hash, p.id]))
const ID_TO_HASH = new Map<PaneId, string>(PANES.map((p) => [p.id, p.hash]))

function readHashPane(): PaneId | null {
  if (typeof window === 'undefined') return null
  const h = window.location.hash.replace(/^#/, '')
  return HASH_TO_ID.get(h) ?? null
}

function readSavedPane(): PaneId | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SETTINGS_PANE_KEY)
    // `0`-unbound guard: a saved value from an older build, a removed pane
    // (e.g. a pre-split "clock-styles" that became part of Clock), or a
    // tampered one must not leave us landing on nothing. Fall through to the
    // default rather than show a blank right column.
    if (raw && PANE_IDS.has(raw as PaneId)) return raw as PaneId
    return null
  } catch {
    return null
  }
}

/**
 * The pane selection hook.
 *
 * Owns the `#hash` ↔ `localStorage` ↔ React-state cycle, so the rest of the
 * page never touches `history` or `localStorage` directly.
 *
 *  - Hash wins over saved on initial read (point 2 above).
 *  - Clicking a tab replaces the URL hash (not push: the Back button should
 *    not walk through your left-sidebar clicks).
 *  - External hash changes — someone pastes a `#server` link into the URL
 *    bar on this very tab — update the active pane.
 *
 * We don't listen to `storage` for cross-tab sync because the pane is a
 * per-tab UI preference, and a second tab suddenly jumping panes while the
 * reader is on it would be hostile.
 */
function useSettingsPane(): { active: PaneId; select: (id: PaneId) => void } {
  const [active, setActive] = useState<PaneId>(() => {
    return readHashPane() ?? readSavedPane() ?? 'pane-appearance'
  })

  // Write to storage whenever the active pane changes, including the initial
  // value — so a visitor who lands with `#server` and never clicks anything
  // still has that remembered next time.
  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_PANE_KEY, active)
    } catch {
      /* private mode, storage quota */
    }
  }, [active])

  useEffect(() => {
    const onHash = () => {
      const h = readHashPane()
      if (h) setActive(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const select = useCallback((id: PaneId) => {
    setActive(id)
    const hash = ID_TO_HASH.get(id)
    if (hash) {
      // replaceState, not pushState: the browser Back button should leave the
      // page, not walk the user through every sidebar click.
      try {
        window.history.replaceState(null, '', `#${hash}`)
      } catch {
        /* sandboxed iframe */
      }
    }
  }, [])

  return { active, select }
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b px-4 py-3 last:border-b-0" style={{ borderColor: 'var(--hg-line)' }}>
      <div className="min-w-0">
        <div className="text-[12.5px]" style={{ color: 'var(--hg-text)' }}>{label}</div>
        {hint && <div className="mt-0.5 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>{hint}</div>}
      </div>
      <div className="flex min-w-0 shrink items-center justify-end gap-2">{children}</div>
    </div>
  )
}

function Readout({ value, unknown }: { value: string; unknown?: boolean }) {
  return (
    <span
      className="truncate font-mono text-[11.5px] tabular-nums"
      title={unknown || !value ? undefined : value}
      style={{ color: unknown ? 'var(--hg-text-muted)' : 'var(--hg-text)', direction: 'rtl', textAlign: 'right' }}
    >
      <bdi>{unknown || !value ? '—' : value}</bdi>
    </span>
  )
}

/**
 * The card-level "requires a restart" footer the templated page carried and
 * React silently dropped. Semantically a plain paragraph with a muted tone,
 * not a warning — the setting is valid; it just needs the server to be
 * bounced for a changed value to take effect.
 */
function RestartNote({ children }: { children: ReactNode }) {
  return (
    <p className="border-t px-4 py-2.5 text-[11px]" style={{ borderColor: 'var(--hg-line)', color: 'var(--hg-text-muted)' }}>
      {children}
    </p>
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
  const { active, select } = useSettingsPane()

  const settings = useSettings()

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-4">
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

      {/*
        Two columns above md, one above the other below. The sidebar is sticky
        so a long pane (Server lists seven paths) does not scroll the
        navigation off-screen. Mobile keeps the sidebar visible by stacking
        it at the top, scrollable horizontally rather than wrapping — which
        would push the actual pane below the fold on every load.
      */}
      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        <SettingsSidebar active={active} onSelect={select} />
        <div className="min-w-0 flex-1">
          <PaneContainer active={active} />
        </div>
      </div>
    </main>
  )
}

function SettingsSidebar({ active, onSelect }: { active: PaneId; onSelect: (id: PaneId) => void }) {
  return (
    <nav
      aria-label="Settings sections"
      className="md:sticky md:top-4 md:w-[200px] md:shrink-0 md:self-start"
    >
      {/*
        role=tablist is wrong here: the browser URL changes, and these are
        anchors to sections of a page a visitor can deep-link into, not
        hidden/shown tabs within one widget. ARIA pattern is a navigation
        with aria-current="page" on the active item.
      */}
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible">
        {PANES.map((p) => {
          const isActive = p.id === active
          return (
            <li key={p.id} className="shrink-0">
              <a
                href={`#${p.hash}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={(e) => {
                  // Click handler updates React state immediately rather than
                  // relying on the `hashchange` event, which fires AFTER the
                  // browser has scrolled the page — a visible jump the
                  // sticky header would then try to correct.
                  e.preventDefault()
                  onSelect(p.id)
                }}
                className="block whitespace-nowrap border-l-2 px-3 py-2 text-[12.5px] no-underline transition-colors"
                style={{
                  borderLeftColor: isActive ? 'var(--hg-accent)' : 'transparent',
                  background: isActive ? 'var(--hg-surface-raised)' : 'transparent',
                  color: isActive ? 'var(--hg-text)' : 'var(--hg-text-muted)',
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {p.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * The pane container: renders only the active pane. We don't render all six
 * and hide five of them, because a Readout for `/etc/hellogitty/db` on an
 * inactive Server pane still subscribes to the settings query and triggers
 * re-renders on each poll — cheap, but genuinely nothing for them to do.
 *
 * Each pane gets a fresh focus lead: scroll the right column back to the top
 * when the active pane changes, so a user who scrolled Server to the bottom
 * then clicked Clock does not read the Clock heading halfway down the
 * viewport.
 */
function PaneContainer({ active }: { active: PaneId }) {
  const ref = useRef<HTMLDivElement>(null)
  // useLayoutEffect, not useEffect: scrolls before paint so there is no
  // one-frame flash of the previous scroll position.
  useLayoutEffect(() => {
    ref.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [active])

  return (
    <div ref={ref} className="flex flex-col gap-3">
      {active === 'pane-appearance' && <AppearancePane />}
      {active === 'pane-clock' && <ClockPane />}
      {active === 'pane-repos' && <RepositoriesPane />}
      {active === 'pane-polling' && <PollingPane />}
      {active === 'pane-server' && <ServerPane />}
      {active === 'pane-about' && <AboutPane />}
    </div>
  )
}

function AppearancePane() {
  const { pack, setPack, appearance, setAppearance, packHasAmoled, packs } = useTheme()
  return (
    <>
      <Panel>
        <PanelHeader title="Appearance" />
        <Row
          label="Appearance"
          hint="Auto follows your operating system. AMOLED is only available on packs that ship a true-black variant."
        >
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
            at None.
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
    </>
  )
}

function ClockPane() {
  const clock = useClockPreferences()
  const worldClocks = useWorldClocks()
  const [worldClockPick, setWorldClockPick] = useState('')
  return (
    <>
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
        {/*
          The fifteen clock-style swatches. Templated /legacy currently has
          no picker — #268 dropped it and the owner reversed that call in
          #277 — so parity here follows the dev branch: the picker lives in
          the Clock card alongside format / seconds / date, not in its own
          section. World clocks keep their own card because the chip list
          grows and the add-select deserves the width.
        */}
        <ClockStyleRow value={clock.prefs.style} onChange={clock.setStyle} />
      </Panel>

      <Panel>
        <PanelHeader title="World clocks">
          <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
            {worldClocks.clocks.length === 0 ? 'None added' : `${worldClocks.clocks.length} shown`}
          </span>
        </PanelHeader>
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
    </>
  )
}

function RepositoriesPane() {
  const settings = useSettings()
  const session = useSession()
  const repoMutation = useRepoMutation(session.data?.token)
  const [repoInput, setRepoInput] = useState('')
  const d = settings.data
  const writable = session.data?.writable === true

  return (
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
  )
}

function PollingPane() {
  const settings = useSettings()
  const d = settings.data
  return (
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
      <RestartNote>
        Poll interval is defined in <code className="font-mono">hellogitty.json</code> and requires a restart to change.
      </RestartNote>
    </Panel>
  )
}

function ServerPane() {
  const settings = useSettings()
  const d = settings.data
  return (
    <Panel>
      <PanelHeader title="Server" />
      <Row label="Listening on"><Readout value={d?.config.listen ?? ''} /></Row>
      <Row label="Database"><Readout value={d?.config.database ?? ''} /></Row>
      <Row label="Snapshot"><Readout value={d?.config.snapshot ?? ''} /></Row>
      <Row label="Repositories file" hint="When set, the tracked list is read from here.">
        <Readout value={d?.config.reposFile ?? ''} />
      </Row>
      <Row label="Inbox"><Readout value={d?.config.inbox ?? ''} /></Row>
      {/*
        Tracked repos count. Duplicated from the Repositories pane header on
        purpose: Server is where the templated page shows it, and a reader
        reviewing the dashboard's configuration should not have to switch
        panes to see the number the paths above are populated for.
      */}
      <Row label="Tracked repos"><Readout value={d ? String(d.repos.count) : ''} /></Row>
      {d?.hasPipeline && (
        <Row label="Pipeline targets" hint="How many tracked repositories the pipeline command covers.">
          <Readout value={String(d.repos.inPipeline)} />
        </Row>
      )}
      <RestartNote>
        Server settings are defined in <code className="font-mono">hellogitty.json</code> and require a restart to take effect.
      </RestartNote>
    </Panel>
  )
}

function AboutPane() {
  const settings = useSettings()
  const d = settings.data
  return (
    <Panel>
      <PanelHeader title="About" />
      {/*
        Three rows match the templated page exactly: Version, GitHub API,
        API resets. "Build information" is the templated section-desc, but
        React carries no build hash yet — if that lands, it belongs here.
      */}
      <Row label="Version"><Readout value={d?.version ?? ''} /></Row>
      <Row
        label="GitHub API"
        hint={d && !d.api.known ? 'Not checked yet this hour.' : undefined}
      >
        <Readout
          value={d && d.api.known ? `${d.api.used} of ${d.api.limit} used (${d.api.percent}%)` : ''}
          unknown={d ? !d.api.known : true}
        />
      </Row>
      <Row label="API resets">
        <Readout value={d?.api.resetUtc ?? ''} unknown={d ? !d.api.known : true} />
      </Row>
    </Panel>
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

// Named exports for tests that need to pin the storage key and pane ids as
// LITERALS, not read from the implementation. Importing the constant would
// make the test green on a rename that silently breaks cross-tab sync with
// the templated page.
export { SETTINGS_PANE_KEY, PANES }
export type { PaneId }

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
