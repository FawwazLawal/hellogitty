import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'

/**
 * The shell every /alerts/* page renders into.
 *
 * ONE PAGE, NINE THIN CONFIGURATIONS. The inventory showed the ten templated
 * alert pages are the same structure (header, lead paragraph, stat tiles,
 * sections with a ruled heading, optional recovery note) with three body
 * shapes between them. Writing ten components mirroring ten templates would
 * have been mechanical fidelity to how the templates were authored, not to
 * what the pages actually are.
 *
 * KNOWN IS NOT A STATUS INDICATOR. It gates the body. When `known` is false
 * every section is replaced with the `notFetchedNote`, and the stat tiles
 * display an em-dash rather than their value — because an alert page that
 * reads an unfetched zero as "all clear" is worse than a blank page: it is
 * actively reassuring. This is the whole point of the port, per the peer's
 * sign-off.
 *
 * STAT TILES carry their own per-tile `known`, not only the page-level one.
 * On the data-stale page, LastPoll can be known while NextPoll is unknown,
 * for instance — and the dash wins every time.
 */

export interface Stat {
  label: string
  value: number | string
  known: boolean
  /** Visual accent: the hero tile that explains why the page lit. */
  tone?: 'caution' | 'warn' | 'neutral'
}

export interface AlertSection {
  key: string
  heading: string
  /** The rendered body. When the collection the page reads is empty but
   * known, pass the empty state through as `body`. The shell does NOT
   * synthesise an all-clear message — the page's own copy decides what
   * "none of these" says. */
  body: ReactNode
}

export interface AlertPageProps {
  title: string
  subtitle: string
  /** The gate. Switches the whole body for the not-fetched note. */
  known: boolean
  /** What to say when `known` is false. One sentence; the shell renders it
   *  in place of every section and sets every stat to "—". */
  notFetchedNote: string
  /** Fetched but incomplete. A different state from `!known` — shown as a
   *  warning banner above the body, which still renders. */
  partial?: boolean
  stats: Stat[]
  sections: AlertSection[]
  recovery?: ReactNode
  loading: boolean
  error: string | null
  onRetry: () => void
}

/**
 * Format a stat value for the tile. Numbers render with tabular-nums;
 * strings pass through. Unknowns are always the em-dash.
 */
function renderStat(s: Stat): ReactNode {
  if (!s.known) return '—'
  return s.value
}

/**
 * The tone → border-colour map. Tones map to semantic tokens, never raw
 * hex, so each identity's palette carries through intact. `caution` is the
 * accent in all identities (what "needs attention" looks like in this
 * palette); `warn` is the yellow/amber token; `neutral` is the hairline.
 */
function toneBorder(tone: Stat['tone']): string {
  switch (tone) {
    case 'caution':
      return 'var(--hg-accent)'
    case 'warn':
      return 'var(--hg-warning)'
    default:
      return 'var(--hg-line)'
  }
}

export function AlertPage({
  title,
  subtitle,
  known,
  notFetchedNote,
  partial,
  stats,
  sections,
  recovery,
  loading,
  error,
  onRetry,
}: AlertPageProps) {
  return (
    <main className="mx-auto min-w-0 max-w-[920px] px-4 pb-[200px] pt-4">
      <header className="mb-4">
        <h1 className="text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>
          {title}
        </h1>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
          {subtitle}
        </p>
      </header>

      {loading && (
        <p className="mb-3 text-[12px]" style={{ color: 'var(--hg-text-muted)' }} role="status">
          Loading.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
          >
            <RefreshCw size={11} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {partial && (
        <div
          role="status"
          className="mb-3 flex items-start gap-2 border px-4 py-2.5 text-[12px]"
          style={{ borderColor: 'var(--hg-warning)', color: 'var(--hg-warning)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>This view is incomplete — the last refresh did not finish, so something may be missing.</span>
        </div>
      )}

      {stats.length > 0 && (
        <div
          className="mb-4 grid gap-2"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              className="border px-4 py-3 text-center"
              style={{
                background: 'var(--hg-surface)',
                borderColor: toneBorder(s.tone),
              }}
            >
              <span
                className="block font-mono text-[22px] font-bold tabular-nums"
                style={{ color: s.known ? 'var(--hg-text)' : 'var(--hg-text-muted)' }}
              >
                {renderStat(s)}
              </span>
              <span className="mt-0.5 block text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {!known && (
        /*
          The not-fetched branch. This replaces every section the page would
          have rendered. The copy comes from the page itself because the
          wording depends on which subsystem is behind it (the watch feed
          has not refreshed, the pipeline has not run, no poll has completed).
          Falling through to an empty-but-known section is the bug we are
          preventing.
        */
        <p
          className="border px-4 py-8 text-center text-[12.5px]"
          style={{
            borderColor: 'var(--hg-line)',
            background: 'var(--hg-surface)',
            color: 'var(--hg-text-muted)',
          }}
          role="status"
          data-testid="alert-not-fetched"
        >
          {notFetchedNote}
        </p>
      )}

      {known && sections.map((section) => (
        <Panel key={section.key} className="mb-3">
          <PanelHeader title={section.heading} />
          {section.body}
        </Panel>
      ))}

      {known && recovery && (
        <div
          className="mt-4 border px-4 py-3 text-[12.5px] leading-relaxed"
          style={{
            borderColor: 'var(--hg-line)',
            background: 'var(--hg-surface)',
            color: 'var(--hg-text)',
          }}
        >
          {recovery}
        </div>
      )}
    </main>
  )
}
