import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { CircleDot, AlertTriangle, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'

/**
 * The Issues page.
 *
 * NO NEW ENDPOINT. `/issues` has answered JSON all along when asked with
 * `Accept: application/json` — same handler, same pagination, same search. §4
 * says to add typed endpoints only "if the migration actually requires them",
 * and reading the handler rather than assuming showed that it does not.
 *
 * That is worth stating because the obvious move was to write
 * /app/api/issues.json beside it and end up with two code paths computing the
 * same page of results, drifting apart the first time one was changed.
 *
 * THIS PAGE HAS URL STATE, which the others did not: the page number and the
 * search live in the query string, so a link to page 4 is a link to page 4.
 * That is preserved — §7 Phase 4 requires deep links survive — by reading and
 * writing `location.search` directly. It is still not a router: there is one
 * view and two parameters.
 */

const Issue = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  repo: z.string(),
  ago: z.string(),
  agoTitle: z.string(),
  labels: z.array(z.string()).nullable().transform((v) => v ?? []),
  taken: z.string().optional(),
  watched: z.boolean(),
  k: z.string(),
  search: z.string(),
})

const IssuesDoc = z.object({
  issues: z.array(Issue).nullable().transform((v) => v ?? []),
  total: z.number().int(),
  page: z.number().int(),
  pages: z.number().int(),
  query: z.string(),
  canWatch: z.boolean(),
})

function useIssues(page: number, query: string) {
  return useQuery({
    queryKey: ['issues', page, query],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (page > 1) params.set('page', String(page))
      if (query) params.set('q', query)
      const res = await fetch(`/issues${params.toString() ? `?${params}` : ''}`, {
        headers: { accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`the issues service answered ${res.status}`)
      const parsed = IssuesDoc.safeParse(await res.json())
      if (!parsed.success) {
        const i = parsed.error.issues[0]
        throw new Error(`unexpected shape: ${i.path.join('.') || '(root)'} ${i.message}`)
      }
      return parsed.data
    },
    /*
      Keep the previous page on screen while the next one loads. Without this
      the list empties on every page change and the layout jumps — paging
      through a hundred issues becomes a flicker.
    */
    placeholderData: keepPreviousData,
    retry: 1,
  })
}

/**
 * THE PARAM IS `page`, NOT `pg`.
 *
 * `IssuePg` is the template's field name; serveIssues reads
 * `r.URL.Query().Get("page")`. Built with `pg` this page paged nowhere — the
 * URL changed, the fetch went out, and the server answered page 1 every time
 * with `pages: 126` still set, so "Page 1 of 126" stayed put and Next stayed
 * enabled. A dead button that looks alive.
 *
 * Using `page` also means the legacy page's own links — `/issues?page=4&q=…` —
 * still land where they point after the conversion.
 */
function readUrl() {
  if (typeof location === 'undefined') return { page: 1, query: '' }
  const p = new URLSearchParams(location.search)
  const page = Math.max(1, parseInt(p.get('page') ?? '1', 10) || 1)
  return { page, query: p.get('q') ?? '' }
}

export function IssuesPage() {
  const initial = readUrl()
  const [page, setPage] = useState(initial.page)
  const [query, setQuery] = useState(initial.query)
  const [draft, setDraft] = useState(initial.query)
  const q = useIssues(page, query)
  const d = q.data

  /*
    Keep the URL in step, with pushState so the back button walks the pages a
    reader actually visited. The page number is genuinely part of the address
    here — someone sends "the issue on page 3" — and losing that on conversion
    would be the deep-link regression §7 warns about.
  */
  useEffect(() => {
    if (typeof history === 'undefined') return
    const p = new URLSearchParams()
    if (page > 1) p.set('page', String(page))
    if (query) p.set('q', query)
    const next = p.toString() ? `/issues?${p}` : '/issues'
    if (location.pathname + location.search !== next) history.pushState({ page, query }, '', next)
  }, [page, query])

  // And follow the back button when it moves.
  useEffect(() => {
    const onPop = () => {
      const u = readUrl()
      setPage(u.page)
      setQuery(u.query)
      setDraft(u.query)
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  return (
    <main className="min-w-0 overflow-x-hidden px-4 pb-24 pt-4">
      <h1 className="mb-1 text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>Issues</h1>
      <p className="mb-3 text-[11.5px]" style={{ color: 'var(--hg-text-muted)' }}>
        Open issues across tracked repositories, newest first.
      </p>

      {q.isError && (
        <div role="alert" className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}>
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{q.error.message}</span>
        </div>
      )}

      <Panel>
        <PanelHeader icon={<CircleDot size={14} aria-hidden="true" />} title="Open issues">
          <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
            {d ? `${d.total.toLocaleString()} total` : '—'}
          </span>
        </PanelHeader>

        <form
          className="flex items-center gap-2 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--hg-line)' }}
          onSubmit={(e) => {
            e.preventDefault()
            // A new search starts at page one; keeping the old page number
            // would land the reader in the middle of a different result set.
            setPage(1)
            setQuery(draft.trim())
          }}
        >
          <label className="flex min-w-0 flex-1 items-center">
            <span className="sr-only">Search open issues</span>
            <input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search issues"
              className="w-full border px-3 py-1.5 text-[12px]"
              style={{ background: 'var(--hg-surface-sunken)', borderColor: 'var(--hg-line)', color: 'var(--hg-text)' }}
            />
          </label>
          <button
            type="submit"
            className="border px-3 py-1.5 text-[12px] font-medium"
            style={{ background: 'var(--hg-accent-fill)', borderColor: 'var(--hg-accent-fill)', color: 'var(--hg-accent-ink)' }}
          >
            Search
          </button>
          {query && (
            <button
              type="button"
              onClick={() => { setDraft(''); setQuery(''); setPage(1) }}
              className="border px-3 py-1.5 text-[12px]"
              style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text-muted)' }}
            >
              Clear
            </button>
          )}
        </form>

        {/*
          THREE EMPTY STATES, NOT ONE.

          A deep link to /issues?page=2&q=flaky answers zero rows — but the
          server also says total 61, pages 1. The query matched plenty; this
          page is simply past the end. Collapsing that into "nothing matches"
          tells the reader their search failed when it did not, and with the
          pager hidden (pages is 1) there was no way back but editing the URL.

          So the empty text is chosen from `total`, not from the row count.
        */}
        {d && d.issues.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            {d.total > 0 ? (
              <>
                <p>
                  Page {d.page} is past the end. {d.total.toLocaleString()}{' '}
                  {d.total === 1 ? 'issue matches' : 'issues match'}
                  {query ? ' this search' : ''}, on {d.pages === 1 ? 'one page' : `${d.pages} pages`}.
                </p>
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  className="mt-3 border px-3 py-1.5 text-[11.5px]"
                  style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text)' }}
                >
                  Back to the first page
                </button>
              </>
            ) : (
              <p>{query ? `Nothing open matches “${query}”.` : 'No open issues in tracked repositories.'}</p>
            )}
          </div>
        )}

        <ul aria-busy={q.isFetching}>
          {(d?.issues ?? []).map((issue) => (
            <li key={issue.k} className="border-b px-4 py-2 last:border-b-0" style={{ borderColor: 'var(--hg-line)' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1.5 text-[12.5px] no-underline hover:underline"
                    style={{ color: 'var(--hg-text)' }}
                  >
                    <span className="truncate">{issue.title}</span>
                    <ExternalLink size={11} aria-hidden="true" className="shrink-0 opacity-50" />
                  </a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                    <span className="font-mono">{issue.repo}#{issue.number}</span>
                    {issue.taken && (
                      // "Taken" means someone has claimed it — the single most
                      // useful thing to know before starting, so it is not
                      // buried among the labels.
                      <span style={{ color: 'var(--hg-warning)' }}>· {issue.taken}</span>
                    )}
                    {issue.labels.slice(0, 4).map((l) => (
                      <span key={l} className="border px-1 py-px text-[10px]" style={{ borderColor: 'var(--hg-line)' }}>{l}</span>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[11px] tabular-nums" style={{ color: 'var(--hg-text-muted)' }} title={issue.agoTitle}>
                  {issue.ago}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {d && (d.pages > 1 || d.page > d.pages) && (
          <nav
            aria-label="Issue pages"
            className="flex items-center justify-between gap-3 border-t px-4 py-2.5"
            style={{ borderColor: 'var(--hg-line)' }}
          >
            <button
              type="button"
              disabled={d.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex items-center gap-1 border px-2.5 py-1 text-[11.5px] disabled:opacity-40"
              style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text)' }}
            >
              <ChevronLeft size={12} aria-hidden="true" />
              Previous
            </button>
            <span className="font-mono text-[11.5px] tabular-nums" style={{ color: 'var(--hg-text-muted)' }}>
              Page {d.page} of {d.pages}
            </span>
            <button
              type="button"
              disabled={d.page >= d.pages}
              onClick={() => setPage((p) => p + 1)}
              className="flex items-center gap-1 border px-2.5 py-1 text-[11.5px] disabled:opacity-40"
              style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text)' }}
            >
              Next
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          </nav>
        )}
      </Panel>
    </main>
  )
}
