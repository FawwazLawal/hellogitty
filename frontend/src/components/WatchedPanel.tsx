import { Eye, ExternalLink } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import type { WatchItemFromApi } from '../data/dashboard'

/**
 * Watched issues — the rows the owner has flagged with the eye, plus ones
 * the backend attached because the state transitioned on them.
 *
 * ADR-UI-002 §4: the shape comes verbatim from `WatchItem` on the Go side
 * (shared with the alerts document, same `toWatchItems` helper). Nothing is
 * computed here — status words are the server's vocabulary, not translated.
 *
 * Empty state is a real answer. An empty list is NOT "we haven't checked" —
 * watching is an accumulating set that the owner builds by clicking eyes,
 * so empty means "nothing watched", full stop. That is why there is no
 * `known` flag on the watched array in the dashboard document: there is no
 * "before the first fetch" condition for this list.
 *
 * `outside` and `seen` are the two row modifiers. `outside` is for issues
 * in a repository the owner does not track (they watched it with the eye
 * on another page); it reads as a subtler row so the owner can tell their
 * tracked and outside watches apart. `seen` dims rows the owner already
 * acknowledged the claim/closure of — the alert cells on those rows are
 * also quiet, same rule as the templated page.
 */

export function WatchedPanel({ rows }: { rows: WatchItemFromApi[] }) {
  return (
    <Panel>
      <PanelHeader icon={<Eye size={14} aria-hidden="true" />} title="Watched issues">
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          {rows.length} watched
        </span>
      </PanelHeader>
      <div className="px-4 py-3">
        {rows.length === 0 ? (
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--hg-text-muted)' }}>
            <span style={{ color: 'var(--hg-text)', fontWeight: 600 }}>Nothing watched. </span>
            Watch an issue before you start on it, and you&rsquo;ll hear if someone else claims
            or fixes it. Click the eye on any issue on this page, or run{' '}
            <code
              className="px-1 py-0.5 text-[11px]"
              style={{
                background: 'var(--hg-surface-raised)',
                color: 'var(--hg-text)',
              }}
            >
              hellogitty watch owner/name 123
            </code>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((w) => (
              <li
                key={`${w.repo}#${w.number}`}
                className="flex flex-col gap-0.5"
                style={{
                  opacity: w.seen ? 0.55 : 1,
                  color: w.outside ? 'var(--hg-text-muted)' : 'var(--hg-text)',
                }}
              >
                <div className="flex items-start gap-2 text-[12px]">
                  <WatchStatusBadge status={w.status} seen={w.seen} />
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-start gap-1 underline decoration-dotted underline-offset-2"
                    style={{ color: 'inherit' }}
                    title={w.title}
                  >
                    <span className="shrink-0" style={{ color: 'var(--hg-text-muted)' }}>
                      {w.repo}#{w.number}
                    </span>
                    <span className="truncate">{w.title}</span>
                    <ExternalLink size={10} aria-hidden="true" className="mt-0.5 shrink-0" />
                  </a>
                </div>
                {(w.claimDetail || w.changedAt) && (
                  <div
                    className="pl-0 text-[10.5px]"
                    style={{ color: 'var(--hg-text-muted)' }}
                  >
                    {w.claimDetail && <span>{w.claimDetail}</span>}
                    {w.claimDetail && w.changedAt && <span> &middot; </span>}
                    {w.changedAt && <span>changed {w.changedAt}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}

function WatchStatusBadge({ status, seen }: { status: string; seen: boolean }) {
  // The server's vocabulary — not translated to a different label here. The
  // CSS class carries the server's word so a theme can target each state
  // without the component deciding what "CLAIMED" should look like.
  const visible = status === '' ? null : labelFor(status)
  if (!visible) return null
  return (
    <span
      className={`shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider${seen ? ' hg-watch-seen' : ''}`}
      style={{ background: 'var(--hg-surface-raised)', color: 'var(--hg-text-muted)' }}
      data-status={status}
      title={seen ? 'Seen. It lights up again if anything changes.' : undefined}
    >
      {visible}
    </span>
  )
}

function labelFor(status: string): string {
  switch (status) {
    case 'CLAIMED':
      return 'Claimed'
    case 'CLOSED_FIXED':
      return 'Fixed'
    case 'CLOSED_WONT':
      return 'Won’t fix'
    case 'OPEN':
      return 'Open'
    default:
      return status
  }
}
