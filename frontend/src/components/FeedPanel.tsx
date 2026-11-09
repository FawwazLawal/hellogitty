import { Radio, ExternalLink } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import type { FeedRow } from '../data/feed'

/**
 * Live — the dashboard's summary of the activity feed.
 *
 * Shows up to the first eight UNACKNOWLEDGED rows, plus a link to `/feed`
 * for the full page. The templated panel also carried a per-row "ack" and
 * an "acknowledge all" control; both live on the full page here, so the
 * panel's job is to say "there is something new" and get out of the way.
 * Writing those controls twice would mean two places for the ack flow to
 * drift, and the `/feed` page is where the owner is already going to
 * make a judgement about each item.
 *
 * KNOWN IS NOT EMPTY. The caller passes `known: false` while the first
 * poll is in flight; the panel says "appears once HelloGitty has checked
 * GitHub" rather than "nothing new". A list with zero items AFTER a
 * successful fetch IS "nothing new" — distinct state, distinct copy.
 */

export function FeedPanel({
  rows,
  known,
}: {
  rows: readonly FeedRow[]
  known: boolean
}) {
  const open = rows.filter((r) => !r.acked)
  const shown = open.slice(0, 8)

  return (
    <Panel>
      <PanelHeader icon={<Radio size={14} aria-hidden="true" />} title="Live">
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          <span style={{ color: 'var(--hg-text)' }}>{open.length}</span> new ·{' '}
          <a
            href="/feed"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2"
            style={{ color: 'var(--hg-text)' }}
          >
            Open in a window
          </a>
        </span>
      </PanelHeader>

      <div className="px-4 py-3">
        {open.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            {known ? (
              <>
                <span style={{ color: 'var(--hg-text)', fontWeight: 600 }}>Nothing new. </span>
                New issues, comments, reviews and notifications appear here as they happen.
              </>
            ) : (
              <>The live feed appears once HelloGitty has checked GitHub.</>
            )}
          </p>
        ) : (
          <>
            <ol className="flex flex-col gap-1.5">
              {shown.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-[12px]">
                  <span
                    className="mt-0.5 shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{
                      background: 'var(--hg-surface-raised)',
                      color: 'var(--hg-text-muted)',
                    }}
                    title={r.kind}
                  >
                    {r.label}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 items-start gap-1 underline decoration-dotted underline-offset-2"
                      style={{ color: 'var(--hg-text)' }}
                      title={r.text}
                    >
                      <span className="truncate">{r.text}</span>
                      <ExternalLink size={10} aria-hidden="true" className="mt-0.5 shrink-0" />
                    </a>
                    <span
                      className="text-[10.5px]"
                      style={{ color: 'var(--hg-text-muted)' }}
                      title={r.at}
                    >
                      {r.repo}
                      {typeof r.number === 'number' ? ` #${r.number}` : ''} · {r.at}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            {open.length > shown.length && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                {open.length - shown.length} more on the{' '}
                <a
                  href="/feed"
                  className="underline decoration-dotted underline-offset-2"
                  style={{ color: 'var(--hg-text)' }}
                >
                  full feed
                </a>
                .
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}
