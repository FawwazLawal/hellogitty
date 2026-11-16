import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { MessageSquare, AlertTriangle, ExternalLink } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import { usePageTitle } from '../hooks/usePageTitle'

/**
 * The Conversations page.
 *
 * Issues and pull requests the owner JOINED without opening — commented on or
 * was mentioned in — across tracked repositories. The page exists so those
 * live apart from "Your work"; mixing them would hide the distinction that
 * made them their own list.
 *
 * UNKNOWN IS NOT ZERO. Every count on this page carries a `known` flag. The
 * dashboard polls on an interval, so before the first refresh the board has no
 * rows AND we have no reason to believe it — "0 waiting for you" on a blank
 * board looks exactly like a cleared inbox, which is the most consequential
 * lie this surface can tell. An em dash is drawn instead, and the rail is
 * hidden rather than rendered as an empty three-zero line.
 *
 * SORTING follows the same rule: an item without a timestamp sorts LAST, not
 * first. A row with SinceUnix=0 means the server did not have the instant;
 * sorting it to the top of "Updated" would promote the thing we know least
 * about to the thing most worth looking at.
 */

const ConvRow = z.object({
  key: z.string(),
  kind: z.string(),
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  why: z.string(),
  ago: z.string(),
  agoTitle: z.string(),
  /** Epoch seconds; 0 means the server did not have a timestamp. */
  sinceUnix: z.number().int(),
  /** The attention cue: "new" (unread), "caution" (your move), or "". */
  attn: z.string().optional().default(''),
})
type ConvRow = z.infer<typeof ConvRow>

const ConvDoc = z.object({
  known: z.boolean(),
  error: z.string().optional(),
  partial: z.boolean(),
  convYou: z.array(ConvRow),
  convThem: z.array(ConvRow),
  convNew: z.number().int(),
})

function useConversations() {
  return useQuery({
    queryKey: ['work'],
    queryFn: async () => {
      const res = await fetch('/app/api/work.json', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`the conversations board answered ${res.status}`)
      const parsed = ConvDoc.safeParse(await res.json())
      if (!parsed.success) {
        const i = parsed.error.issues[0]
        throw new Error(`unexpected shape: ${i.path.join('.') || '(root)'} ${i.message}`)
      }
      return parsed.data
    },
    refetchInterval: 60_000,
    retry: 1,
  })
}

type Filter = 'all' | 'you' | 'them'
type SortKey = 'status' | 'updated' | 'repo'
type SortDir = 'asc' | 'desc'

const FIRST_DIR: Record<SortKey, SortDir> = { status: 'asc', updated: 'desc', repo: 'asc' }
const STATUS_RANK: Record<'you' | 'them', number> = { you: 0, them: 1 }

interface Item extends ConvRow {
  group: 'you' | 'them'
}

/**
 * Compose the two groups into a single sorted, filtered list.
 *
 * Kept out of the component so the rule is easier to read: filter before
 * sort, and when a tie happens inside the primary key fall back on the
 * newest first — but with UNKNOWN last, not first. The two branches read as
 * one sentence and make it obvious the "unknown last" rule is the floor.
 */
function orderedRows(
  convYou: ConvRow[],
  convThem: ConvRow[],
  filter: Filter,
  needle: string,
  sortKey: SortKey,
  sortDir: SortDir,
): Item[] {
  const all: Item[] = [
    ...convYou.map((r) => ({ ...r, group: 'you' as const })),
    ...convThem.map((r) => ({ ...r, group: 'them' as const })),
  ]
  const groupOk = (g: 'you' | 'them') => filter === 'all' || filter === g
  const text = needle.trim().toLowerCase()
  const words = text ? text.split(/\s+/).filter(Boolean) : []
  const searchOk = (r: Item) => {
    if (!words.length) return true
    const hay = `${r.title} ${r.repo} #${r.number} ${r.why}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  }

  const rows = all.filter((r) => groupOk(r.group) && searchOk(r))
  const flip = sortDir === 'asc' ? 1 : -1

  // Known-last ordering for a key: rows with `has` false always come after
  // rows with `has` true, no matter which direction the user chose.
  const byKnownThen = (cmp: (a: Item, b: Item) => number, has: (r: Item) => boolean) => {
    return (a: Item, b: Item) => {
      const ak = has(a), bk = has(b)
      if (ak !== bk) return ak ? -1 : 1
      return cmp(a, b)
    }
  }

  const byUpdated = byKnownThen(
    (a, b) => (a.sinceUnix - b.sinceUnix) * flip,
    (r) => r.sinceUnix > 0,
  )
  const byRepo = (a: Item, b: Item) =>
    a.repo.toLowerCase().localeCompare(b.repo.toLowerCase()) * flip ||
    b.sinceUnix - a.sinceUnix
  const byStatus = (a: Item, b: Item) =>
    (STATUS_RANK[a.group] - STATUS_RANK[b.group]) * flip ||
    b.sinceUnix - a.sinceUnix

  if (sortKey === 'updated') rows.sort(byUpdated)
  else if (sortKey === 'repo') rows.sort(byRepo)
  else rows.sort(byStatus)

  return rows
}

export function ConversationsPage() {
  usePageTitle('Conversations · HelloGitty')
  const q = useConversations()
  const d = q.data
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>(FIRST_DIR.status)

  const rows = useMemo(() => {
    if (!d) return []
    return orderedRows(d.convYou, d.convThem, filter, search, sortKey, sortDir)
  }, [d, filter, search, sortKey, sortDir])

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(k)
      setSortDir(FIRST_DIR[k])
    }
  }

  // Unknown is drawn as an em dash, not a zero. Partial — the board is new
  // but incomplete — is the warning strip; `known: false` is the three em
  // dashes in the overview.
  const unknown = d && !d.known

  return (
    <main className="min-w-0 overflow-x-hidden px-4 pb-24 pt-4">
      <h1 className="mb-1 text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>
        Conversations
      </h1>
      <p className="mb-3 text-[11.5px]" style={{ color: 'var(--hg-text-muted)' }}>
        Issues and pull requests you joined — commented on or were mentioned in — across tracked repositories.
      </p>

      {q.isError && (
        <div role="alert" className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}>
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{q.error.message}</span>
        </div>
      )}

      {d?.partial && (
        <div role="status" className="mb-3 flex items-start gap-2 border px-4 py-2.5 text-[12px]"
          style={{ borderColor: 'var(--hg-warning)', color: 'var(--hg-warning)' }}>
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>This board is incomplete — the last refresh did not finish, so something may be missing.</span>
        </div>
      )}

      {/*
        Three overview cards. UNKNOWN IS NOT ZERO: before the first poll the
        values read as an em dash, not "0", and the card loses its activation
        role — a filter into an unfetched set is a filter into nothing.
      */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <OverviewCard
          label="Needs your reply"
          value={unknown ? null : d?.convYou.length ?? null}
          active={filter === 'you'}
          onActivate={unknown ? undefined : () => setFilter('you')}
        />
        <OverviewCard
          label="Waiting on others"
          value={unknown ? null : d?.convThem.length ?? null}
          active={filter === 'them'}
          onActivate={unknown ? undefined : () => setFilter('them')}
        />
        <OverviewCard
          label="Unread"
          value={unknown ? null : d?.convNew ?? null}
        />
      </div>

      <Panel>
        <PanelHeader icon={<MessageSquare size={14} aria-hidden="true" />} title="Conversations">
          <label className="flex items-center">
            <span className="sr-only">Search conversations</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-[180px] border px-2.5 py-1 text-[11.5px]"
              style={{ background: 'var(--hg-surface-sunken)', borderColor: 'var(--hg-line)', color: 'var(--hg-text)' }}
            />
          </label>
        </PanelHeader>

        <div
          role="group"
          aria-label="Conversation filters"
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--hg-line)' }}
        >
          {(['all', 'you', 'them'] as const).map((f) => {
            const active = filter === f
            const label = f === 'all' ? 'All' : f === 'you' ? 'Needs me' : 'Waiting'
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f)}
                className="border px-2.5 py-1 text-[11.5px] transition-colors"
                style={{
                  background: active ? 'var(--hg-accent-fill)' : 'var(--hg-surface)',
                  borderColor: active ? 'var(--hg-accent-fill)' : 'var(--hg-line-strong)',
                  color: active ? 'var(--hg-accent-ink)' : 'var(--hg-text-muted)',
                }}
              >
                {label}
              </button>
            )
          })}

          <div className="ml-auto flex items-center gap-2" role="group" aria-label="Sort conversations">
            <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>Sort</span>
            {(['status', 'updated', 'repo'] as const).map((k) => {
              const active = sortKey === k
              const label = k === 'status' ? 'Status' : k === 'updated' ? 'Updated' : 'Repository'
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={active}
                  data-sort-key={k}
                  data-sort-dir={active ? sortDir : undefined}
                  onClick={() => toggleSort(k)}
                  className="border px-2 py-1 text-[11px] transition-colors"
                  style={{
                    background: active ? 'var(--hg-accent-fill)' : 'var(--hg-surface)',
                    borderColor: active ? 'var(--hg-accent-fill)' : 'var(--hg-line-strong)',
                    color: active ? 'var(--hg-accent-ink)' : 'var(--hg-text-muted)',
                  }}
                >
                  {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              )
            })}
          </div>
        </div>

        {d && !d.known && (
          <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            Conversations have not been fetched yet.
          </p>
        )}

        {d && d.known && rows.length === 0 && (
          <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            {search
              ? 'Nothing matches that search.'
              : 'No conversations yet. Comment on or get mentioned in an issue or PR in a tracked repository to see it here.'}
          </p>
        )}

        <ul data-testid="conv-list">
          {rows.map((r) => (
            <li
              key={r.key}
              data-group={r.group}
              data-sinceunix={r.sinceUnix}
              data-attn={r.attn || undefined}
              className="border-b px-4 py-2.5 last:border-b-0"
              style={{ borderColor: 'var(--hg-line)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className="mt-0.5 shrink-0 border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
                    style={{
                      background: r.group === 'you' ? 'var(--hg-warning-fill)' : 'var(--hg-surface-sunken)',
                      color: r.group === 'you' ? 'var(--hg-warning-ink)' : 'var(--hg-text-muted)',
                      borderColor: r.group === 'you' ? 'var(--hg-warning)' : 'var(--hg-line)',
                    }}
                  >
                    {r.group === 'you' ? 'Needs reply' : 'Waiting'}
                  </span>
                  <div className="min-w-0">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-1.5 text-[12.5px] no-underline hover:underline"
                      style={{
                        color: 'var(--hg-text)',
                        fontWeight: r.attn === 'new' || r.attn === 'caution' ? 700 : 500,
                      }}
                    >
                      <span className="truncate">{r.title}</span>
                      <ExternalLink size={11} aria-hidden="true" className="shrink-0 opacity-50" />
                    </a>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                      <span className="font-mono">{r.repo}#{r.number}</span>
                      {r.why && <span>· {r.why}</span>}
                    </div>
                  </div>
                </div>
                <span
                  className="shrink-0 font-mono text-[11px] tabular-nums"
                  style={{ color: 'var(--hg-text-muted)' }}
                  title={r.sinceUnix > 0 ? r.agoTitle : undefined}
                >
                  {r.sinceUnix > 0 ? r.ago : '—'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  )
}

function OverviewCard({
  label,
  value,
  active,
  onActivate,
}: {
  label: string
  /** null means "not fetched" — render an em dash, not a zero. */
  value: number | null
  active?: boolean
  onActivate?: () => void
}) {
  const interactive = !!onActivate
  const display = value === null ? '—' : String(value)
  const dim = value === null || value === 0
  const className =
    'flex flex-col items-center gap-0.5 border px-3 py-3 text-center transition-colors ' +
    (interactive ? 'cursor-pointer' : 'cursor-default')
  const style = {
    background: active ? 'var(--hg-surface-raised)' : 'var(--hg-surface)',
    borderColor: active ? 'var(--hg-accent)' : 'var(--hg-line)',
  }

  // A button when it's a filter, a plain div when it's a readout. Giving the
  // Unread card a role it can't deliver on would be a lie about the surface,
  // and so would letting an unknown value be activated to filter into an
  // empty set.
  if (!interactive) {
    return (
      <div className={className} style={style}>
        <span
          className="font-mono text-[20px] font-bold tabular-nums"
          style={{ color: dim ? 'var(--hg-text-muted)' : 'var(--hg-text)' }}
        >
          {display}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          {label}
        </span>
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={!!active}
      onClick={onActivate}
      className={className}
      style={style}
    >
      <span
        className="font-mono text-[20px] font-bold tabular-nums"
        style={{ color: dim ? 'var(--hg-text-muted)' : 'var(--hg-text)' }}
      >
        {display}
      </span>
      <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
        {label}
      </span>
    </button>
  )
}

export { orderedRows as __orderedRows }
