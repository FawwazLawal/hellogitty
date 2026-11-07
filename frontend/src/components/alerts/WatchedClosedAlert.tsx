import { useAlerts } from '../../data/alerts'
import { AlertPage, type Stat } from '../AlertPage'
import { AlertList, EmptyNote, WatchRow } from './parts'

/** /alerts/watched-closed — watched issues that got closed. */
export function WatchedClosedAlert() {
  const q = useAlerts()
  const d = q.data
  const watch = d?.watch

  const stats: Stat[] = watch
    ? [
        { label: 'Closed', value: watch.closed.length, known: watch.known },
        { label: 'Total watched', value: watch.total, known: watch.known },
      ]
    : []

  return (
    <AlertPage
      title="Watched issue closed"
      subtitle="Issues you were watching that have been closed — either fixed or decided against."
      known={!!watch?.known}
      notFetchedNote="The watch feed has not refreshed yet. Closed watched issues will appear once it has."
      stats={stats}
      sections={
        watch && watch.known
          ? [
              {
                key: 'closed',
                heading: `Closed issues (${watch.closed.length})`,
                body:
                  watch.closed.length === 0 ? (
                    <EmptyNote>No watched issues have been closed.</EmptyNote>
                  ) : (
                    <AlertList>
                      {watch.closed.map((it) => (
                        <WatchRow key={`${it.repo}#${it.number}`} item={it} />
                      ))}
                    </AlertList>
                  ),
              },
            ]
          : []
      }
      recovery={
        <p>
          Mark a closed issue as <em>Seen</em> on the dashboard to quiet its alert until something changes.
        </p>
      }
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}
