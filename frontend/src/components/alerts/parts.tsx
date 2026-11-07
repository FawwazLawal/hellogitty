import type { ReactNode } from 'react'
import { ExternalLink, AlertTriangle } from 'lucide-react'
import type { AlertItem, HealthItem, WatchItem } from '../../data/alerts'

/**
 * Row primitives shared across the alert pages.
 *
 * Kept tiny on purpose. The templates each inlined their own list markup and
 * drifted; one primitive per row shape here means one place for row
 * geometry, padding and dividers. Each row is a list item under the caller's
 * `<ul>`, so a page keeps control of semantics while sharing presentation.
 */

/** Top-aligned, bordered list wrapper. */
export function AlertList({ children }: { children: ReactNode }) {
  return <ul className="divide-y" style={{ borderColor: 'var(--hg-line)' }}>{children}</ul>
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p
      className="px-4 py-6 text-center text-[12px]"
      style={{ color: 'var(--hg-text-muted)' }}
    >
      {children}
    </p>
  )
}

/**
 * An item row — a PR or an issue the user owns a move on, or that is owed to
 * them. Shared by your-move's three sub-lists.
 */
export function ItemRow({ item }: { item: AlertItem }) {
  return (
    <li
      className="border-b px-4 py-2.5 last:border-b-0"
      style={{ borderColor: 'var(--hg-line)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 text-[12.5px] no-underline hover:underline"
            style={{ color: 'var(--hg-text)' }}
          >
            <span className="truncate">{item.title}</span>
            <ExternalLink size={11} aria-hidden="true" className="shrink-0 opacity-50" />
          </a>
          <div
            className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
            style={{ color: 'var(--hg-text-muted)' }}
          >
            <span className="font-mono">{item.repo}#{item.number}</span>
            <span className="rounded px-1.5 text-[10px] uppercase tracking-wider"
                  style={{ background: 'var(--hg-surface-raised)', color: 'var(--hg-text-muted)' }}>
              {item.kind}
            </span>
            {item.why && <span>· {item.why}</span>}
            {item.status && (
              <span style={{ color: item.level === 'caution' ? 'var(--hg-warning)' : undefined }}>
                · {item.status}
              </span>
            )}
          </div>
          {item.notes.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {item.notes.map((n, i) => (
                <li
                  key={i}
                  className="inline-block px-1.5 py-0.5 text-[10.5px]"
                  style={{
                    background: 'var(--hg-surface-raised)',
                    color: n.level === 'caution' ? 'var(--hg-warning)' : 'var(--hg-text-muted)',
                  }}
                >
                  {n.text}
                </li>
              ))}
            </ul>
          )}
          {item.quote && (
            <blockquote
              className="mt-1 border-l pl-2 text-[11px] italic"
              style={{ borderColor: 'var(--hg-line)', color: 'var(--hg-text-muted)' }}
            >
              <strong style={{ color: 'var(--hg-text)' }}>{item.quoteBy}:</strong> {item.quote}
            </blockquote>
          )}
        </div>
        <span
          className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums"
          style={{ color: 'var(--hg-text-muted)' }}
          title={item.agoTitle}
        >
          {item.ago || '—'}
        </span>
      </div>
    </li>
  )
}

/** A watched issue's row — closed or claimed. */
export function WatchRow({ item }: { item: WatchItem }) {
  const badge = badgeFor(item.status)
  return (
    <li className="border-b px-4 py-2.5 last:border-b-0" style={{ borderColor: 'var(--hg-line)' }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 text-[12.5px] no-underline hover:underline"
            style={{ color: 'var(--hg-text)' }}
          >
            <span className="font-mono text-[11px]">{item.repo}#{item.number}</span>
            <span className="truncate">{item.title}</span>
            {badge && (
              <span
                className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ background: badge.bg, color: badge.ink }}
              >
                {badge.label}
              </span>
            )}
          </a>
          {item.claimDetail && (
            <div className="mt-1 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
              {isUrl(item.claimDetail) ? (
                <a href={item.claimDetail} target="_blank" rel="noreferrer noopener">
                  See the claim →
                </a>
              ) : (
                item.claimDetail
              )}
            </div>
          )}
        </div>
        {item.changedAt && (
          <time
            dateTime={item.changedAt}
            className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums"
            style={{ color: 'var(--hg-text-muted)' }}
          >
            {formatDate(item.changedAt)}
          </time>
        )}
      </div>
    </li>
  )
}

/** A repository row for the health and flagged pages. */
export function HealthRow({ item }: { item: HealthItem }) {
  return (
    <li className="border-b px-4 py-2.5 last:border-b-0" style={{ borderColor: 'var(--hg-line)' }}>
      <div className="flex items-center justify-between gap-4">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 flex-1 truncate text-[12.5px] font-medium no-underline hover:underline"
          style={{ color: 'var(--hg-text)' }}
        >
          {item.owner}/{item.name}
        </a>
        <span
          className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            background: item.health === 'DORMANT' ? 'var(--hg-surface-raised)' : 'var(--hg-surface-raised)',
            color: item.health === 'DORMANT' ? 'var(--hg-danger)' : 'var(--hg-warning)',
          }}
        >
          {item.health}
        </span>
        <div className="flex shrink-0 gap-3 font-mono text-[11px] tabular-nums" style={{ color: 'var(--hg-text-muted)' }}>
          {/*
            Polled is "has ever been checked". When false the counts are
            zero because nobody looked, so they are rendered as em-dashes —
            same reasoning as every other known/unknown branch on these
            pages. In practice the dormant/slow filter upstream already
            drops never-polled repos (their Health is UNKNOWN), so this is
            defensive: if a future caller renders a Health row off-filter,
            the zeros stop lying before someone notices.
          */}
          <span>{item.polled ? `${item.open} open` : '— open'}</span>
          <span>{item.polled ? `${item.gfi} GFI` : '— GFI'}</span>
        </div>
        <span
          className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums"
          style={{ color: 'var(--hg-text-muted)' }}
        >
          {/*
            AgeKnown is why this is here: an unchecked repo renders a dash,
            not "0d" — which would read as "committed today" on a repo we
            have not looked at.
          */}
          {item.ageKnown ? `${item.ageDays}d ago` : '—'}
        </span>
      </div>
    </li>
  )
}

/** A simple key/value facts row — for data-stale and api-low. */
export function Fact({
  label,
  value,
  known,
}: {
  label: string
  value: ReactNode
  known: boolean
}) {
  return (
    <li
      className="grid grid-cols-[minmax(0,180px)_1fr] gap-3 border-b px-4 py-2.5 text-[12.5px] last:border-b-0"
      style={{ borderColor: 'var(--hg-line)' }}
    >
      <span style={{ color: 'var(--hg-text-muted)' }}>{label}</span>
      <span
        className="font-mono tabular-nums"
        style={{ color: known ? 'var(--hg-text)' : 'var(--hg-text-muted)' }}
      >
        {known ? value : '—'}
      </span>
    </li>
  )
}

/** A left-right caution/info block inline in a page. */
export function InlineNote({ children }: { children: ReactNode }) {
  return (
    <p
      className="mt-2 flex items-center gap-1.5 text-[11.5px]"
      style={{ color: 'var(--hg-text-muted)' }}
    >
      <AlertTriangle size={12} aria-hidden="true" />
      {children}
    </p>
  )
}

function badgeFor(status: string | undefined): { label: string; bg: string; ink: string } | null {
  switch (status) {
    case 'CLAIMED':
      return { label: 'Claimed', bg: 'var(--hg-surface-raised)', ink: 'var(--hg-danger)' }
    case 'CLOSED_FIXED':
      return { label: 'Fixed', bg: 'var(--hg-surface-raised)', ink: 'var(--hg-success)' }
    case 'CLOSED_WONT':
    case 'CLOSED':
      return { label: 'Closed', bg: 'var(--hg-surface-raised)', ink: 'var(--hg-text-muted)' }
    default:
      return null
  }
}

function isUrl(s: string): boolean {
  return /^https?:\/\//.test(s)
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toISOString().slice(0, 10)
  } catch {
    return iso
  }
}
