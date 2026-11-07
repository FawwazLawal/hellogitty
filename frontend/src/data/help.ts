import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

/**
 * The help page's data layer.
 *
 * WHY AN ENDPOINT FOR WHAT LOOKS LIKE PROSE. The static Markdown is
 * rendered server-side because the server knows where to point links —
 * `../README.md` goes to GitHub, `screenshot.png` to `/help/screenshot.png`,
 * bare paths to `docs/` on `main`. Duplicating those rewrites in TS
 * would create two places for a renamed file to drift.
 *
 * The live parts — glossary (from pipeline state) and about (from
 * telemetry + notifications) — carry their own `known` flag per row,
 * same convention as the alert pages. An unchecked poll gives "Not
 * checked yet" as `Value` AND `Known: false`, so the client decides
 * whether to render the value or an em-dash.
 */

const HelpSection = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  /** Trusted HTML from `help.Render` — a goldmark render with a fixed
   *  set of extensions and the server's own link rewriter. Set into the
   *  DOM via `dangerouslySetInnerHTML`. */
  html: z.string(),
})

const HelpTerm = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  means: z.string(),
  do: z.string().optional(),
  search: z.string(),
})

const AboutRow = z.object({
  key: z.string(),
  value: z.string(),
  url: z.string().optional(),
  /** False for a value the server has not yet learned (last poll time
   *  before a first poll, notifications state before probed). The
   *  client renders the value for known rows and an em-dash otherwise. */
  known: z.boolean(),
})

export const HelpDoc = z.object({
  title: z.string(),
  intro: z.string(),
  introText: z.string(),
  sections: z.array(HelpSection),
  glossary: z.array(HelpTerm),
  about: z.array(AboutRow),
  aiPrompt: z.string(),
})
export type HelpDoc = z.infer<typeof HelpDoc>
export type HelpSection = z.infer<typeof HelpSection>
export type HelpTerm = z.infer<typeof HelpTerm>
export type AboutRow = z.infer<typeof AboutRow>

export function useHelp() {
  return useQuery({
    queryKey: ['help'],
    queryFn: async () => {
      const res = await fetch('/app/api/help.json', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`help answered ${res.status}`)
      const parsed = HelpDoc.safeParse(await res.json())
      if (!parsed.success) {
        const i = parsed.error.issues[0]
        throw new Error(`unexpected shape: ${i.path.join('.') || '(root)'} ${i.message}`)
      }
      return parsed.data
    },
    // Help content changes rarely: the guide is in the binary, glossary
    // and about move with the poll. A minute is the same cadence the
    // dashboard uses, and the only live rows here reconcile with a
    // completed poll — no need to be more aggressive than that.
    refetchInterval: 60_000,
    retry: 1,
  })
}
