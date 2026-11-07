import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

/**
 * The live data layer: the first vertical slice on real Go data.
 *
 * ADR-UI-002 §7 Phase 3: "connect a single approved React dashboard vertical
 * slice to real, typed Go data with correct loading/empty/error states ...
 * Maintain a safe legacy path, feature flag or branch rollback until proven."
 *
 * That slice was the KPI rail; the rest followed in Phase 4, and every section
 * of this document is now live. The `partial` flag that marked the staging has
 * been removed — it stayed hardcoded `true` after the last section landed, so
 * it told the client the document was incomplete when it was not.
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
  /**
   * The program's own view: is this a pipeline target, and at which stage.
   *
   * Sent rather than derived from `stages`, because working out which state
   * word means "here" is a guess, and a wrong guess would show the wrong
   * stage rather than no stage — wrong in a way nothing on the page reveals.
   */
  /**
   * Whether this repository has ever been polled successfully.
   *
   * When false, `open`, `goodFirst` and `unassigned` are all zero because
   * nobody has looked — not because there is nothing there. Rendering those
   * as counts says "this repository needs nothing from you" about a
   * repository in exactly the state where that is unknowable.
   */
  polled: z.boolean(),
  inPipeline: z.boolean(),
  stage: z.string().optional(),
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

export const StageCountFromApi = z.object({
  abbr: z.string(),
  name: z.string(),
  count: z.number().int(),
})

export const PipelineFromApi = z.object({
  counts: z.array(StageCountFromApi),
  opened: z.number().int(),
  open: z.number().int(),
  merged: z.number().int(),
  closed: z.number().int(),
  /**
   * The server's own formatted string, not a ratio to format here.
   *
   * It is merged / (merged + closed), deliberately excluding open pull
   * requests, and the panel prints a note saying so. Sending the raw numbers
   * for the client to divide would put that definition in two places — and the
   * definition is the part that is easy to get subtly wrong.
   */
  rate: z.string(),
  known: z.boolean(),
  error: z.string().optional(),
})

export const WorkItemFromApi = z.object({
  key: z.string(),
  kind: z.string(),
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  why: z.string(),
  ago: z.string(),
  agoTitle: z.string(),
  level: z.string(),
  yourMove: z.boolean(),
  status: z.string(),
})

export const WorkFromApi = z.object({
  known: z.boolean(),
  /** The refresh failed halfway: new but incomplete, which is not "not yet". */
  partial: z.boolean(),
  login: z.string(),
  needYou: z.number().int(),
  total: z.number().int(),
  items: z.array(WorkItemFromApi),
  error: z.string().optional(),
})

export const ConversationsFromApi = z.object({
  known: z.boolean(),
  quiet: z.number().int(),
  needYou: z.number().int(),
  total: z.number().int(),
})

export const DashboardApiDoc = z.object({
  /** RFC 3339, or empty when no poll has completed. Not the request time. */
  generatedAt: z.string(),
  version: z.string(),
  kpis: z.array(KpiFromApi),
  repos: z.array(RepoFromApi),
  stageHeads: z.array(StageFromApi),
  repoTotals: z.object({ newCount: z.number().int(), repoCount: z.number().int() }),
  pipeline: PipelineFromApi,
  work: WorkFromApi,
  conversations: ConversationsFromApi,
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

/**
 * Adapters for the three rails.
 *
 * Each keeps the same discipline the repository adapter established: the
 * server's distinction between "nothing" and "not yet" is preserved rather
 * than flattened, and anything the server has not fetched is absent rather
 * than zero.
 */

export function toPipelineView(
  p: z.infer<typeof PipelineFromApi>,
  repoCount: number,
): import('../fixtures/dashboard').Pipeline & { known: boolean; rateText: string } {
  /*
    `rate` arrives as the server's formatted string because the definition —
    merged / (merged + closed), excluding open — lives there and should live in
    one place. The panel prints a number with a % sign, so a numeric field is
    kept for it, parsed from that string rather than recomputed from the parts.
    If the server ever says something non-numeric ("—", "n/a"), rateText is what
    the panel should show and the number falls to 0 rather than NaN.
  */
  const parsed = parseInt(p.rate.replace(/[^0-9-]/g, ''), 10)
  return {
    repoCount,
    byStage: p.counts.map((c) => ({ stage: c.abbr as never, count: c.count })),
    opened: p.opened,
    open: p.open,
    merged: p.merged,
    closed: p.closed,
    ratePercent: Number.isFinite(parsed) ? parsed : 0,
    rateText: p.rate,
    known: p.known,
    // The server does not send a "latest" pull request on this endpoint yet.
    // Empty rather than invented; the panel renders no link for it.
    latest: '',
  }
}

export function toWorkView(
  w: z.infer<typeof WorkFromApi>,
): import('../fixtures/dashboard').DashboardData['work'] & { known: boolean; partial: boolean } {
  return {
    known: w.known,
    partial: w.partial,
    needYou: w.needYou,
    // "new" is a feed concept this endpoint does not carry. 0 is honest here:
    // it is not a count the server has and withheld, it is one it does not model.
    newCount: 0,
    total: w.total,
    items: w.items.map((i) => ({
      id: i.key,
      title: i.title,
      repo: i.repo,
      number: i.number,
      updated: i.agoTitle || i.ago,
      yourMove: i.yourMove,
      note: i.level === 'caution' && i.status ? i.status : undefined,
      openedByYou: i.why.toLowerCase().includes('you opened'),
    })),
  }
}
