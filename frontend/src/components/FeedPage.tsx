import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useFeed, useAck, type FeedRow as FeedRowData, type FeedDoc } from '../data/feed'
import { usePageTitle } from '../hooks/usePageTitle'
import { useSession } from '../data/settings'
import { stepFresh } from '../lib/freshRows'
import { WatchEyeButton, WatchStatusBanner } from './WatchEyeButton'

/**
 * The live activity feed.
 *
 * Reads `/feed.json`, writes `/feed/ack` and (via the eye button) `/watch`.
 * The three states this page actually has (not fetched / empty / with rows)
 * are kept distinct by the `known` flag — see "FOUR STATES, NOT TWO" below.
 *
 * Features restored from the templated feed (issue #295):
 *
 * - **Per-row eye control.** Issues, new-issue rows and watch/overlap rows
 *   get a `<WatchEyeButton />`, backed by the already-existing `/watch`
 *   endpoint. The feed is the first page to use the button; the list
 *   pages (#292) will lift the same component.
 *
 * - **Ack confirmation.** After acknowledging, a short string summarises
 *   the per-id results: "N also marked read on GitHub; M kept here only;
 *   K couldn't be marked read". Shown next to the controls (visible) as
 *   well as announced via `role="status"` for assistive tech.
 *
 * - **Show-acknowledged persistence.** The filter checkbox state writes
 *   to `localStorage("hellogitty-feed-all")` on change and reads it back
 *   on mount — same key the templated page used, so a reader's choice
 *   carries over whether they open the templated or the React variant.
 *
 * - **Fresh-row flash.** When a refetch brings in a row that wasn't in
 *   the previous payload, it renders with a `.hg-feed-fresh` class for
 *   one animation cycle. The first render seeds the "known" set and
 *   flashes nothing — same rule the templated page follows so a fresh
 *   page load isn't a sea of highlights.
 *
 * KNOWN IS NOT EMPTY. The templated page rendered "Nothing new. New
 * issues, comments, reviews and notifications appear here as they
 * happen." whenever `.Feed.Open == 0`, including before the first poll
 * completed. On a page whose whole job is telling you what happened,
 * that message under a known-false feed is the worst version of the
 * unknown-as-zero bug this migration keeps catching. The React page
 * renders a distinct "not fetched" state instead.
 */

type Filter = 'unacked' | 'all'

const SHOW_ACKED_KEY = 'hellogitty-feed-all'

function readStoredFilter(): Filter {
  // Try/catch because localStorage throws in a sandboxed iframe, when
  // storage is blocked by the user, and inside a private window on
  // some browsers. Default to the "unacked" view on any failure —
  // same as the templated page's behaviour when the read returns null.
  try {
    return localStorage.getItem(SHOW_ACKED_KEY) === '1' ? 'all' : 'unacked'
  } catch {
    return 'unacked'
  }
}

/** Kinds the eye applies to on the feed, same gate as the templated feed JS. */
const EYE_KINDS = new Set(['new-issue', 'issue', 'watch', 'overlap'])

export function FeedPage() {
  usePageTitle('HelloGitty live')
  const q = useFeed()
  const session = useSession()
  const qc = useQueryClient()
  // Lazy init for the filter: read localStorage once at mount. Updates
  // write through on every change via the effect below.
  const [filter, setFilter] = useState<Filter>(readStoredFilter)
  const [ackMsg, setAckMsg] = useState<string | null>(null)

  const ack = useAck(session.data?.token, (results) => {
    // The templated page builds this exact three-part string. Keep the
    // phrasing so a reader who already learned the templated one reads
    // the React one at a glance.
    const marked = results.filter((x) => x.github === 'marked').length
    const failed = results.filter((x) => x.github.startsWith('failed')).length
    const local = results.length - marked - failed
    const parts: string[] = []
    if (marked) parts.push(`${marked} also marked read on GitHub`)
    if (local)
      parts.push(
        `${local} kept here only (no GitHub notification behind ${local === 1 ? 'it' : 'them'})`,
      )
    if (failed)
      parts.push(`${failed} couldn't be marked read on GitHub; acknowledged here`)
    setAckMsg(`Acknowledged: ${parts.join('; ')}.`)
  })

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_ACKED_KEY, filter === 'all' ? '1' : '0')
    } catch {
      /* same reason as readStoredFilter */
    }
  }, [filter])

  // Clear the ack confirmation after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!ackMsg) return
    const t = window.setTimeout(() => setAckMsg(null), 5000)
    return () => window.clearTimeout(t)
  }, [ackMsg])

  const d = q.data

  // Fresh-row tracking. `knownIdsRef` is null until the first data load;
  // the first load seeds it (so no row is "fresh") and later loads mark
  // the difference as fresh for one animation cycle.
  const knownIdsRef = useRef<Set<string> | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!d) return
    const { nextKnown, freshIds: newOnes } = stepFresh(
      knownIdsRef.current,
      d.rows.map((r) => r.id),
    )
    knownIdsRef.current = nextKnown
    if (newOnes.size === 0) return
    setFreshIds(newOnes)
    const t = window.setTimeout(() => setFreshIds(new Set()), 2500)
    return () => window.clearTimeout(t)
  }, [d])

  const rows = useMemo<FeedRowData[]>(() => {
    if (!d) return []
    if (filter === 'all') return d.rows
    return d.rows.filter((r) => !r.acked)
  }, [d, filter])

  const openIds = useMemo(
    () => (d ? d.rows.filter((r) => !r.acked).map((r) => r.id) : []),
    [d],
  )
  const openCount = openIds.length

  const token = session.data?.token
  const canWatch = !!d?.canWatch

  // Flip one row's `watched` optimistically in the feed cache when the
  // eye toggles. The feed refetches every 20s anyway, so this is only
  // the in-between-ticks correctness; without it the eye snaps back on
  // the next re-render.
  const onEyeToggled = (issueKey: string, next: boolean) => {
    qc.setQueryData<FeedDoc>(['feed'], (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        rows: prev.rows.map((r) => (r.key === issueKey ? { ...r, watched: next } : r)),
      }
    })
  }

  return (
    <main id="main" tabIndex={-1} className="mx-auto min-w-0 max-w-[720px] px-4 pb-24 pt-4">
      <WatchStatusBanner />
      <header className="mb-3">
        <h1 className="text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>
          HelloGitty live
        </h1>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
          New issues, comments, reviews and notifications, newest first.
        </p>
      </header>

      {q.isPending && (
        <p className="mb-3 text-[12px]" style={{ color: 'var(--hg-text-muted)' }} role="status">
          Loading.
        </p>
      )}

      {q.isError && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="flex-1">{q.error.message}</span>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="flex items-center gap-1 border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
          >
            <RefreshCw size={11} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {ack.isError && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 border px-4 py-2.5 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="flex-1">
            {/*
              The server's own words. 'forbidden' means the token is stale
              (reload) or the request didn't come from this origin (a browser
              extension was in the way). Both are things the reader can act
              on, so we print the server's string rather than translate it.
            */}
            {ack.error.message}
          </span>
        </div>
      )}

      {/*
        FOUR STATES, NOT TWO.

        `known` means "a poll has completed since the process started", not
        "there is anything to show". The feed's rows come from a persisted
        snapshot cache: on a cold restart they are real events that happened
        — a stale snapshot is still a record, and suppressing it behind
        "the feed has not been fetched yet" hides every event the reader
        cared about across a restart. That is the inverse of rendering
        unknown as zero: it is rendering known-but-stale as nothing-at-all.
        Both are lies about what the server knows; on a feed whose whole
        job is telling you what happened, this direction is the worse one.

          known   rows    render
          true    n > 0   the rows
          true    0       "all caught up"
          false   n > 0   the rows, plus a staleness banner
          false   0       "the feed has not been fetched yet"
      */}
      {d && !d.known && d.rows.length === 0 && (
        <p
          role="status"
          data-testid="feed-not-fetched"
          className="border px-4 py-8 text-center text-[12.5px]"
          style={{
            borderColor: 'var(--hg-line)',
            background: 'var(--hg-surface)',
            color: 'var(--hg-text-muted)',
          }}
        >
          The feed has not been fetched yet. New issues, comments, reviews and notifications will appear here once the first poll runs.
        </p>
      )}

      {d && (d.known || d.rows.length > 0) && (
        <section
          className="border"
          style={{ borderColor: 'var(--hg-line)', background: 'var(--hg-surface)' }}
        >
          {!d.known && d.rows.length > 0 && (
            <p
              role="status"
              data-testid="feed-stale-banner"
              className="border-b px-4 py-2 text-[12px]"
              style={{
                borderColor: 'var(--hg-line)',
                background: 'var(--hg-surface-raised)',
                color: 'var(--hg-warning)',
              }}
            >
              These rows are from the cached snapshot — no poll has completed
              since this process started. The feed refreshes when the next
              poll runs.
            </p>
          )}

          {d.known && d.rows.length === 0 && (
            <p
              className="px-4 py-8 text-center text-[12.5px]"
              style={{ color: 'var(--hg-text-muted)' }}
            >
              Nothing new. New issues, comments, reviews and notifications appear here as they happen.
            </p>
          )}

          <ol className="list-none p-0" aria-live="polite">
            {rows.map((r) => (
              <FeedRow
                key={r.id}
                row={r}
                fresh={freshIds.has(r.id)}
                canWatch={canWatch}
                token={token}
                onAck={() => ack.mutate([r.id])}
                onEyeToggled={(next) => r.key && onEyeToggled(r.key, next)}
                busy={ack.isPending}
              />
            ))}
          </ol>

          <footer
            className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-[12px]"
            style={{ borderColor: 'var(--hg-line)', color: 'var(--hg-text-muted)' }}
          >
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={filter === 'all'}
                onChange={(e) => setFilter(e.target.checked ? 'all' : 'unacked')}
                style={{ accentColor: 'var(--hg-accent)' }}
              />
              Show acknowledged
            </label>
            <button
              type="button"
              onClick={() => openIds.length > 0 && ack.mutate(openIds)}
              disabled={openCount === 0 || ack.isPending || !session.data?.token}
              className="text-[12px] underline underline-offset-2 disabled:no-underline disabled:opacity-50"
              style={{ color: 'var(--hg-text)' }}
            >
              Acknowledge all{openCount > 0 ? ` (${openCount})` : ''}
            </button>
          </footer>

          {ackMsg && (
            /*
              The confirmation message. role="status" so assistive tech
              announces it; visible text so a sighted reader sees it too.
              Cleared after five seconds by the effect above — long enough
              to read, short enough that the next ack's message isn't
              competing with a stale one.
            */
            <p
              role="status"
              data-testid="feed-ack-msg"
              className="border-t px-4 py-2 text-[12px]"
              style={{
                borderColor: 'var(--hg-line)',
                background: 'var(--hg-surface-raised)',
                color: 'var(--hg-text-muted)',
              }}
            >
              {ackMsg}
            </p>
          )}
        </section>
      )}
    </main>
  )
}

function FeedRow({
  row,
  fresh,
  canWatch,
  token,
  onAck,
  onEyeToggled,
  busy,
}: {
  row: FeedRowData
  fresh: boolean
  canWatch: boolean
  token: string | undefined
  onAck: () => void
  onEyeToggled: (next: boolean) => void
  busy: boolean
}) {
  const ackLabel = row.acked ? 'Seen' : 'Ack'
  const ackTitle = row.thread
    ? 'Acknowledge; also marks it read on GitHub'
    : 'Acknowledge; kept in HelloGitty only'
  const tone = row.acked ? 'var(--hg-text-muted)' : 'var(--hg-text)'
  const showEye = canWatch && !!row.key && EYE_KINDS.has(row.kind)
  const cols = showEye ? 'grid-cols-[8px_minmax(0,1fr)_auto_auto]' : 'grid-cols-[8px_minmax(0,1fr)_auto]'
  return (
    <li
      data-id={row.id}
      className={`${cols} grid items-start gap-x-2.5 border-t px-3.5 py-2${fresh ? ' hg-feed-fresh' : ''}`}
      style={{
        borderColor: 'var(--hg-line)',
        opacity: row.acked ? 0.75 : 1,
      }}
    >
      {/* The status dot. Filled when unacked; outlined once acknowledged. */}
      <span
        aria-hidden="true"
        className="mt-1.5 inline-block h-2 w-2 rounded-full"
        style={{
          background: row.acked ? 'transparent' : 'var(--hg-success)',
          border: row.acked ? '1.5px solid var(--hg-line-strong)' : 'none',
        }}
      />

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className="shrink-0 text-[11.5px] font-semibold"
            style={{ color: 'var(--hg-text-muted)' }}
          >
            {row.label}
          </span>
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer noopener"
            className="line-clamp-2 text-[13.5px] no-underline hover:underline"
            style={{ color: tone, overflowWrap: 'anywhere' }}
          >
            {row.text}
          </a>
        </div>
        <div
          className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px]"
          style={{ color: 'var(--hg-text-muted)' }}
        >
          <span className="font-mono">
            {row.repo}
            {row.number ? ` #${row.number}` : ''}
          </span>
          {row.actor && <span>@{row.actor}</span>}
          <time dateTime={row.at} title={row.at}>
            {relativeTime(row.at)}
          </time>
        </div>
      </div>

      {showEye && row.key && (
        <WatchEyeButton
          issueKey={row.key}
          watched={!!row.watched}
          token={token}
          onToggled={(next) => onEyeToggled(next)}
        />
      )}

      <button
        type="button"
        onClick={onAck}
        disabled={row.acked || busy}
        title={ackTitle}
        aria-label={row.acked ? `Acknowledged: ${row.text}` : `Acknowledge: ${row.text}`}
        className="shrink-0 border px-2 py-1 text-[11.5px] disabled:cursor-default"
        style={{
          borderColor: row.acked ? 'transparent' : 'var(--hg-line-strong)',
          color: row.acked ? 'var(--hg-text-muted)' : 'var(--hg-text)',
          background: 'var(--hg-surface-raised)',
        }}
      >
        {ackLabel}
      </button>
    </li>
  )
}

/**
 * ISO 8601 → short relative-time string, against `Date.now()`.
 *
 * Deterministic in the test harness, which uses `page.clock.setFixedTime`
 * to freeze now. Nothing but this helper reads the wall clock on this
 * page — the fixed clock is what keeps a visual gate stable.
 */
function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  const minute = 60
  const hour = 60 * minute
  const day = 24 * hour
  if (seconds < minute) return 'just now'
  if (seconds < hour) return `${Math.round(seconds / minute)}m ago`
  if (seconds < day) return `${Math.round(seconds / hour)}h ago`
  return `${Math.round(seconds / day)}d ago`
}
