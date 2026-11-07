import { useState, type ReactNode } from 'react'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import { useTheme } from '../theme/ThemeProvider'
import type { Appearance } from '../theme/ThemeProvider'
import { useSettings, useSession, useRepoMutation } from '../data/settings'

/**
 * The settings page.
 *
 * The first secondary page converted under §7 Phase 4, which requires that the
 * conversion "preserve deep links, keyboard interactions, search/sort,
 * drag/resize/collapse, persistence, and semantics".
 *
 * WHAT CARRIES OVER AND WHAT DOES NOT. The templated page has six sections:
 * Appearance, Clock, Repositories, Polling & API, Server and About. Appearance
 * and Repositories are here. The clock controls are NOT, and that is a
 * deliberate omission rather than an oversight: they write localStorage keys
 * the React masthead does not read yet, so converting the controls without the
 * clock that obeys them would produce switches that do nothing — the exact
 * defect the navigation bar just shipped with. They stay on the templated page,
 * which is still reachable, until the clock itself moves.
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
  return (
    <div role="group" aria-label={label} className="flex border" style={{ borderColor: 'var(--hg-line-strong)' }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className="px-3 py-1.5 text-[12px] transition-colors"
            style={{
              background: active ? 'var(--hg-accent-fill)' : 'var(--hg-surface)',
              color: active ? 'var(--hg-accent-ink)' : 'var(--hg-text-muted)',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function SettingsPage() {
  const { identity, identities, order, setIdentity, appearance, setAppearance } = useTheme()
  const settings = useSettings()
  const session = useSession()
  const repoMutation = useRepoMutation(session.data?.token)
  const [repoInput, setRepoInput] = useState('')

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
          <Row label="Appearance" hint="Auto follows your operating system.">
            <SegmentedControl<Appearance>
              label="Appearance"
              value={appearance}
              onChange={setAppearance}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Row>
          <Row label="Visual identity" hint={identities[identity].description}>
            <SegmentedControl
              label="Visual identity"
              value={identity}
              onChange={setIdentity}
              options={order.map((id) => ({ value: id, label: identities[id].label }))}
            />
          </Row>
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
          <Row label="Version"><Readout value={d?.version ?? ''} /></Row>
        </Panel>

        <p className="px-1 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          Clock options are still on the{' '}
          <a href="/legacy" style={{ color: 'var(--hg-accent)' }}>templated settings page</a>. They
          write preferences the React clock does not read yet, so they are left where they work.
        </p>
      </div>
    </main>
  )
}
