import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { GitPullRequest, AlertTriangle, ExternalLink } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'

/**
 * The PR Pipeline page.
 *
 * THE LAYOUT IS THE FIX, and it is not mine. PR #222 reorganised this page
 * after the owner said of the old one: "there's a lot of numbers here that I'm
 * looking at and they do not seem like they're coherent numbers... all the
 * numbers on the top were like open and open twice for some reason". Eleven
 * figures sat as peers; several were subsets of Open, so they summed to
 * nothing, and "Opened" (lifetime) stood beside "Open" (right now) under
 * near-identical labels.
 *
 * The fix separated lifetime totals from what is open now, and demoted the
 * subsets — pending, approved, draft — to filters over the table, where a
 * subset reads as a subset because clicking it narrows the list.
 *
 * Porting this page faithfully therefore means porting that structure. A React
 * version built from a flat list of integers would reintroduce the exact
 * complaint in a new framework, which is the specific trap of converting a page
 * that has already been improved.
 */

const PullRequest = z.object({
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  opened: z.string(),
  reviewDecision: z.string(),
  checks: z.string(),
  conflict: z.boolean(),
  draft: z.boolean(),
  unresolvedThreads: z.number().int(),
  requested: z.boolean(),
  /* Derived on the server so filters and counts cannot disagree. */
  pending: z.boolean(),
  checksFailing: z.boolean(),
  approved: z.boolean(),
  /** Empty when the board has nothing to go on — not the same as "no activity". */
  lastActivity: z.string(),
})
type PullRequest = z.infer<typeof PullRequest>

const PipelineDoc = z.object({
  lifetime: z.object({
    opened: z.number().int(),
    merged: z.number().int(),
    closed: z.number().int(),
    rate: z.string(),
  }),
  openNow: z.object({
    open: z.number().int(),
    pending: z.number().int(),
    approved: z.number().int(),
    draft: z.number().int(),
  }),
  known: z.boolean(),
  error: z.string().optional(),
  pullRequests: z.array(PullRequest),
  repos: z.array(z.string()),
})

function usePipeline() {
  return useQuery({
    queryKey: ['pipeline'],
    queryFn: async () => {
      const res = await fetch('/app/api/pipeline.json', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`the pipeline service answered ${res.status}`)
      const parsed = PipelineDoc.safeParse(await res.json())
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

type Filter = 'all' | 'pending' | 'approved' | 'draft'

/** One lifetime total. Deliberately plainer than a filter chip — it is not clickable. */
function Total({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--hg-text-muted)' }}>{label}</span>
      <span
        className="font-mono text-[19px] font-bold tabular-nums leading-none"
        style={{ color: accent ? 'var(--hg-accent)' : 'var(--hg-text)' }}
      >
        {value}
      </span>
    </div>
  )
}

/** Relative age from an ISO instant, against a fixed "now" passed in. */
function ageFrom(iso: string, now: number): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const mins = Math.max(0, Math.round((now - t) / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function PipelinePage() {
  const q = usePipeline()
  const [filter, setFilter] = useState<Filter>('all')
  const [repo, setRepo] = useState<string>('')

  const d = q.data
  // One timestamp for the whole render, so two rows cannot disagree about now.
  const now = useMemo(() => Date.now(), [d])

  const rows = useMemo(() => {
    if (!d) return []
    return d.pullRequests.filter((pr) => {
      if (repo && pr.repo !== repo) return false
      switch (filter) {
        case 'pending':
          return pr.pending
        case 'approved':
          return pr.approved
        case 'draft':
          return pr.draft
        default:
          return true
      }
    })
  }, [d, filter, repo])

  return (
    <main className="min-w-0 overflow-x-hidden px-4 pb-24 pt-4">
      <h1 className="mb-3 text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>PR Pipeline</h1>

      {q.isError && (
        <div role="alert" className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}>
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{q.error.message}</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {/*
          LIFETIME. Its own panel, with its own heading, because the owner's
          "open twice" was this group's "Opened" standing beside the next
          group's "Open". Separating them is the whole point.
        */}
        <Panel>
          <PanelHeader title="Lifetime" />
          <div className="flex flex-wrap items-end gap-8 px-4 py-3">
            <Total label="Opened" value={d ? String(d.lifetime.opened) : '—'} />
            <Total label="Merged" value={d ? String(d.lifetime.merged) : '—'} />
            <Total label="Closed without merging" value={d ? String(d.lifetime.closed) : '—'} />
            <Total label="Merge rate" value={d?.lifetime.rate || '—'} accent />
          </div>
          <p className="border-t px-4 py-2 text-[11px] italic" style={{ borderColor: 'var(--hg-line)', color: 'var(--hg-text-muted)' }}>
            Rate is merged ÷ (merged + closed). Open ones don&rsquo;t count yet.
          </p>
        </Panel>

        <Panel>
          <PanelHeader
            icon={<GitPullRequest size={14} aria-hidden="true" />}
            title="Open now"
          >
            <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
              {rows.length === (d?.pullRequests.length ?? 0)
                ? `${rows.length} shown`
                : `${rows.length} of ${d?.pullRequests.length ?? 0} shown`}
            </span>
          </PanelHeader>

          {/*
            THE SUBSETS ARE FILTERS, NOT TOTALS. Each narrows the table below,
            which is what makes "a subset of Open" legible: you can see the list
            get shorter. Rendered as headline figures beside Open — which is
            what the page used to do — they read as siblings that ought to sum,
            and they never will, because one pull request can be open and
            pending and conflicted at once.
          */}
          <div
            role="group"
            aria-label="Filter open pull requests"
            className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
            style={{ borderColor: 'var(--hg-line)' }}
          >
            {([
              { id: 'all', label: 'All open', count: d?.openNow.open, title: 'Every open pull request' },
              { id: 'pending', label: 'Pending', count: d?.openNow.pending, title: 'Threads to answer, changes requested or checks failing' },
              { id: 'approved', label: 'Approved', count: d?.openNow.approved, title: 'Open and approved — ready to merge' },
              { id: 'draft', label: 'Draft', count: d?.openNow.draft, title: 'Open drafts, not yet ready for review' },
            ] as const).map((f) => {
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  title={f.title}
                  onClick={() => setFilter(f.id as Filter)}
                  className="flex items-center gap-1.5 border px-2.5 py-1 text-[11.5px] transition-colors"
                  style={{
                    background: active ? 'var(--hg-accent-fill)' : 'var(--hg-surface)',
                    borderColor: active ? 'var(--hg-accent-fill)' : 'var(--hg-line-strong)',
                    color: active ? 'var(--hg-accent-ink)' : 'var(--hg-text-muted)',
                  }}
                >
                  {f.label}
                  <span className="font-mono tabular-nums">{f.count ?? '—'}</span>
                </button>
              )
            })}

            {d && d.repos.length > 0 && (
              <label className="ml-auto flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                Repository
                <select
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  className="border px-2 py-1 text-[11.5px]"
                  style={{ background: 'var(--hg-surface-sunken)', borderColor: 'var(--hg-line)', color: 'var(--hg-text)' }}
                >
                  <option value="">All repositories</option>
                  {d.repos.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            )}
          </div>

          {d && d.pullRequests.length === 0 && (
            <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
              {d.known ? 'No pull requests in the pipeline.' : 'The pipeline has not run yet.'}
            </p>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <caption className="sr-only">Open pull requests, newest activity first</caption>
                <thead>
                  <tr style={{ color: 'var(--hg-text-muted)' }}>
                    <th scope="col" className="px-4 py-2 text-left font-medium">Pull request</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">State</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((pr) => (
                    <tr key={`${pr.repo}#${pr.number}`} className="border-t" style={{ borderColor: 'var(--hg-line)' }}>
                      <th scope="row" className="max-w-0 px-4 py-2 text-left font-normal">
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex items-center gap-1.5 no-underline hover:underline"
                          style={{ color: 'var(--hg-text)' }}
                        >
                          <span className="truncate">{pr.title}</span>
                          <ExternalLink size={11} aria-hidden="true" className="shrink-0 opacity-50" />
                        </a>
                        <span className="font-mono text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                          {pr.repo}#{pr.number}
                        </span>
                      </th>
                      <td className="px-3 py-2">
                        {/* Every state carries a word, never a colour alone. */}
                        <span className="flex flex-wrap gap-1.5">
                          {pr.draft && <Chip label="Draft" tone="muted" />}
                          {pr.approved && <Chip label="Approved" tone="success" />}
                          {pr.checksFailing && <Chip label="Checks failing" tone="danger" />}
                          {pr.conflict && <Chip label="Conflicts" tone="warning" />}
                          {pr.unresolvedThreads > 0 && <Chip label={`${pr.unresolvedThreads} thread${pr.unresolvedThreads === 1 ? '' : 's'}`} tone="warning" />}
                          {pr.requested && <Chip label="Review requested" tone="muted" />}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono tabular-nums"
                        style={{ color: 'var(--hg-text-muted)' }}
                        title={pr.lastActivity || 'The work board has nothing to go on for this one'}
                      >
                        {ageFrom(pr.lastActivity, now)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d && d.pullRequests.length > 0 && rows.length === 0 && (
            <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
              Nothing matches that filter.
            </p>
          )}
        </Panel>
      </div>
    </main>
  )
}

function Chip({ label, tone }: { label: string; tone: 'success' | 'danger' | 'warning' | 'muted' }) {
  const colour = {
    success: 'var(--hg-success)',
    danger: 'var(--hg-danger)',
    warning: 'var(--hg-warning)',
    muted: 'var(--hg-text-muted)',
  }[tone]
  return (
    <span className="whitespace-nowrap border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: colour, color: colour }}>
      {label}
    </span>
  )
}
