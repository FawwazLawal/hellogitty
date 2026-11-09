import { useMemo, useState } from 'react'
import { Flame, ExternalLink } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import type { RecentIssueFromApi } from '../data/recentIssues'

/**
 * Recent issues — up to 30 newest open issues across tracked repos.
 *
 * ADR-UI-002 §4: the rows come from the server's own JSON arm of /issues.
 * Search (client-side grep on the server-composed `search` blob) and the
 * repo filter (derived from the rows themselves) are view concerns, so
 * they live here. A server-side search endpoint already exists at
 * /issues?q=… for the full page; the panel does client-side because the
 * 30-row window is small and a search that round-trips would add a
 * latency step for what a client can answer immediately.
 *
 * "KNOWN" IS NOT A FIELD HERE. An empty list after a successful fetch is
 * a real answer — "no open issues in tracked repositories" — and the
 * panel says so. Loading state is handled by the caller (via React
 * Query's `isPending`), not by a flag on the row payload: that is the
 * "unknown is not zero" rule applied to collections.
 */

export function RecentIssuesPanel({
  rows,
  total,
}: {
  rows: readonly RecentIssueFromApi[]
  total: number
}) {
  const [query, setQuery] = useState('')
  const [repo, setRepo] = useState('')

  // The repo dropdown is driven by the rows themselves — the templated
  // page did the same, and this way a filter that cannot match anything
  // never appears in the list.
  const repos = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) set.add(r.repo)
    return [...set].sort()
  }, [rows])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (repo && r.repo !== repo) return false
        if (q && !r.search.includes(q)) return false
        return true
      }),
    [rows, repo, q],
  )

  // Panel slice = first 30. The server returns up to 100 for the full
  // page; this panel shows the top of that window.
  const display = filtered.slice(0, 30)

  return (
    <Panel>
      <PanelHeader icon={<Flame size={14} aria-hidden="true" />} title="Recent issues">
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          {total} newest ·{' '}
          <a
            href="/issues"
            className="underline decoration-dotted underline-offset-2"
            style={{ color: 'var(--hg-text)' }}
          >
            Show all
          </a>
        </span>
      </PanelHeader>

      <div className="px-4 py-3">
        {rows.length > 0 ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              <input
                type="search"
                aria-label="Search recent issues"
                placeholder="Search issues…"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 border px-2 py-1 text-[12px]"
                style={{
                  borderColor: 'var(--hg-line)',
                  background: 'var(--hg-surface-sunken)',
                  color: 'var(--hg-text)',
                }}
              />
              <select
                aria-label="Filter by repository"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="border px-2 py-1 text-[12px]"
                style={{
                  borderColor: 'var(--hg-line)',
                  background: 'var(--hg-surface-sunken)',
                  color: 'var(--hg-text)',
                }}
              >
                <option value="">All repos</option>
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {display.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
                No issues match.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {display.map((i) => (
                  <li key={i.k} className="flex flex-col gap-0.5">
                    <div className="flex items-start gap-2 text-[12px]">
                      <span
                        className="shrink-0"
                        style={{ color: 'var(--hg-text-muted)' }}
                      >
                        {i.repo}#{i.number}
                      </span>
                      <a
                        href={i.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={i.title}
                        className="flex min-w-0 flex-1 items-start gap-1 underline decoration-dotted underline-offset-2"
                        style={{ color: 'var(--hg-text)' }}
                      >
                        <span className="truncate">{i.title}</span>
                        <ExternalLink size={10} aria-hidden="true" className="mt-0.5 shrink-0" />
                      </a>
                      {i.taken && (
                        <span
                          className="shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                          style={{
                            background: 'var(--hg-surface-raised)',
                            color: 'var(--hg-text-muted)',
                          }}
                          title={`This issue is ${i.taken}.`}
                        >
                          {i.taken}
                        </span>
                      )}
                    </div>
                    {i.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {i.labels.map((l) => (
                          <span
                            key={l}
                            className="px-1 py-0.5 text-[10px]"
                            style={{
                              background: 'var(--hg-surface-raised)',
                              color: 'var(--hg-text-muted)',
                            }}
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            <span style={{ color: 'var(--hg-text)', fontWeight: 600 }}>No open issues </span>
            in tracked repositories.
          </p>
        )}
      </div>
    </Panel>
  )
}
