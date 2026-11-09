import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { usePageTitle } from '../hooks/usePageTitle'
import { Briefcase, AlertTriangle, ExternalLink, Undo2 } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import { useSession } from '../data/settings'

/**
 * The "Your work" page.
 *
 * THE GROUPS ARE THE PAGE. "Waiting on you" and "waiting on them" is the
 * question this page exists to answer, and merging them into one list sorted by
 * date answers a different question — one you could get from GitHub directly.
 * So the four groups stay four groups, and the counts above them are tabs into
 * each rather than totals that sum to something.
 *
 * `Done` and `Dismissed` are separate for the same reason: finished is not the
 * same as set aside, and only one of them can be restored.
 */

const WorkRow = z.object({
  key: z.string(),
  kind: z.string(),
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  why: z.string(),
  status: z.string(),
  /** The server's severity word: "caution", "ok" or empty. */
  level: z.string(),
  /** A step only you can take, e.g. "Sign the CLA". */
  personal: z.string().optional(),
  ago: z.string(),
  agoTitle: z.string(),
  labels: z.array(z.string()),
})
type WorkRow = z.infer<typeof WorkRow>

const WorkDoc = z.object({
  known: z.boolean(),
  error: z.string().optional(),
  /** New but incomplete, because a refresh failed halfway. Not "none yet". */
  partial: z.boolean(),
  login: z.string(),
  scope: z.string(),
  you: z.array(WorkRow),
  them: z.array(WorkRow),
  done: z.array(WorkRow),
  dismissed: z.array(WorkRow),
})

function useWork() {
  return useQuery({
    queryKey: ['work'],
    queryFn: async () => {
      const res = await fetch('/app/api/work.json', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`the work board answered ${res.status}`)
      const parsed = WorkDoc.safeParse(await res.json())
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

/** Restore a dismissed item, through the endpoint the templated page uses. */
function useRestore(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (key: string) => {
      if (!token) throw new Error('this session cannot restore items')
      const res = await fetch('/cells/restore', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'X-HelloGitty-Token': token },
        body: JSON.stringify({ key: 'work', items: [key] }),
      })
      if (!res.ok) throw new Error(`the server answered ${res.status}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['work'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

type Group = 'you' | 'them' | 'done' | 'dismissed'

const GROUPS: { id: Group; label: string; hint: string }[] = [
  { id: 'you', label: 'Waiting on you', hint: 'Something here needs a move from you' },
  { id: 'them', label: 'Waiting on them', hint: 'Out for review, or someone else owes a reply' },
  { id: 'done', label: 'Finished', hint: 'Merged or closed as completed' },
  { id: 'dismissed', label: 'Dismissed', hint: 'Set aside by you — restorable' },
]

export function WorkPage() {
  usePageTitle('Your work · HelloGitty')
  const q = useWork()
  const session = useSession()
  const restore = useRestore(session.data?.token)
  const [group, setGroup] = useState<Group>('you')
  const [search, setSearch] = useState('')

  const d = q.data
  const rows = useMemo(() => {
    if (!d) return []
    const base = d[group]
    const needle = search.trim().toLowerCase()
    if (!needle) return base
    return base.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.repo.toLowerCase().includes(needle) ||
        String(r.number).includes(needle),
    )
  }, [d, group, search])

  return (
    <main className="min-w-0 overflow-x-hidden px-4 pb-24 pt-4">
      <h1 className="mb-1 text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>Your work</h1>
      <p className="mb-3 text-[11.5px]" style={{ color: 'var(--hg-text-muted)' }}>
        {d?.login ? `Pull requests and issues @${d.login} has out, anywhere on GitHub.` : 'Pull requests and issues you have out.'}
      </p>

      {q.isError && (
        <div role="alert" className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}>
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{q.error.message}</span>
        </div>
      )}

      {/*
        A partial board is called out, because it is new-but-incomplete rather
        than stale-but-whole, and acting on it can mean acting on half the
        picture. The server already distinguishes the two; the page should too.
      */}
      {d?.partial && (
        <div role="status" className="mb-3 flex items-start gap-2 border px-4 py-2.5 text-[12px]"
          style={{ borderColor: 'var(--hg-warning)', color: 'var(--hg-warning)' }}>
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>This board is incomplete — the last refresh did not finish, so something may be missing.</span>
        </div>
      )}

      <Panel>
        <PanelHeader icon={<Briefcase size={14} aria-hidden="true" />} title="Work board">
          <label className="flex items-center">
            <span className="sr-only">Search your work</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-[180px] border px-2.5 py-1 text-[11.5px]"
              style={{ background: 'var(--hg-surface-sunken)', borderColor: 'var(--hg-line)', color: 'var(--hg-text)' }}
            />
          </label>
        </PanelHeader>

        {/*
          Tabs into each group, not totals. These never sum to anything and
          are not meant to: an item is in exactly one of them.
        */}
        <div role="group" aria-label="Work groups" className="flex flex-wrap gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--hg-line)' }}>
          {GROUPS.map((g) => {
            const active = group === g.id
            const count = d ? d[g.id].length : undefined
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={active}
                title={g.hint}
                onClick={() => setGroup(g.id)}
                className="flex items-center gap-1.5 border px-2.5 py-1 text-[11.5px] transition-colors"
                style={{
                  background: active ? 'var(--hg-accent-fill)' : 'var(--hg-surface)',
                  borderColor: active ? 'var(--hg-accent-fill)' : 'var(--hg-line-strong)',
                  color: active ? 'var(--hg-accent-ink)' : 'var(--hg-text-muted)',
                }}
              >
                {g.label}
                <span className="font-mono tabular-nums">{count ?? '—'}</span>
              </button>
            )
          })}
        </div>

        {restore.isError && (
          <p role="alert" className="border-b px-4 py-2 text-[12px]" style={{ borderColor: 'var(--hg-line)', color: 'var(--hg-danger)' }}>
            {restore.error.message}
          </p>
        )}

        {d && !d.known && (
          <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            The work board has not been fetched yet.
          </p>
        )}

        {d && d.known && rows.length === 0 && (
          <p className="px-4 py-8 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            {search ? 'Nothing matches that search.' : `Nothing ${GROUPS.find((g) => g.id === group)!.label.toLowerCase()}.`}
          </p>
        )}

        <ul>
          {rows.map((r) => (
            <li key={r.key} className="border-b px-4 py-2.5 last:border-b-0" style={{ borderColor: 'var(--hg-line)' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1.5 text-[12.5px] no-underline hover:underline"
                    style={{ color: 'var(--hg-text)' }}
                  >
                    <span className="truncate">{r.title}</span>
                    <ExternalLink size={11} aria-hidden="true" className="shrink-0 opacity-50" />
                  </a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                    <span className="font-mono">{r.repo}#{r.number}</span>
                    {r.why && <span>· {r.why}</span>}
                    {r.status && (
                      // The server's severity word drives the colour; the text
                      // carries the meaning, so colour is never the only cue.
                      <span style={{ color: r.level === 'caution' ? 'var(--hg-warning)' : undefined }}>· {r.status}</span>
                    )}
                    {r.personal && (
                      <span style={{ color: 'var(--hg-accent)' }}>· {r.personal}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--hg-text-muted)' }} title={r.agoTitle}>
                    {r.ago || '—'}
                  </span>
                  {group === 'dismissed' && session.data?.token && (
                    <button
                      type="button"
                      onClick={() => restore.mutate(r.key)}
                      disabled={restore.isPending}
                      className="flex items-center gap-1 border px-2 py-1 text-[11px] disabled:opacity-50"
                      style={{ borderColor: 'var(--hg-line-strong)', color: 'var(--hg-text)' }}
                    >
                      <Undo2 size={11} aria-hidden="true" />
                      Restore<span className="sr-only"> {r.title}</span>
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  )
}
