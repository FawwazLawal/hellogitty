import { useAlerts } from '../../data/alerts'
import { AlertPage, type Stat } from '../AlertPage'
import { AlertList, EmptyNote, InlineNote } from './parts'

/** /alerts/check-failed — repositories whose last poll failed. */
export function CheckFailedAlert() {
  const q = useAlerts()
  const d = q.data
  const c = d?.checks

  const stats: Stat[] = c
    ? [
        {
          label: 'Failed checks',
          value: c.failed.length,
          known: c.known,
          tone: c.failed.length > 0 ? 'caution' : 'neutral',
        },
        { label: 'Total tracked', value: d!.totals.repoCount, known: true },
      ]
    : []

  return (
    <AlertPage
      title="Check failed"
      subtitle="Repositories and services that failed their last check — HelloGitty will retry on the next poll."
      known={!!c?.known}
      notFetchedNote="No poll has completed yet. Once the first check runs, any that failed will appear here."
      stats={stats}
      sections={
        c && c.known
          ? [
              {
                key: 'failed',
                heading: `Failed repositories (${c.failed.length})`,
                body:
                  c.failed.length === 0 ? (
                    <EmptyNote>All checks passed.</EmptyNote>
                  ) : (
                    <AlertList>
                      {c.failed.map((f) => (
                        <li
                          key={f.name}
                          className="border-b px-4 py-2.5 last:border-b-0"
                          style={{ borderColor: 'var(--hg-line)' }}
                        >
                          <a
                            href={`https://github.com/${f.name}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-[12.5px] font-medium no-underline hover:underline"
                            style={{ color: 'var(--hg-text)' }}
                          >
                            {f.name}
                          </a>
                          {f.error && (
                            <InlineNote>
                              <span style={{ color: 'var(--hg-danger)' }}>{f.error}</span>
                            </InlineNote>
                          )}
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
          HelloGitty tries again on the next check. Hover the alert on the dashboard for the full error.
        </p>
      }
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}
