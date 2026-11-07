import { useAlerts } from '../../data/alerts'
import { AlertPage, type Stat } from '../AlertPage'
import { AlertList, EmptyNote } from './parts'

/**
 * /alerts/unresolved-threads — open PRs with review threads still waiting.
 *
 * The nested shape (a PR carries its Threads) is preserved rather than
 * flattened to a list of threads with repo/number denormalised onto each,
 * because the page's point is "how many PRs, and which threads per PR" —
 * not a flat feed.
 */
export function UnresolvedThreadsAlert() {
  const q = useAlerts()
  const d = q.data
  const t = d?.threads

  const threadCount = (t?.items ?? []).reduce((n, pr) => n + pr.threads.length, 0)

  const stats: Stat[] = t
    ? [
        {
          label: 'Pull requests',
          value: t.items.length,
          known: t.known,
          tone: t.items.length > 0 ? 'caution' : 'neutral',
        },
        { label: 'Open threads', value: threadCount, known: t.known },
      ]
    : []

  return (
    <AlertPage
      title="Unresolved threads"
      subtitle="Open pull requests of yours with review comments the reviewer has yet to mark resolved — every unresolved thread still blocks a merge for the reviewers who gate on them."
      known={!!t?.known}
      notFetchedNote="The work refresh has not completed yet. Pull requests with open review threads will appear once it runs."
      stats={stats}
      sections={
        t && t.known
          ? [
              {
                key: 'prs',
                heading: `Pull requests with open threads (${t.items.length})`,
                body:
                  t.items.length === 0 ? (
                    <EmptyNote>No unresolved review threads on your open pull requests.</EmptyNote>
                  ) : (
                    <AlertList>
                      {t.items.map((pr) => (
                        <li
                          key={`${pr.repo}#${pr.number}`}
                          className="border-b px-4 py-3 last:border-b-0"
                          style={{ borderColor: 'var(--hg-line)' }}
                        >
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-[12.5px] font-medium no-underline hover:underline"
                            style={{ color: 'var(--hg-text)' }}
                          >
                            <span className="font-mono text-[11px]">{pr.repo}#{pr.number}</span> {pr.title}
                          </a>
                          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                            {pr.threads.length} open thread{pr.threads.length === 1 ? '' : 's'}
                          </p>
                          <ul className="mt-2 space-y-2">
                            {pr.threads.map((th, i) => (
                              <li
                                key={i}
                                className="border-l-2 pl-3 py-1"
                                style={{
                                  borderColor: 'var(--hg-line)',
                                  opacity: th.outdated ? 0.6 : 1,
                                }}
                              >
                                <div
                                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]"
                                  style={{ color: 'var(--hg-text-muted)' }}
                                >
                                  <span className="font-mono" style={{ color: 'var(--hg-text)' }}>
                                    {th.path}
                                  </span>
                                  <span className="font-semibold" style={{ color: 'var(--hg-text)' }}>
                                    @{th.author}
                                    {th.bot && ' (bot)'}
                                  </span>
                                  <time
                                    dateTime={th.at}
                                    title={th.at}
                                    className="font-mono tabular-nums"
                                  >
                                    {th.at.slice(0, 10)}
                                  </time>
                                  {th.outdated && (
                                    <span
                                      className="rounded px-1.5 py-0.5 text-[10px]"
                                      style={{
                                        background: 'var(--hg-surface-raised)',
                                        color: 'var(--hg-text-muted)',
                                      }}
                                    >
                                      outdated (code changed)
                                    </span>
                                  )}
                                </div>
                                <p
                                  className="mt-1 text-[12px]"
                                  style={{ color: 'var(--hg-text)' }}
                                >
                                  {th.url ? (
                                    <a
                                      href={th.url}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="no-underline hover:underline"
                                      style={{ color: 'var(--hg-text)' }}
                                    >
                                      {excerpt(th.body, 240)}
                                    </a>
                                  ) : (
                                    excerpt(th.body, 240)
                                  )}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </AlertList>
                  ),
              },
            ]
          : []
      }
      recovery={
        <p>
          <strong>Clearing a thread.</strong> Reply to the open comment, and if the reviewer agrees ask them to mark it resolved on GitHub — a reviewer can resolve any thread they can see, you can resolve your own. GitHub itself doesn't require resolved threads to merge, but a repository's branch protection or a reviewer's habit might. An <strong>outdated</strong> thread points at code the diff has since replaced; it is almost always safe to resolve.
        </p>
      }
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}

function excerpt(body: string, n: number): string {
  if (body.length <= n) return body
  return body.slice(0, n).trimEnd() + '…'
}
