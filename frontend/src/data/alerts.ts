import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

/**
 * The alert pages' data layer.
 *
 * ONE document, ten pages. §4 of the ADR asks for "minimal typed endpoints if
 * the migration actually requires them", and the inventory of /alerts/*
 * showed the data is one `h.build()` snapshot read ten different ways — so
 * one endpoint lets a user walking from alert to alert re-use the same
 * fetch, and keeps the per-section `known` flag in one place instead of ten.
 *
 * `known` is per subsystem — watch, pipeline, poll, API — because those are
 * four independent fetches that can fail independently. A user whose watch
 * feed has never run should see "not fetched" on /alerts/watched-claimed
 * and "all quiet" on /alerts/api-low on the same reload. The schema below
 * is what lets the pages honour that distinction.
 */

const AlertNote = z.object({
  text: z.string(),
  level: z.string().optional(),
})

const AlertItem = z.object({
  kind: z.string(),
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  why: z.string().optional(),
  status: z.string().optional(),
  level: z.string().optional(),
  ago: z.string().optional(),
  agoTitle: z.string().optional(),
  notes: z.array(AlertNote),
  quote: z.string().optional(),
  quoteBy: z.string().optional(),
})

const AlertWork = z.object({
  known: z.boolean(),
  partial: z.boolean(),
  yourMove: z.number().int(),
  you: z.array(AlertItem),
  inYou: z.array(AlertItem),
  convYou: z.array(AlertItem),
})

const WatchItem = z.object({
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  status: z.string().optional(),
  claimDetail: z.string().optional(),
  changedAt: z.string().optional(),
})

const AlertWatch = z.object({
  known: z.boolean(),
  total: z.number().int(),
  claimed: z.array(WatchItem),
  closed: z.array(WatchItem),
})

const AlertFailedRepo = z.object({
  name: z.string(),
  error: z.string(),
})

const AlertChecks = z.object({
  known: z.boolean(),
  failed: z.array(AlertFailedRepo),
})

const HealthItem = z.object({
  owner: z.string(),
  name: z.string(),
  url: z.string(),
  health: z.string(),
  /**
   * False when the repository has never been polled successfully. When false,
   * the count fields are zero because nobody looked — any renderer showing
   * them raw tells a lie. This mirrors the same field on /app/api/dashboard.json's
   * Repo shape.
   */
  polled: z.boolean(),
  open: z.number().int(),
  gfi: z.number().int(),
  ageKnown: z.boolean(),
  ageDays: z.number().int(),
})

const AlertHealth = z.object({
  known: z.boolean(),
  items: z.array(HealthItem),
})

const ThreadItem = z.object({
  path: z.string(),
  author: z.string(),
  bot: z.boolean(),
  at: z.string(),
  outdated: z.boolean(),
  body: z.string(),
  url: z.string().optional(),
})

const UnresolvedPR = z.object({
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  threads: z.array(ThreadItem),
})

const AlertThreads = z.object({
  known: z.boolean(),
  items: z.array(UnresolvedPR),
})

const Phase = z.object({
  name: z.string(),
  abbr: z.string(),
  state: z.string(),
})

const PipeFlagged = z.object({
  owner: z.string(),
  name: z.string(),
  url: z.string(),
  stage: z.string().optional(),
  label: z.string().optional(),
})

const PipeFailed = z.object({
  owner: z.string(),
  name: z.string(),
  url: z.string(),
  label: z.string().optional(),
  phases: z.array(Phase),
})

const AlertPipeline = z.object({
  known: z.boolean(),
  flagged: z.array(PipeFlagged),
  failed: z.array(PipeFailed),
})

const AlertPoll = z.object({
  known: z.boolean(),
  lastUtc: z.string().optional(),
  nextUtc: z.string().optional(),
  intervalSeconds: z.number().int(),
  failedRepos: z.array(AlertFailedRepo),
})

const AlertAPI = z.object({
  known: z.boolean(),
  used: z.number().int(),
  limit: z.number().int(),
  percent: z.number().int(),
  resetUtc: z.string().optional(),
})

export const AlertsDoc = z.object({
  generatedAt: z.string(),
  labels: z.object({
    flagged: z.string(),
    failed: z.string(),
  }),
  totals: z.object({
    repoCount: z.number().int(),
    targetCount: z.number().int(),
  }),
  work: AlertWork,
  watch: AlertWatch,
  checks: AlertChecks,
  health: AlertHealth,
  threads: AlertThreads,
  pipeline: AlertPipeline,
  poll: AlertPoll,
  api: AlertAPI,
})
export type AlertsDoc = z.infer<typeof AlertsDoc>
export type AlertItem = z.infer<typeof AlertItem>
export type WatchItem = z.infer<typeof WatchItem>
export type HealthItem = z.infer<typeof HealthItem>
export type UnresolvedPR = z.infer<typeof UnresolvedPR>
export type ThreadItem = z.infer<typeof ThreadItem>
export type PipeFlagged = z.infer<typeof PipeFlagged>
export type PipeFailed = z.infer<typeof PipeFailed>

/**
 * Fetch the document. Shared by every alert page; React Query makes one
 * request and nine readers.
 */
export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await fetch('/app/api/alerts.json', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`alerts answered ${res.status}`)
      const parsed = AlertsDoc.safeParse(await res.json())
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
