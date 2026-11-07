import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import {
  Boxes,
  AlertTriangle,
  ExternalLink,
  GitPullRequest,
  CircleDot,
  Activity,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'

/**
 * The "Your repositories" page.
 *
 * The scope is deliberately different from the work board: the work board is
 * what you have out (PRs and issues you authored, anywhere), and this page is
 * what has happened in the repositories you own — your outgoing items that
 * landed in your own repos, your finished ones, and events about those repos
 * that matched no board row (a failed workflow, a release, a mention).
 *
 * UNKNOWN IS NOT ZERO. The templated page printed `.Pipeline.Open` straight —
 * so before the first poll every overview tile read "0 Open PRs", a tile that
 * looks exactly like "nothing to do" when the correct answer is "nobody has
 * checked yet". `pipelineKnown` and `workKnown` carry the distinction out of
 * the server. When unknown, the tile renders "—" and the list renders a line
 * that says so, instead of an empty state that reads as "nothing here".
 *
 * TWO READINESS CLOCKS. Pipeline and Work are polled independently and can be
 * known at different moments. The overview respects each: Open and Merged
 * follow `pipelineKnown`, Unread follows `workKnown`, and the list area holds
 * off until the Work board is known — the lists live on the Work data.
 *
 * SORT KEEPS UNKNOWN AT THE END. The Status sort uses the group order the
 * templated page encoded in `statusOrder` (you=0, done=1, activity=2). The
 * Updated sort compares `agoTitle` which is an ISO-like timestamp; rows
 * without one sort to the end of the list regardless of ascending/descending —
 * an item with no timestamp is unknown, not stale-forever.
 */

const WorkRow = z.object({
  key: z.string(),
  kind: z.string(),
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  why: z.string(),
  status: z.string(),
  level: z.string(),
  personal: z.string().optional(),
  ago: z.string(),
  agoTitle: z.string(),
  labels: z.array(z.string()),
})
type WorkRow = z.infer<typeof WorkRow>

const RepoActivity = z.object({
  key: z.string(),
  title: z.string(),
  url: z.string(),
  repo: z.string(),
  number: z.number().int().optional(),
  words: z.string(),
  ago: z.string(),
  agoTitle: z.string(),
  new: z.number().int().optional(),
  attn: z.string().optional(),
})
type RepoActivity = z.infer<typeof RepoActivity>

const YourReposDoc = z.object({
  pipelineKnown: z.boolean(),
  workKnown: z.boolean(),
  error: z.string().optional(),
  partial: z.boolean(),
  login: z.string(),
  open: z.number().int(),
  merged: z.number().int(),
  reposNew: z.number().int(),
  you: z.array(WorkRow),
  done: z.array(WorkRow),
  repoOther: z.array(RepoActivity),
})
type YourReposDoc = z.infer<typeof YourReposDoc>

function useYourRepos() {
  return useQuery({
    queryKey: ['your-repos'],
    queryFn: async () => {
      const res = await fetch('/app/api/your-repos.json', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`your repositories answered ${res.status}`)
      const parsed = YourReposDoc.safeParse(await res.json())
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

type Kind = 'all' | 'PR' | 'Issue'
type SortKey = 'status' | 'updated' | 'repo'
type Group = 'you' | 'done' | 'activity'

interface Item {
  key: string
  group: Group
  kind: string
  repo: string
  number: number
  title: string
  url: string
  // The second line under the title.
  meta: string
  personal?: string
  level?: string
  ago: string
  agoTitle: string
  searchable: string
}

const GROUP_ORDER: Record<Group, number> = { you: 0, done: 1, activity: 2 }

function workToItem(r: WorkRow, group: Exclude<Group, 'activity'>): Item {
  const metaParts: string[] = [`${r.repo}#${r.number}`, r.kind]
  if (r.status) metaParts.push(r.status)
  return {
    key: r.key,
    group,
    kind: r.kind,
    repo: r.repo,
    number: r.number,
    title: r.title,
    url: r.url,
    meta: metaParts.join(' · '),
    personal: r.personal || undefined,
    level: r.level,
    ago: r.ago,
    agoTitle: r.agoTitle,
    // The templated page's search behaviour: title + repo + number.
    searchable: `${r.title} ${r.repo}#${r.number} ${r.why} ${r.status}`.toLowerCase(),
  }
}

function activityToItem(r: RepoActivity): Item {
  const metaParts: string[] = [r.repo]
  if (r.words) metaParts.push(r.words)
  return {
    key: r.key,
    group: 'activity',
    kind: 'Activity',
    repo: r.repo,
    number: r.number ?? 0,
    title: r.title,
    url: r.url,
    meta: metaParts.join(' · '),
    ago: r.ago,
    agoTitle: r.agoTitle,
    searchable: `${r.title} ${r.repo} ${r.words}`.toLowerCase(),
  }
}

function Tile({
  label,
  value,
  known,
  Icon,
  href,
}: {
  label: string
  value: number
  known: boolean
  Icon: typeof GitPullRequest
  href?: string
}) {
  const content = (
    <>
      <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
        <Icon size={12} aria-hidden="true" />
        {label}
      </div>
      {/*
        The em-dash, not a zero, when the server has not reported this count
        yet. The whole point of this file: a tile saying "0 Open PRs" before
        the pipeline has been polled would tell the reader there is nothing to
        do about a figure nobody has looked at.
      */}
      <div
        className="mt-1 font-mono text-[22px] font-semibold tabular-nums"
        style={{ color: known ? 'var(--hg-text)' : 'var(--hg-text-muted)' }}
      >
        {known ? value : '—'}
      </div>
    </>
  )
  const style: React.CSSProperties = {
    background: 'var(--hg-surface)',
    borderColor: 'var(--hg-line)',
  }
  const className =
    'block border px-3 py-2 text-left no-underline transition-colors hover:bg-[var(--hg-surface-raised)]'
  if (href && known && value > 0) {
    return (
      <a href={href} className={className} style={style}>
        {content}
      </a>
    )
  }
  return (
    <div className={className} style={style}>
      {content}
    </div>
  )
}

const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'PR', label: 'Pull requests' },
  { id: 'Issue', label: 'Issues' },
]

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'updated', label: 'Updated' },
  { id: 'repo', label: 'Repository' },
]

export function YourReposPage() {
  const q = useYourRepos()
  const [kind, setKind] = useState<Kind>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortAsc, setSortAsc] = useState(true)

  const d = q.data

  const items = useMemo<Item[]>(() => {
    if (!d) return []
    return [
      ...d.you.map((r) => workToItem(r, 'you')),
      ...d.done.map((r) => workToItem(r, 'done')),
      ...d.repoOther.map((r) => activityToItem(r)),
    ]
  }, [d])

  const filtered = useMemo<Item[]>(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const matches = (it: Item) => {
      // PR / Issue filter applies only to work rows. Activity rows have no
      // kind in the Go sense; they are always visible under "All" and hidden
      // under the two specific filters, matching the templated page.
      if (kind !== 'all' && it.kind !== kind) return false
      if (words.length === 0) return true
      return words.every((w) => it.searchable.includes(w))
    }
    return items.filter(matches)
  }, [items, kind, search])

  const sorted = useMemo<Item[]>(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'status') {
        cmp = GROUP_ORDER[a.group] - GROUP_ORDER[b.group]
      } else if (sortKey === 'updated') {
        // Rows with no timestamp are unknown, not oldest: they sort to the
        // end of the list regardless of direction.
        const ta = a.agoTitle
        const tb = b.agoTitle
        if (!ta && !tb) cmp = 0
        else if (!ta) return 1
        else if (!tb) return -1
        else cmp = ta.localeCompare(tb)
      } else if (sortKey === 'repo') {
        cmp = a.repo.localeCompare(b.repo)
      }
      return sortAsc ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortAsc])

  return (
    <main className="min-w-0 overflow-x-hidden px-4 pb-24 pt-4">
      <h1 className="mb-1 text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>
        Your repositories
      </h1>
      <p className="mb-3 text-[11.5px]" style={{ color: 'var(--hg-text-muted)' }}>
        Your pull requests, CI runs, releases and other activity in your own repositories.
      </p>

      {q.isError && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{q.error.message}</span>
        </div>
      )}

      {d?.error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{d.error}</span>
        </div>
      )}

      {d?.partial && (
        <div
          role="status"
          className="mb-3 flex items-start gap-2 border px-4 py-2.5 text-[12px]"
          style={{ borderColor: 'var(--hg-warning)', color: 'var(--hg-warning)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>This board is incomplete — the last refresh did not finish, so something may be missing.</span>
        </div>
      )}

      {/* Overview tiles. Each is unknown-aware in its own right. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile
          Icon={GitPullRequest}
          label="Open PRs"
          value={d?.open ?? 0}
          known={d?.pipelineKnown ?? false}
          href="/list?prs=open"
        />
        <Tile
          Icon={CircleDot}
          label="Merged"
          value={d?.merged ?? 0}
          known={d?.pipelineKnown ?? false}
          href="/list?prs=merged"
        />
        <Tile
          Icon={Activity}
          label="Unread"
          value={d?.reposNew ?? 0}
          known={d?.workKnown ?? false}
        />
      </div>

      <Panel>
        <PanelHeader icon={<Boxes size={14} aria-hidden="true" />} title="Your work in your repos">
          <label className="flex items-center">
            <span className="sr-only">Search your repositories</span>
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
          aria-label="Filter by kind"
          className="flex flex-wrap gap-2 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--hg-line)' }}
        >
          {KINDS.map((k) => {
            const active = kind === k.id
            return (
              <button
                key={k.id}
                type="button"
                aria-pressed={active}
                onClick={() => setKind(k.id)}
                className="border px-2.5 py-1 text-[11.5px] transition-colors"
                style={{
                  background: active ? 'var(--hg-accent-fill)' : 'var(--hg-surface)',
                  borderColor: active ? 'var(--hg-accent-fill)' : 'var(--hg-line-strong)',
                  color: active ? 'var(--hg-accent-ink)' : 'var(--hg-text-muted)',
                }}
              >
                {k.label}
              </button>
            )
          })}
        </div>

        <div
          role="group"
          aria-label="Sort"
          className="flex flex-wrap items-center justify-end gap-2 border-b px-4 py-2 text-[11px]"
          style={{ borderColor: 'var(--hg-line)' }}
        >
          <span style={{ color: 'var(--hg-text-muted)' }}>Sort</span>
          {SORTS.map((s) => {
            const active = sortKey === s.id
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (active) setSortAsc((v) => !v)
                  else {
                    setSortKey(s.id)
                    setSortAsc(true)
                  }
                }}
                className="flex items-center gap-1 border px-2 py-0.5 text-[11px] transition-colors"
                style={{
                  borderColor: active ? 'var(--hg-accent)' : 'var(--hg-line-strong)',
                  color: active ? 'var(--hg-text)' : 'var(--hg-text-muted)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {s.label}
                {active &&
                  (sortAsc ? (
                    <ArrowUp size={10} aria-label="ascending" />
                  ) : (
                    <ArrowDown size={10} aria-label="descending" />
                  ))}
              </button>
            )
          })}
        </div>

        {/*
          Unknown is not empty. Before the work board has been polled, show a
          sentence that says that — not the "Nothing here yet" copy, which
          would read as a confident "no items" about data nobody has looked at.
        */}
        {q.isPending && (
          <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            Loading…
          </p>
        )}

        {d && !d.workKnown && (
          <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            The work board has not been fetched yet.
          </p>
        )}

        {d && d.workKnown && sorted.length === 0 && (
          <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            {search || kind !== 'all'
              ? 'Nothing matches that filter.'
              : 'Nothing here yet. Open a PR or issue in a tracked repository to see your work here.'}
          </p>
        )}

        <ul>
          {sorted.map((it) => (
            <li
              key={it.key}
              className="border-b px-4 py-2.5 last:border-b-0"
              style={{ borderColor: 'var(--hg-line)' }}
            >
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {/*
                    `min-w-0` on every flex ancestor between <li> and the
                    truncating span. A flex item defaults to
                    `min-width: auto`, which lets its content push it wider
                    than its parent — so the chain has to carry `min-w-0` end
                    to end or truncation never happens. Caught at 390px by a
                    title that was 387px wide inside a 214px column; the
                    chain-level fix is the only one that works, not the span.
                  */}
                  <div className="flex min-w-0 items-center gap-2">
                    <GroupPill group={it.group} />
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex min-w-0 items-center gap-1.5 text-[12.5px] no-underline hover:underline"
                      style={{ color: 'var(--hg-text)' }}
                    >
                      <span className="truncate">{it.title}</span>
                      <ExternalLink size={11} aria-hidden="true" className="shrink-0 opacity-50" />
                    </a>
                  </div>
                  <div
                    className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
                    style={{ color: 'var(--hg-text-muted)' }}
                  >
                    <span className="font-mono">{it.meta}</span>
                    {it.personal && <span style={{ color: 'var(--hg-accent)' }}>· {it.personal}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="font-mono text-[11px] tabular-nums"
                    style={{ color: 'var(--hg-text-muted)' }}
                    title={it.agoTitle || undefined}
                  >
                    {/* Em-dash for a row without a timestamp, matching the rest of the UI. */}
                    {it.ago || '—'}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  )
}

function GroupPill({ group }: { group: Group }) {
  // Not colour alone — the label carries the meaning. Colour is a hint on top.
  const config: Record<Group, { label: string; bg: string; fg: string; border: string }> = {
    you: {
      label: 'Your move',
      bg: 'color-mix(in srgb, var(--hg-warning) 20%, transparent)',
      fg: 'var(--hg-warning)',
      border: 'color-mix(in srgb, var(--hg-warning) 50%, transparent)',
    },
    done: {
      label: 'Done',
      bg: 'color-mix(in srgb, var(--hg-success) 15%, transparent)',
      fg: 'var(--hg-success)',
      border: 'color-mix(in srgb, var(--hg-success) 50%, transparent)',
    },
    activity: {
      label: 'Activity',
      bg: 'var(--hg-surface-raised)',
      fg: 'var(--hg-text-muted)',
      border: 'var(--hg-line-strong)',
    },
  }
  const c = config[group]
  return (
    <span
      className="shrink-0 border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: c.bg, color: c.fg, borderColor: c.border }}
    >
      {c.label}
    </span>
  )
}
