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

export const StageFromApi = z.object({
  abbr: z.string(),
  name: z.string(),
  /** The Go side's own vocabulary, not a re-coded enum — one source for it. */
  state: z.string().default(''),
})

export const RepoFromApi = z.object({
  owner: z.string(),
  name: z.string(),
  url: z.string(),
  health: z.string(),
  stages: z.array(StageFromApi),
  gate: z.string(),
  open: z.number().int(),
  goodFirst: z.number().int(),
  unassigned: z.number().int(),
  watching: z.number().int(),
  turnedDown: z.number().int(),
  newCount: z.number().int(),
  /**
   * Whether the last-commit age is known at all. Same reasoning as KPI.known:
   * "committed today" and "we have not looked" are both 0, and showing the
   * second as the first is a quiet lie about how fresh a repository is.
   */
  ageKnown: z.boolean(),
  ageDays: z.number().int(),
  /** GitHub's complaint about this repository, when it would not answer. */
  error: z.string().optional(),
})
export type RepoFromApi = z.infer<typeof RepoFromApi>

export const DashboardApiDoc = z.object({
  /** RFC 3339, or empty when no poll has completed. Not the request time. */
  generatedAt: z.string(),
  version: z.string(),
  kpis: z.array(KpiFromApi),
  repos: z.array(RepoFromApi),
  stageHeads: z.array(StageFromApi),
  repoTotals: z.object({ newCount: z.number().int(), repoCount: z.number().int() }),
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

/**
 * Map an API repository onto the shape the table renders.
 *
 * The two differ because the table was built against a fixture before the
 * endpoint existed. Rather than reshape the component — which would churn a
 * 550-line file for no behavioural gain — the seam lives here, where it is one
 * function and visible.
 *
 * TWO THINGS ARE DELIBERATE.
 *
 * `lastCommit` is derived from `ageDays` back into an ISO instant, because the
 * table renders a relative age and the API sends days. When `ageKnown` is
 * false this returns an empty string rather than today's date — "we have not
 * looked" and "committed today" are both zero days, and the second is a claim
 * about freshness nobody has earned.
 *
 * An unrecognised stage state throws rather than defaulting. The vocabulary is
 * the Go side's and the schema already mirrors it, so a new state appearing
 * here means the server grew one and the UI has no treatment for it. Silently
 * painting it as "not started" would hide that; the error names it.
 */
export function toTrackedRepo(
  r: RepoFromApi,
  generatedAt: string,
): import('../fixtures/dashboard').TrackedRepo {
  const stageState = (s: string) => {
    if (s === 'done' || s === 'current' || s === 'failed' || s === 'todo') return s
    throw new Error(
      `the dashboard service sent an unknown stage state ${JSON.stringify(s)} — the UI has no treatment for it`,
    )
  }

  let lastCommit = ''
  if (r.ageKnown && generatedAt) {
    const base = new Date(generatedAt)
    if (!Number.isNaN(base.getTime())) {
      base.setUTCDate(base.getUTCDate() - r.ageDays)
      lastCommit = base.toISOString()
    }
  }

  return {
    owner: r.owner,
    name: r.name,
    health: (['ACTIVE', 'SLOWING', 'DORMANT', 'NOT_CHECKED'].includes(r.health)
      ? r.health
      : 'NOT_CHECKED') as import('../fixtures/dashboard').RepoHealth,
    lastCommit,
    openIssuesTotal: r.open,
    openIssuesGoodFirst: r.goodFirst,
    openIssuesUnassigned: r.unassigned,
    watching: r.watching,
    turnedDown: r.turnedDown,
    newCount: r.newCount,
    gate: (r.gate === 'PASS' || r.gate === 'FAIL' ? r.gate : 'NONE') as
      import('../fixtures/dashboard').GateResult,
    // The table renders a fixed seven-column strip. A repository outside the
    // pipeline sends no stages at all, which is a real state, not missing data.
    stages:
      r.stages.length === 7
        ? (r.stages.map((s) => stageState(s.state)) as import('../fixtures/dashboard').TrackedRepo['stages'])
        : (['todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo'] as import('../fixtures/dashboard').TrackedRepo['stages']),
  }
}
