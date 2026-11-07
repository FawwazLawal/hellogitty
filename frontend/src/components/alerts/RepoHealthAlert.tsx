import { useAlerts } from '../../data/alerts'
import { AlertPage, type Stat } from '../AlertPage'
import { AlertList, EmptyNote, HealthRow } from './parts'

/**
 * /alerts/repo-dormant and /alerts/repo-slow share this component.
 *
 * ONE COMPONENT, TWO ROUTES — because the Go side already has one handler
 * for both URLs (`serveAlertRepoHealthPage` switches on the suffix), and
 * the only difference is which `health` value to filter on. Writing two
 * components would preserve a distinction the server itself doesn't have.
 * The pathname decides the filter at mount time.
 */
export function RepoHealthAlert({ health }: { health: 'DORMANT' | 'SLOW' }) {
  const q = useAlerts()
  const d = q.data
  const h = d?.health
  const filtered = h?.items.filter((i) => i.health === health) ?? []

  const title = health === 'DORMANT' ? 'Repo dormant' : 'Repo slowing'
  const subtitle =
    health === 'DORMANT'
      ? 'Repositories with no recent commit activity — they may have gone quiet.'
      : 'Repositories whose commit frequency has dropped — they may be losing momentum.'

  const stats: Stat[] = h
    ? [
        {
          label: title,
          value: filtered.length,
          known: h.known,
          tone: filtered.length > 0 ? 'caution' : 'neutral',
        },
        { label: 'Total tracked', value: d!.totals.repoCount, known: h.known },
      ]
    : []

  return (
    <AlertPage
      title={title}
      subtitle={subtitle}
      known={!!h?.known}
      notFetchedNote="The tracked-repos list has not been built yet. Repositories in this state will appear once the first poll completes."
      stats={stats}
      sections={
        h && h.known
          ? [
              {
                key: 'repos',
                heading: `Repositories (${filtered.length})`,
                body:
                  filtered.length === 0 ? (
                    <EmptyNote>No repositories are in this state.</EmptyNote>
                  ) : (
                    <AlertList>
                      {filtered.map((item) => (
                        <HealthRow key={`${item.owner}/${item.name}`} item={item} />
                      ))}
                    </AlertList>
                  ),
              },
            ]
          : []
      }
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}
