import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

/**
 * The live data layer: the first vertical slice on real Go data.
 *
 * ADR-UI-002 §7 Phase 3: "connect a single approved React dashboard vertical
 * slice to real, typed Go data with correct loading/empty/error states ...
 * Maintain a safe legacy path, feature flag or branch rollback until proven."
 *
 * The slice is the KPI rail. Everything else still renders from the fixture,
 * and the server says so in `partial` rather than leaving the client to guess.
 *
 * VALIDATED AT THE BOUNDARY, not trusted. The endpoint is ours and runs in the
 * same binary, which is exactly the situation where it is tempting to cast the
 * response and move on. The schema stays for two reasons: a Go struct change
 * that drops or renames a field would otherwise surface as `undefined` painted
 * into the UI rather than as an error anyone sees, and the parse is the only
 * thing that makes the TypeScript type a claim about runtime rather than a
 * decoration.
 */

export const KpiFromApi = z.object({
  id: z.enum(['needs', 'prs', 'repos', 'api']),
  value: z.number().int(),
  label: z.string(),
  sublabel: z.string(),
  /**
   * Whether the server actually knows this figure yet.
   *
   * This is the field that makes the difference between a real zero and an
   * absent one. The dashboard polls GitHub on an interval, so before the first
   * poll lands every count is unknown — and rendering unknown as `0` tells the
   * viewer nothing needs them, which is a lie with consequences. The Go side
   * has always modelled this; the UI has to carry it through.
   */
  known: z.boolean(),
})
export type KpiFromApi = z.infer<typeof KpiFromApi>

export const DashboardApiDoc = z.object({
  /** RFC 3339, or empty when no poll has completed. Not the request time. */
  generatedAt: z.string(),
  version: z.string(),
  kpis: z.array(KpiFromApi),
  /** True while sections beyond the KPI rail still come from fixtures. */
  partial: z.boolean(),
})
export type DashboardApiDoc = z.infer<typeof DashboardApiDoc>

export const DASHBOARD_QUERY_KEY = ['dashboard'] as const

async function fetchDashboard(signal?: AbortSignal): Promise<DashboardApiDoc> {
  const res = await fetch('/app/api/dashboard.json', {
    signal,
    headers: { accept: 'application/json' },
    // Same-origin and loopback-bound; no credentials cross the boundary.
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw new Error(`the dashboard service answered ${res.status}`)
  }
  const raw: unknown = await res.json()
  const parsed = DashboardApiDoc.safeParse(raw)
  if (!parsed.success) {
    // Naming the first bad path makes a contract drift debuggable in one read,
    // instead of hunting an undefined through the component tree.
    const issue = parsed.error.issues[0]
    throw new Error(
      `the dashboard service sent an unexpected shape: ${issue.path.join('.') || '(root)'} ${issue.message}`,
    )
  }
  return parsed.data
}

/**
 * The dashboard query.
 *
 * `refetchInterval` is deliberately not aggressive. The Go side polls GitHub on
 * its own schedule — an hour by default — so polling the local endpoint faster
 * than that only re-reads the same snapshot. Thirty seconds is enough that the
 * figures move shortly after a poll lands, and slow enough that an idle
 * dashboard is not doing work all day.
 */
export function useDashboard() {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: ({ signal }) => fetchDashboard(signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    // One retry, not three. This is a loopback service: if it is not answering,
    // it is down or the binary is being rebuilt, and three staggered retries
    // only delay the error state the user should already be seeing.
    retry: 1,
    staleTime: 10_000,
  })
}
