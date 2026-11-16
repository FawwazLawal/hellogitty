import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

/**
 * The Recent Issues panel's data layer.
 *
 * Reuses the `/issues?accept=application/json` arm the IssuesPage already
 * consumes (see `internal/dashboard/issues.go`) rather than adding another
 * projection to `dashboard.json`. The panel shows the first 30 of the
 * server's 90-day open-issue slice; search and repo filter are client-side
 * in the panel, the server returns the same payload for both.
 */

export const RecentIssueFromApi = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  repo: z.string(),
  ago: z.string(),
  agoTitle: z.string(),
  labels: z.array(z.string()),
  /** "assigned" / "claimed" / "" — the server's own vocabulary, not translated. */
  taken: z.string().optional().default(''),
  watched: z.boolean(),
  k: z.string(),
  /** A pre-lowercased search blob the client greps. Composed by the server
   *  so the two agree on what is matchable. */
  search: z.string(),
})
export type RecentIssueFromApi = z.infer<typeof RecentIssueFromApi>

export const RecentIssuesDoc = z.object({
  issues: z.array(RecentIssueFromApi),
  total: z.number().int(),
  page: z.number().int(),
  pages: z.number().int(),
  query: z.string().optional().default(''),
  canWatch: z.boolean().optional().default(false),
})
export type RecentIssuesDoc = z.infer<typeof RecentIssuesDoc>

async function getIssues(signal?: AbortSignal): Promise<RecentIssuesDoc> {
  const res = await fetch('/issues?page=1', {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error(`/issues answered ${res.status}`)
  const parsed = RecentIssuesDoc.safeParse(await res.json())
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`/issues sent an unexpected shape: ${issue.path.join('.') || '(root)'} ${issue.message}`)
  }
  return parsed.data
}

export function useRecentIssues() {
  return useQuery({
    queryKey: ['recent-issues'],
    queryFn: ({ signal }) => getIssues(signal),
    // Issues change on the same cadence as the dashboard poll; a one-minute
    // refetch matches that without piling on when the tab is idle.
    refetchInterval: 60_000,
    retry: 1,
  })
}
