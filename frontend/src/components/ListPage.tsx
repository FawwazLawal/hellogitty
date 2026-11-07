import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { List as ListIcon, AlertTriangle, ExternalLink } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import { useDashboard } from '../data/dashboard'

/**
 * The /list page: what a Pipeline number counts, opened on a page of its own.
 *
 * TWO MODES, ONE URL. `/list?prs=<kind>` shows the PRs in that state; the
 * `kind` is one of `opened | open | merged | closed | decided`.
 * `/list?stage=<name>` shows the repositories at that pipeline stage. Both
 * jump-link tables appear at the top in either mode, so the reader can walk
 * sideways between counts. The templated page 404'd on a bare `/list`; this
 * one does too, visually — a one-line "pick a count above" prompt and the
 * jump links, instead of an empty page.
 *
 * NO NEW ENDPOINT. `/app/api/dashboard.json` already carries the stage counts
 * (`pipeline.counts`), the PR totals (`pipeline.opened/open/merged/closed`),
 * each one's `pipeline.known` flag, and every tracked repository's
 * `inPipeline` + `stage` + health + counts. Only the per-PR list is missing,
 * and `/app/api/pipeline.json` has that — the /pipeline page reads it already.
 * So the two existing projections cover everything; a new /list endpoint
 * would be a third computation of numbers the other two already serve.
 *
 * THE PARAM IS `prs`, NOT `pr`. `serveList` in `internal/dashboard/list.go`
 * reads `r.URL.Query().Get("prs")` (plural) and `.Get("stage")`. Guessing
 * `?pr=open` would page-of-nothing while every count on screen looked
 * correct, which is the shape of defect `IssuesPage.tsx` already documented
 * for `page` vs `pg`.
 *
 * UNKNOWN IS NOT ZERO. When `pipeline.known` is false the jump-link counts
 * render as "—", because the pipeline has not been polled yet — the templated
 * page printed zeros. Individual repositories still carry their own `polled`
 * flag in the stage-mode table, same discipline as `/repos`.
 *
 * URL STATE. `location.search` is the source of truth; `popstate` rewires it
 * when the back button walks between `?prs=open` and `?prs=merged`. This
 * preserves the deep links Phase 4 §7 requires, including the ones the
 * templated /your-repos tiles point at.
 */

const PullRequest = z.object({
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  opened: z.string(),
})

const PipelineListDoc = z.object({
  pullRequests: z.array(PullRequest),
  known: z.boolean(),
})

function usePipelinePRs(enabled: boolean) {
  return useQuery({
    queryKey: ['pipeline-prs-for-list'],
    queryFn: async () => {
      const res = await fetch('/app/api/pipeline.json', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`the pipeline service answered ${res.status}`)
      // Parse only the fields this page reads — if /pipeline grows new
      // ones the list page shouldn't care, and a safeParse against the full
      // PipelineDoc here would couple the two pages for no reason.
      const parsed = PipelineListDoc.safeParse(await res.json())
      if (!parsed.success) {
        const i = parsed.error.issues[0]
        throw new Error(`unexpected shape: ${i.path.join('.') || '(root)'} ${i.message}`)
      }
      return parsed.data
    },
    enabled,
    refetchInterval: 60_000,
    retry: 1,
  })
}

type Mode = { kind: 'prs'; value: PrKind } | { kind: 'stage'; value: string } | { kind: 'none' }
type PrKind = 'opened' | 'open' | 'merged' | 'closed' | 'decided'
const PR_KINDS: PrKind[] = ['opened', 'open', 'merged', 'closed', 'decided']
const PR_TITLE: Record<PrKind, string> = {
  opened: 'Pull requests you opened',
  open: 'Your open pull requests',
  merged: 'Your merged pull requests',
  closed: 'Your pull requests closed without merging',
  decided: 'Your merged and closed pull requests',
}
const PR_LABEL: Record<PrKind, string> = {
  opened: 'Opened',
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
  decided: 'Decided',
}

function readMode(): Mode {
  if (typeof location === 'undefined') return { kind: 'none' }
  const p = new URLSearchParams(location.search)
  const prs = p.get('prs')
  if (prs && (PR_KINDS as string[]).includes(prs)) return { kind: 'prs', value: prs as PrKind }
  const stage = p.get('stage')
  if (stage) return { kind: 'stage', value: stage }
  return { kind: 'none' }
}

function modeHref(mode: Mode): string {
  if (mode.kind === 'none') return '/list'
  const p = new URLSearchParams()
  p.set(mode.kind === 'prs' ? 'prs' : 'stage', mode.value)
  return `/list?${p}`
}

function prMatches(state: string, kind: PrKind): boolean {
  switch (kind) {
    case 'opened':
      return true
    case 'open':
      return state === 'Open'
    case 'merged':
      return state === 'Merged'
    case 'closed':
      return state === 'Closed'
    case 'decided':
      return state === 'Merged' || state === 'Closed'
  }
}

export function ListPage() {
  const [mode, setMode] = useState<Mode>(readMode)
  const dashboard = useDashboard()
  const pipeline = usePipelinePRs(mode.kind === 'prs')

  // Walk the back button.
  useEffect(() => {
    const onPop = () => setMode(readMode())
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  // Keep the URL in step when a jump link is used in-app.
  useEffect(() => {
    if (typeof history === 'undefined') return
    const next = modeHref(mode)
    if (location.pathname + location.search !== next) history.pushState({ mode }, '', next)
  }, [mode])

  const d = dashboard.data
  const pipelineKnown = d?.pipeline.known ?? false
  const stageCounts = d?.pipeline.counts ?? []
  const prTotals: Record<PrKind, number> = useMemo(() => {
    // `opened` is the all-time count on the dashboard (lifetime); the others
    // are the open/merged/closed scalars. `decided` is merged + closed — the
    // page shows four cards plus a derived fifth so a reader can see the
    // whole decided pile without doing the sum themselves.
    const p = d?.pipeline
    return {
      opened: p?.opened ?? 0,
      open: p?.open ?? 0,
      merged: p?.merged ?? 0,
      closed: p?.closed ?? 0,
      decided: (p?.merged ?? 0) + (p?.closed ?? 0),
    }
  }, [d])

  const activePrKind = mode.kind === 'prs' ? mode.value : undefined
  const activeStage = mode.kind === 'stage' ? mode.value : undefined

  const prRows = useMemo(() => {
    if (mode.kind !== 'prs' || !pipeline.data) return []
    return pipeline.data.pullRequests.filter((pr) => prMatches(pr.state, mode.value))
  }, [mode, pipeline.data])

  const stageIsKnown = activeStage ? stageCounts.some((c) => c.name === activeStage) : false
  const repoRows = useMemo(() => {
    if (mode.kind !== 'stage' || !d) return []
    return d.repos.filter((r) => r.inPipeline && r.stage === mode.value)
  }, [mode, d])

  const title =
    mode.kind === 'prs'
      ? PR_TITLE[mode.value]
      : mode.kind === 'stage'
      ? stageIsKnown
        ? `Repositories at ${mode.value}`
        : null
      : 'Lists'
  const sub =
    mode.kind === 'prs'
      ? 'In tracked repositories, newest first.'
      : mode.kind === 'stage'
      ? 'Where your pipeline command says each repository is now.'
      : 'Pick a count below to see what it counts.'

  return (
    <main className="min-w-0 overflow-x-hidden px-4 pb-24 pt-4">
      <h1 className="mb-1 text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>
        {title ?? 'Unknown stage'}
      </h1>
      <p className="mb-3 text-[11.5px]" style={{ color: 'var(--hg-text-muted)' }}>
        {sub}
      </p>

      {dashboard.isError && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{dashboard.error.message}</span>
        </div>
      )}

      {/*
        Jump links — stage counts and PR counts, side by side. Count renders
        as an em-dash when `pipeline.known` is false, same discipline as the
        /your-repos overview tiles. A reader on a cold start sees "no idea
        yet" instead of "zero", which is the whole point.
      */}
      <nav aria-label="Other lists" className="mb-5 flex flex-wrap gap-1.5">
        {stageCounts.map((c) => (
          <JumpLink
            key={`stage-${c.name}`}
            href={`/list?stage=${encodeURIComponent(c.name)}`}
            label={`${c.abbr} · ${c.name}`}
            count={c.count}
            known={pipelineKnown}
            current={activeStage === c.name}
            onClick={() => setMode({ kind: 'stage', value: c.name })}
          />
        ))}
        {PR_KINDS.map((k) => (
          <JumpLink
            key={`prs-${k}`}
            href={`/list?prs=${k}`}
            label={PR_LABEL[k]}
            count={prTotals[k]}
            known={pipelineKnown}
            current={activePrKind === k}
            onClick={() => setMode({ kind: 'prs', value: k })}
          />
        ))}
      </nav>

      {mode.kind === 'stage' && !stageIsKnown && dashboard.isSuccess && (
        <Panel>
          <PanelHeader icon={<ListIcon size={14} aria-hidden="true" />} title="Not a stage">
            <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
              —
            </span>
          </PanelHeader>
          <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            The pipeline does not report a stage called "{mode.value}". Pick one above.
          </p>
        </Panel>
      )}

      {mode.kind === 'prs' && <PrTable rows={prRows} known={pipeline.data?.known ?? pipelineKnown} loading={pipeline.isPending} error={pipeline.error?.message} />}

      {mode.kind === 'stage' && stageIsKnown && (
        <RepoTable rows={repoRows} dashboardKnown={dashboard.isSuccess} />
      )}

      {mode.kind === 'none' && (
        <Panel>
          <PanelHeader icon={<ListIcon size={14} aria-hidden="true" />} title="Pick a count" />
          <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            Pick a count above to see what it counts.
          </p>
        </Panel>
      )}
    </main>
  )
}

function JumpLink({
  href,
  label,
  count,
  known,
  current,
  onClick,
}: {
  href: string
  label: string
  count: number
  known: boolean
  current: boolean
  onClick: () => void
}) {
  // Rendered as an anchor so the link behaviours — middle-click, open-in-
  // new-tab, copy — all work. `onClick` updates the view in-app without a
  // full reload; preventDefault keeps the browser from navigating.
  return (
    <a
      href={href}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        onClick()
      }}
      className="inline-flex items-baseline gap-1.5 border px-2.5 py-1 text-[12px] no-underline transition-colors"
      style={{
        borderColor: current ? 'var(--hg-text)' : 'var(--hg-line-strong)',
        color: current ? 'var(--hg-text)' : 'var(--hg-text-muted)',
        fontWeight: current ? 600 : 400,
      }}
    >
      {label}
      <span className="font-mono tabular-nums" style={{ color: 'var(--hg-text)' }}>
        {known ? count : '—'}
      </span>
    </a>
  )
}

function PrTable({
  rows,
  known,
  loading,
  error,
}: {
  rows: { repo: string; number: number; title: string; url: string; state: string; opened: string }[]
  known: boolean
  loading: boolean
  error?: string
}) {
  return (
    <Panel>
      <PanelHeader icon={<ListIcon size={14} aria-hidden="true" />} title="Pull requests">
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          {known ? `${rows.length}` : '—'}
        </span>
      </PanelHeader>
      {error && (
        <p
          role="alert"
          className="border-b px-4 py-2 text-[12px]"
          style={{ borderColor: 'var(--hg-line)', color: 'var(--hg-danger)' }}
        >
          {error}
        </p>
      )}
      {loading && (
        <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
          Loading…
        </p>
      )}
      {!loading && !known && !error && (
        <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
          The pipeline has not been fetched yet.
        </p>
      )}
      {!loading && known && rows.length === 0 && (
        <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
          None yet.
        </p>
      )}
      <ul>
        {rows.map((pr) => (
          <li
            key={`${pr.repo}#${pr.number}`}
            className="border-b px-4 py-2.5 last:border-b-0"
            style={{ borderColor: 'var(--hg-line)' }}
          >
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <StateTag state={pr.state} />
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex min-w-0 items-center gap-1.5 text-[12.5px] no-underline hover:underline"
                    style={{ color: 'var(--hg-text)' }}
                  >
                    <span className="truncate">{pr.title}</span>
                    <ExternalLink size={11} aria-hidden="true" className="shrink-0 opacity-50" />
                  </a>
                </div>
                <div className="mt-0.5 text-[11px] font-mono" style={{ color: 'var(--hg-text-muted)' }}>
                  {pr.repo}#{pr.number}
                </div>
              </div>
              <span
                className="shrink-0 font-mono text-[11px] tabular-nums"
                style={{ color: 'var(--hg-text-muted)' }}
              >
                {pr.opened || '—'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function StateTag({ state }: { state: string }) {
  // Not colour alone — the text carries the meaning. Colour is a hint.
  const tone: Record<string, { fg: string; border: string }> = {
    Merged: {
      fg: 'var(--hg-success)',
      border: 'color-mix(in srgb, var(--hg-success) 50%, transparent)',
    },
    Closed: {
      fg: 'var(--hg-warning)',
      border: 'color-mix(in srgb, var(--hg-warning) 50%, transparent)',
    },
    Open: {
      fg: 'var(--hg-text)',
      border: 'var(--hg-line-strong)',
    },
    Draft: {
      fg: 'var(--hg-text-muted)',
      border: 'var(--hg-line-strong)',
    },
  }
  const t = tone[state] ?? { fg: 'var(--hg-text-muted)', border: 'var(--hg-line-strong)' }
  return (
    <span
      className="shrink-0 border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: t.fg, borderColor: t.border }}
    >
      {state}
    </span>
  )
}

function RepoTable({
  rows,
  dashboardKnown,
}: {
  rows: Array<{
    owner: string
    name: string
    url: string
    health: string
    polled: boolean
    open: number
    goodFirst: number
    turnedDown: number
    ageKnown: boolean
    ageDays: number
    stage?: string
  }>
  dashboardKnown: boolean
}) {
  return (
    <Panel>
      <PanelHeader icon={<ListIcon size={14} aria-hidden="true" />} title="Repositories">
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          {dashboardKnown ? `${rows.length}` : '—'}
        </span>
      </PanelHeader>
      {dashboardKnown && rows.length === 0 && (
        <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
          No repository is at this stage.
        </p>
      )}
      <ul>
        {rows.map((r) => (
          <li
            key={`${r.owner}/${r.name}`}
            className="border-b px-4 py-2.5 last:border-b-0"
            style={{ borderColor: 'var(--hg-line)' }}
          >
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <HealthDot health={r.health} />
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex min-w-0 items-center gap-1.5 text-[12.5px] no-underline hover:underline"
                    style={{ color: 'var(--hg-text)' }}
                  >
                    <span className="truncate">
                      <span style={{ color: 'var(--hg-text-muted)', fontWeight: 400 }}>{r.owner}/</span>
                      {r.name}
                    </span>
                    <ExternalLink size={11} aria-hidden="true" className="shrink-0 opacity-50" />
                  </a>
                </div>
                <div
                  className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums"
                  style={{ color: 'var(--hg-text-muted)' }}
                >
                  {/*
                    An unpolled repository has no counts, not three zeros. Same
                    discipline as /repos: the counts render as em dashes and
                    the row still links out to the GitHub search behind them.
                  */}
                  <span>Open: {r.polled ? r.open : '—'}</span>
                  <span>Good first: {r.polled ? r.goodFirst : '—'}</span>
                  <span>Last commit: {r.ageKnown ? `${r.ageDays}d` : '—'}</span>
                  {r.turnedDown > 0 && <span>Turned down: {r.turnedDown}</span>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function HealthDot({ health }: { health: string }) {
  const common = 'inline-block h-[10px] w-[10px] shrink-0 rounded-full'
  const h = health || 'UNKNOWN'
  if (h === 'UNKNOWN') {
    return (
      <span
        className={common}
        aria-hidden="true"
        style={{ border: '1.5px dashed var(--hg-text-muted)' }}
      />
    )
  }
  const fill =
    h === 'ACTIVE' ? 'var(--hg-success)' : h === 'DORMANT' ? 'var(--hg-warning)' : 'transparent'
  const ring = h === 'SLOW' ? '2px solid var(--hg-warning)' : undefined
  return <span className={common} aria-hidden="true" style={{ background: fill, border: ring }} />
}
