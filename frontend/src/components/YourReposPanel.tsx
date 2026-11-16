import { useState } from 'react'
import { FolderGit2, ExternalLink } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import type { WorkFromApi, WorkItemFromApi } from '../data/dashboard'

/**
 * Your repositories — PRs, issues and notifications in repos the owner
 * owns, split by whose move it is.
 *
 * ADR-UI-002 §4: rows come from `WorkFromApi` on the dashboard document.
 * The templated panel knows which items are "in your repos" because the
 * server tagged them (`.Work.InYou` / `.Work.InThem` / `.Work.RepoOther`).
 * The JSON projection does not yet carry that tag; instead the panel
 * filters client-side by repo prefix against the viewer's login, which
 * is the same rule the server uses for "your" repos (it does NOT cover
 * the maintained-list — those are reached via their own InYou/InThem
 * buckets on the server and are a follow-up for this panel).
 *
 * KNOWN IS NOT EMPTY, same rule as every other panel: `work.known: false`
 * is "not fetched yet", not "no work". An empty filtered list AFTER a
 * successful fetch is a real "nothing in your repos waits on you"
 * answer, and the panel says so.
 */

export function YourReposPanel({ work }: { work: WorkFromApi }) {
  const [showAll, setShowAll] = useState(false)

  if (!work.known) {
    return (
      <Panel>
        <PanelHeader icon={<FolderGit2 size={14} aria-hidden="true" />} title="Your repositories" />
        <div className="px-4 py-3">
          <p className="text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            Pull requests and notifications in your own repositories appear here once
            HelloGitty has refreshed your work board.
          </p>
        </div>
      </Panel>
    )
  }

  const login = work.login
  const mine = login ? work.items.filter((i) => i.repo.startsWith(login + '/')) : []
  const needYou = mine.filter((i) => i.yourMove)
  const waiting = mine.filter((i) => !i.yourMove)
  const display = showAll ? mine : needYou

  return (
    <Panel>
      <PanelHeader icon={<FolderGit2 size={14} aria-hidden="true" />} title="Your repositories">
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          <span style={{ color: 'var(--hg-text)' }}>{needYou.length}</span> need you ·{' '}
          <span style={{ color: 'var(--hg-text)' }}>{waiting.length}</span> waiting
        </span>
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="border px-2 py-1 text-[11px] transition-colors"
          style={{
            borderColor: 'var(--hg-line-strong)',
            color: 'var(--hg-text)',
            background: 'var(--hg-surface-raised)',
          }}
        >
          {showAll ? 'Only needs me' : 'Show all'}
        </button>
      </PanelHeader>

      <div className="px-4 py-3">
        {display.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            {mine.length === 0 ? (
              <>
                <span style={{ color: 'var(--hg-text)', fontWeight: 600 }}>No activity </span>
                in your own repositories right now.
              </>
            ) : showAll ? (
              'No activity on your repos right now.'
            ) : (
              <>
                <span style={{ color: 'var(--hg-text)', fontWeight: 600 }}>
                  Nothing needs you{' '}
                </span>
                in your own repositories. Press &ldquo;Show all&rdquo; to see what is waiting
                on others.
              </>
            )}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {display.map((i) => (
              <WorkRow key={i.key} i={i} />
            ))}
          </ul>
        )}

        <p
          className="mt-3 text-[11px]"
          style={{ color: 'var(--hg-text-muted)' }}
        >
          Maintain repositories you don&rsquo;t own? List them under <code>maintain</code> in{' '}
          <code>hellogitty.json</code>.
        </p>
      </div>
    </Panel>
  )
}

function WorkRow({ i }: { i: WorkItemFromApi }) {
  const level = i.level === 'caution'
  return (
    <li className="flex items-start gap-2 text-[12px]">
      <span
        className="mt-0.5 shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{
          background: 'var(--hg-surface-raised)',
          color: level ? 'var(--hg-sev-medium, #b47e00)' : 'var(--hg-text-muted)',
        }}
        title={i.why || i.kind}
      >
        {i.kind}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <a
          href={i.url}
          target="_blank"
          rel="noopener noreferrer"
          title={i.title}
          className="flex min-w-0 items-start gap-1 underline decoration-dotted underline-offset-2"
          style={{ color: 'var(--hg-text)' }}
        >
          <span className="truncate">{i.title}</span>
          <ExternalLink size={10} aria-hidden="true" className="mt-0.5 shrink-0" />
        </a>
        <span
          className="text-[10.5px]"
          style={{ color: 'var(--hg-text-muted)' }}
          title={i.agoTitle}
        >
          {i.repo}
          {typeof i.number === 'number' ? ` #${i.number}` : ''} · {i.ago} · {i.why}
        </span>
      </div>
    </li>
  )
}
