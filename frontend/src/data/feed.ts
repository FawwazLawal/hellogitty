import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * The feed page's data layer.
 *
 * Reads come from `/feed.json`, which already existed; writes (acknowledging
 * one or many rows) go to `/feed/ack`, also existing. The ADR's rule for the
 * migration — add typed endpoints only if the port requires them — is
 * satisfied here by adding none: both ends were already shaped for a client
 * other than the templated page, and the endpoints only grew a `known` flag.
 *
 * KNOWN IS NOT EMPTY. Same shape as the alert pages: before the first poll
 * completes the feed's row list is empty because nothing has been fetched,
 * not because nothing has happened. A page rendering "all caught up" from
 * that state is a page lying about the one thing it exists to tell you.
 */

export const FeedRow = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  repo: z.string(),
  number: z.number().int().optional(),
  text: z.string(),
  url: z.string(),
  actor: z.string().optional(),
  at: z.string(),
  key: z.string().optional(),
  /** GitHub notification behind the row, if there is one. Acknowledging
   *  marks it read on GitHub, and reading it on GitHub acknowledges the
   *  row. Without one, the ack stays local. */
  thread: z.string().optional(),
  acked: z.boolean(),
  watched: z.boolean().optional(),
})
export type FeedRow = z.infer<typeof FeedRow>

export const FeedDoc = z.object({
  /** False before the first poll completes — no row-list is a real one yet. */
  known: z.boolean(),
  /** Whether this build can watch and unwatch issues. */
  canWatch: z.boolean(),
  rows: z.array(FeedRow),
})
export type FeedDoc = z.infer<typeof FeedDoc>

export function useFeed() {
  return useQuery({
    queryKey: ['feed'],
    queryFn: async () => {
      const res = await fetch('/feed.json', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`the feed answered ${res.status}`)
      const parsed = FeedDoc.safeParse(await res.json())
      if (!parsed.success) {
        const i = parsed.error.issues[0]
        throw new Error(`unexpected shape: ${i.path.join('.') || '(root)'} ${i.message}`)
      }
      return parsed.data
    },
    // The feed's whole job is being fresh. Shorter than the dashboard's
    // minute: a notification arriving and taking a minute to show up would
    // be worse than useful.
    refetchInterval: 20_000,
    retry: 1,
  })
}

/** What `/feed/ack` answers with — results per id. */
const AckResult = z.object({
  id: z.string(),
  github: z.string(),
})
const AckResponse = z.object({
  results: z.array(AckResult),
})

/**
 * Acknowledge one or more feed rows.
 *
 * The CSRF guard: same-origin plus the `X-HelloGitty-Token` header, the
 * same pair every write in this UI uses. The server's rejections are
 * things the reader can act on — a missing token says "reload", an
 * expired notification says "it's fine, GitHub already closed it" — so
 * the failure string is surfaced verbatim rather than a generic message.
 *
 * Optimistic update kept SIMPLE: the cache gets flipped `acked: true`
 * for the sent ids, and on error we refetch rather than carrying the
 * un-roll logic. The cost of the extra fetch is tiny against the cost
 * of writing a rollback that is wrong on an edge case.
 */
export function useAck(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!token) throw new Error('this session cannot acknowledge feed items (reload the page)')
      if (ids.length === 0) throw new Error('no items to acknowledge')
      if (ids.length > 200) throw new Error('too many items in one acknowledgement')
      const res = await fetch('/feed/ack', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'X-HelloGitty-Token': token,
        },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) {
        // The body of a 400/403 from the ack endpoint is a short string
        // — "forbidden" or "bad request". Surface it rather than a
        // network-level message, because the reader can act on both.
        const text = await res.text().catch(() => '')
        throw new Error(text.trim() || `the server answered ${res.status}`)
      }
      const parsed = AckResponse.safeParse(await res.json())
      if (!parsed.success) throw new Error('acknowledgement returned an unexpected shape')
      return parsed.data.results
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ['feed'] })
      const prev = qc.getQueryData<FeedDoc>(['feed'])
      if (prev) {
        const marked = new Set(ids)
        qc.setQueryData<FeedDoc>(['feed'], {
          ...prev,
          rows: prev.rows.map((r) => (marked.has(r.id) ? { ...r, acked: true } : r)),
        })
      }
      return { prev }
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(['feed'], ctx.prev)
    },
    onSettled: () => {
      // The server reconciles with GitHub (marking notifications read, or
      // keeping local-only acks), so re-fetch to reflect what actually
      // landed rather than trusting the optimistic shape.
      void qc.invalidateQueries({ queryKey: ['feed'] })
    },
  })
}
