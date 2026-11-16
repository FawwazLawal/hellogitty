import { useAlerts } from '../../data/alerts'
import { AlertPage, type Stat } from '../AlertPage'
import { AlertList, EmptyNote, WatchRow } from './parts'
import { usePageTitle } from '../../hooks/usePageTitle'

/**
 * /alerts/watched-claimed — issues you watched that someone else claimed.
 *
 * `known` on this page is the watch feed's own `known`, not the page-wide
 * one. The templated page rendered `len .ClaimedWatch` as `0` whether the
 * feed had run and found nothing or had never run at all — the first case
 * reassures, the second one lies. The React page renders "not fetched" in
 * the second.
 */
export function WatchedClaimedAlert() {
  usePageTitle('Watched issue claimed · HelloGitty')
  const q = useAlerts()
  const d = q.data
  const watch = d?.watch

  const stats: Stat[] = watch
    ? [
        { label: 'Claimed', value: watch.claimed.length, known: watch.known, tone: 'caution' },
        { label: 'Total watched', value: watch.total, known: watch.known },
      ]
    : []

  return (
    <AlertPage
      title="Watched issue claimed"
      subtitle="Issues you are watching that someone else has claimed — they may be working on it already."
      known={!!watch?.known}
      notFetchedNote="The watch feed has not refreshed yet. Claimed and closed watched issues will appear once it has."
      stats={stats}
      sections={
        watch && watch.known
          ? [
              {
                key: 'claimed',
                heading: `Claimed issues (${watch.claimed.length})`,
                body:
                  watch.claimed.length === 0 ? (
                    <EmptyNote>No watched issues have been claimed.</EmptyNote>
                  ) : (
                    <AlertList>
                      {watch.claimed.map((it) => (
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
          Mark a claimed issue as <em>Seen</em> on the dashboard to quiet its alert until something changes.
        </p>
      }
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}
