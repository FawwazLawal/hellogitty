import { z } from 'zod'

/**
 * The data contract for the prototype, and the fixture that satisfies it.
 *
 * ADR-UI-002 §7, Phase 1: "Use fixture data." Phase 3 is where real typed Go
 * data arrives. The point of writing the schema now rather than later is that
 * the fixture then cannot drift into a shape the backend could never produce —
 * the field names and types below are taken from the live `snapshot.json` and
 * from the handlers that render the existing templates, not invented to suit a
 * component.
 *
 * Where the prototype needs something the snapshot does not currently carry —
 * per-stage pipeline counts, for instance, which the Go side computes at render
 * time rather than storing — it is marked below, because that is exactly the
 * list Phase 3 will have to turn into typed endpoints.
 */

/** Straight from the snapshot: `health` is this closed set. */
export const RepoHealth = z.enum(['ACTIVE', 'SLOWING', 'DORMANT', 'NOT_CHECKED'])
export type RepoHealth = z.infer<typeof RepoHealth>

/** The seven pipeline stages, in the order the render shows them. */
export const STAGES = ['RCN', 'GTE', 'SEL', 'BLD', 'REV', 'PR', 'RSP'] as const
export type Stage = (typeof STAGES)[number]

/** A stage chip is filled, empty, or the one currently in progress. */
export const StageState = z.enum(['done', 'current', 'empty', 'failed'])
export type StageState = z.infer<typeof StageState>

export const GateResult = z.enum(['PASS', 'FAIL', 'NONE'])
export type GateResult = z.infer<typeof GateResult>

export const TrackedRepo = z.object({
  owner: z.string(),
  name: z.string(),
  health: RepoHealth,
  /** ISO 8601, as the snapshot stores it. The UI renders it relative. */
  lastCommit: z.string(),
  openIssuesTotal: z.number().int().nonnegative(),
  openIssuesGoodFirst: z.number().int().nonnegative(),
  openIssuesUnassigned: z.number().int().nonnegative(),
  watching: z.number().int().nonnegative(),
  turnedDown: z.number().int().nonnegative(),
  /** NOT in today's snapshot — Phase 3 must expose this. */
  stages: z.array(StageState).length(STAGES.length),
  /** NOT in today's snapshot — Phase 3 must expose this. */
  gate: GateResult,
  /** NOT in today's snapshot — derived from the feed in the Go templates. */
  newCount: z.number().int().nonnegative(),
})
export type TrackedRepo = z.infer<typeof TrackedRepo>

export const KpiTile = z.object({
  id: z.enum(['needs', 'prs', 'repos', 'api']),
  value: z.number().int(),
  label: z.string(),
  sublabel: z.string(),
  /** Which token the numeral paints in; `accent` is the one warm mark. */
  tone: z.enum(['accent', 'ink', 'success']),
})
export type KpiTile = z.infer<typeof KpiTile>

export const PipelineStageCount = z.object({ stage: z.enum(STAGES), count: z.number().int().nonnegative() })

export const Pipeline = z.object({
  repoCount: z.number().int().nonnegative(),
  byStage: z.array(PipelineStageCount).length(STAGES.length),
  opened: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  /** merged / (merged + closed), as a percentage. Open ones do not count yet. */
  ratePercent: z.number().int().min(0).max(100),
  latest: z.string(),
})
export type Pipeline = z.infer<typeof Pipeline>

export const WorkItem = z.object({
  id: z.string(),
  title: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  updated: z.string(),
  yourMove: z.boolean(),
  note: z.string().optional(),
  openedByYou: z.boolean(),
})
export type WorkItem = z.infer<typeof WorkItem>

export const DashboardData = z.object({
  generatedAt: z.string(),
  user: z.string(),
  version: z.string(),
  codename: z.string(),
  kpis: z.array(KpiTile).length(4),
  repos: z.array(TrackedRepo),
  repoTotals: z.object({ newCount: z.number().int(), repoCount: z.number().int() }),
  pipeline: Pipeline,
  work: z.object({ needYou: z.number().int(), newCount: z.number().int(), total: z.number().int(), items: z.array(WorkItem) }),
  conversations: z.object({ quiet: z.number().int(), total: z.number().int() }),
})
export type DashboardData = z.infer<typeof DashboardData>

/**
 * The fixture. Numbers are the founder's own reference render, so a side-by-side
 * against `01-VERMILION-DARK.png` compares like with like: 11 needing you, 17
 * open PRs, 80 repos, 4755 API calls left, 149 new across 19 repos.
 *
 * Timestamps are fixed, not relative to now. A fixture that drifts makes a
 * screenshot gate fail for reasons that are not regressions, which is the
 * failure mode that nearly got the Go side's visual gate switched off.
 */
export const FIXTURE: DashboardData = {
  generatedAt: '2026-11-06T19:04:05Z',
  user: 'FawwazLawal',
  version: 'v0.2.0 (41)',
  codename: 'Black Bombay',
  kpis: [
    { id: 'needs', value: 11, label: 'Needs you', sublabel: '', tone: 'accent' },
    { id: 'prs', value: 17, label: 'Open PRs', sublabel: 'non-draft, state OPEN', tone: 'accent' },
    { id: 'repos', value: 80, label: 'Repos', sublabel: '70 in pipeline', tone: 'accent' },
    { id: 'api', value: 4755, label: 'API left', sublabel: 'of 5000 this hour', tone: 'accent' },
  ],
  repos: [
    { owner: 'openai', name: 'codex', health: 'ACTIVE', lastCommit: '2026-11-06T18:44:00Z', openIssuesTotal: 26591, openIssuesGoodFirst: 0, openIssuesUnassigned: 26531, watching: 0, turnedDown: 3, stages: ['current', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'], gate: 'PASS', newCount: 55 },
    { owner: 'flutter', name: 'flutter', health: 'ACTIVE', lastCommit: '2026-11-06T18:40:00Z', openIssuesTotal: 12763, openIssuesGoodFirst: 0, openIssuesUnassigned: 12176, watching: 0, turnedDown: 366, stages: ['current', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'], gate: 'NONE', newCount: 8 },
    { owner: 'pytorch', name: 'pytorch', health: 'ACTIVE', lastCommit: '2026-11-06T18:30:00Z', openIssuesTotal: 14227, openIssuesGoodFirst: 41, openIssuesUnassigned: 12163, watching: 0, turnedDown: 842, stages: ['current', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'], gate: 'NONE', newCount: 19 },
    { owner: 'golang', name: 'go', health: 'ACTIVE', lastCommit: '2026-11-06T18:10:00Z', openIssuesTotal: 9282, openIssuesGoodFirst: 0, openIssuesUnassigned: 8290, watching: 0, turnedDown: 118, stages: ['done', 'done', 'done', 'done', 'done', 'done', 'current'], gate: 'PASS', newCount: 6 },
    { owner: 'MISP', name: 'MISP', health: 'ACTIVE', lastCommit: '2026-11-01T09:00:00Z', openIssuesTotal: 2709, openIssuesGoodFirst: 17, openIssuesUnassigned: 2429, watching: 0, turnedDown: 15, stages: ['done', 'done', 'done', 'done', 'done', 'done', 'current'], gate: 'PASS', newCount: 0 },
  ],
  repoTotals: { newCount: 149, repoCount: 19 },
  pipeline: {
    repoCount: 70,
    byStage: [
      { stage: 'RCN', count: 20 },
      { stage: 'GTE', count: 17 },
      { stage: 'SEL', count: 1 },
      { stage: 'BLD', count: 14 },
      { stage: 'REV', count: 3 },
      { stage: 'PR', count: 3 },
      { stage: 'RSP', count: 12 },
    ],
    opened: 24,
    open: 17,
    merged: 4,
    closed: 3,
    ratePercent: 57,
    latest: 'OpenCTI-Platform/opencti#19663',
  },
  work: {
    needYou: 11,
    newCount: 1,
    total: 38,
    items: [
      {
        id: 'w1',
        title: 'fix: guard against duplicate-id responses in WebSocket handler',
        repo: 'XRPLF/xrpl-py',
        number: 1070,
        updated: '2026-10-28T07:14:00Z',
        yourMove: true,
        note: 'Branch is behind main',
        openedByYou: true,
      },
    ],
  },
  conversations: { quiet: 14, total: 14 },
}

/** Parsing the fixture at module load means a malformed fixture fails loudly. */
export const DASHBOARD: DashboardData = DashboardData.parse(FIXTURE)
