import { useAlerts } from '../../data/alerts'
import { AlertPage, type Stat } from '../AlertPage'
import { AlertList, ItemRow, EmptyNote } from './parts'

/**
 * /alerts/your-move — pull requests and issues that need a move from you.
 *
 * Three sub-sections kept apart because that split is the page's point: what
 * YOU opened, what others opened in YOUR repos, and conversations where you
 * are owed a reply. Merging them into one list sorted by date erases what the
 * page exists to show.
 */
export function YourMoveAlert() {
  const q = useAlerts()
  const d = q.data
  const w = d?.work

  const stats: Stat[] = w
    ? [
        { label: 'Total waiting on you', value: w.yourMove, known: w.known, tone: 'caution' },
        { label: 'Your PRs / issues', value: w.you.length, known: w.known },
        { label: "Incoming (others' repos)", value: w.inYou.length, known: w.known },
        { label: 'Conversations', value: w.convYou.length, known: w.known },
      ]
    : []

  return (
    <AlertPage
      title="Your move"
      subtitle="Pull requests and issues waiting on you — things where the next action is yours."
      known={!!w?.known}
      partial={w?.partial}
      notFetchedNote="The work refresh has not completed yet. Once it runs, items waiting on you will appear here."
      stats={stats}
      sections={w && w.known ? sectionsFor(w) : []}
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}

function sectionsFor(w: NonNullable<ReturnType<typeof useAlerts>['data']>['work']) {
  const all: { key: string; heading: string; body: React.ReactNode }[] = []
  all.push({
    key: 'you',
    heading: `Your pull requests and issues (${w.you.length})`,
    body:
      w.you.length === 0 ? (
        <EmptyNote>No open items of yours need a move right now.</EmptyNote>
      ) : (
        <AlertList>
          {w.you.map((it) => (
            <ItemRow key={`${it.repo}#${it.number}`} item={it} />
          ))}
        </AlertList>
      ),
  })
  all.push({
    key: 'inYou',
    heading: `Incoming — in others' repositories (${w.inYou.length})`,
    body:
      w.inYou.length === 0 ? (
        <EmptyNote>Nothing is incoming from others' repositories.</EmptyNote>
      ) : (
        <AlertList>
          {w.inYou.map((it) => (
            <ItemRow key={`${it.repo}#${it.number}`} item={it} />
          ))}
        </AlertList>
      ),
  })
  all.push({
    key: 'convYou',
    heading: `Conversations waiting on you (${w.convYou.length})`,
    body:
      w.convYou.length === 0 ? (
        <EmptyNote>No conversations are waiting on you.</EmptyNote>
      ) : (
        <AlertList>
          {w.convYou.map((it) => (
            <ItemRow key={`${it.repo}#${it.number}`} item={it} />
          ))}
        </AlertList>
      ),
  })
  return all
}
