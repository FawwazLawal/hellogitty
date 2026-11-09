import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

/**
 * The security panel's data layer.
 *
 * `/app/api/security.json` is a thin projection of `security.Feed`: a list
 * of recent high-severity CVEs and a short list of tips. The server fetches
 * from NVD on a background loop; this endpoint is read-only and derived
 * from the snapshot already in memory. See `internal/dashboard/security_api.go`.
 *
 * The Severity enum is the server's vocabulary string — "CRITICAL", "HIGH",
 * "MEDIUM", "LOW" — and NOT translated here, same reasoning as every other
 * projection: translating here would put the server and the React badge in
 * two places where they can disagree about what state a row is in.
 */

export const SecurityCVE = z.object({
  id: z.string(),
  description: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  published: z.string(),
  url: z.string(),
  /** Optional affected-package tokens, e.g. "go-redis". Absent when NVD did
   *  not match any tracked repo's name tokens. */
  packages: z.array(z.string()).optional(),
})
export type SecurityCVE = z.infer<typeof SecurityCVE>

export const SecurityTip = z.object({
  text: z.string(),
  /** "warn" dims the tip against a cautionary styling. Empty or absent is
   *  the neutral default. */
  level: z.string().optional(),
})
export type SecurityTip = z.infer<typeof SecurityTip>

export const SecurityDoc = z.object({
  cves: z.array(SecurityCVE),
  tips: z.array(SecurityTip),
  /** When the feed was last refreshed from NVD. Empty before the first
   *  successful fetch. Not a "known" flag because the empty string is
   *  itself the distinguishing signal — a timestamp is either present or
   *  isn't, there's no "0 means unknown" trap here. */
  fetchedAt: z.string(),
  /** Set when the last refresh failed. The feed may still carry CVEs
   *  (the previous successful fetch) alongside the error — the panel
   *  renders both: old data honestly, plus the failure beside it. */
  error: z.string().optional(),
})
export type SecurityDoc = z.infer<typeof SecurityDoc>

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

export function useSecurity() {
  return useQuery({
    queryKey: ['security'],
    queryFn: () => getJSON('/app/api/security.json', SecurityDoc),
    // NVD is refreshed every few hours on the server; a poll faster than
    // that just shows the same answer. Five-minute staleness is a safe
    // middle — the panel is a glance, not a heartbeat.
    refetchInterval: 5 * 60_000,
    retry: 1,
  })
}
