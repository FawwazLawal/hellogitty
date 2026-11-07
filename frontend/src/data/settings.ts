import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * The settings page's data layer.
 *
 * Reads come from `/app/api/settings.json`. Writes do NOT get new endpoints:
 * tracking and untracking a repository already go to `/repos/add` and
 * `/repos/remove`, which the templated page has used all along and which are
 * guarded by same-origin plus a token header. §4 asks for "minimal typed
 * endpoints if the migration actually requires them", and for writes it does
 * not — the migration is of the interface, not the capability.
 */

export const SettingsDoc = z.object({
  version: z.string(),
  config: z.object({
    listen: z.string(),
    database: z.string(),
    snapshot: z.string(),
    reposFile: z.string(),
    inbox: z.string(),
    layoutDefault: z.string(),
  }),
  polling: z.object({
    intervalMinutes: z.number().int(),
    lastPollUtc: z.string(),
    nextPollUtc: z.string(),
    /** False before the first poll. A fresh start is not a stalled one. */
    known: z.boolean(),
  }),
  api: z.object({
    known: z.boolean(),
    used: z.number().int(),
    limit: z.number().int(),
    percent: z.number().int(),
    resetUtc: z.string(),
  }),
  repos: z.object({
    /** What the next poll will look at: snapshot minus anything removed. */
    tracked: z.array(z.string()),
    count: z.number().int(),
    /** Removed here but still in the snapshot until the next poll. */
    removed: z.array(z.string()),
    inPipeline: z.number().int(),
  }),
})
export type SettingsDoc = z.infer<typeof SettingsDoc>

export const SessionDoc = z.object({
  token: z.string(),
  /** Whether this build can change what is tracked at all. */
  writable: z.boolean(),
})
export type SessionDoc = z.infer<typeof SessionDoc>

async function getJSON<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  const parsed = schema.safeParse(await res.json())
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`${url} sent an unexpected shape: ${issue.path.join('.') || '(root)'} ${issue.message}`)
  }
  return parsed.data
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => getJSON('/app/api/settings.json', SettingsDoc),
    refetchInterval: 60_000,
    retry: 1,
  })
}

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => getJSON('/app/api/session.json', SessionDoc),
    // The token changes only when the process restarts, and a stale one simply
    // fails the write with a 403 that the UI already reports. No polling.
    staleTime: Infinity,
    retry: 1,
  })
}

/** What /repos/add and /repos/remove answer with. */
const RepoWriteResult = z.object({
  repo: z.string().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
})

/**
 * Track or untrack a repository.
 *
 * THE ERROR PATH IS THE INTERESTING ONE. This endpoint answers 422 with a body
 * carrying `error` — a rejection the user caused and can fix ("no such
 * repository", "already tracked"), not a failure of the request. Treating a
 * non-OK status as a thrown network error would show "something went wrong"
 * where the server had sent an explanation worth reading.
 *
 * So the body is parsed first and `error` surfaced as the message. Only a
 * status with no usable body falls back to a generic failure.
 */
export function useRepoMutation(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ repo, action }: { repo: string; action: 'add' | 'remove' }) => {
      if (!token) throw new Error('this session cannot change what is tracked')
      const res = await fetch(`/repos/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          // The CSRF guard. serveRepos requires same-origin AND this header,
          // so a page on another origin cannot forge the write.
          'X-HelloGitty-Token': token,
        },
        body: JSON.stringify({ repo }),
      })
      let body: z.infer<typeof RepoWriteResult> = {}
      try {
        body = RepoWriteResult.parse(await res.json())
      } catch {
        /* no usable body; fall through to the status */
      }
      if (body.error) throw new Error(body.error)
      if (!res.ok) throw new Error(`the server answered ${res.status}`)
      return body
    },
    onSuccess: () => {
      // The tracked list and the dashboard both change; refetch rather than
      // patching a cache by hand, which is how two views drift apart.
      void qc.invalidateQueries({ queryKey: ['settings'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
