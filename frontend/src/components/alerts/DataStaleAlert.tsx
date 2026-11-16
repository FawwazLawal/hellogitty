import { useAlerts } from '../../data/alerts'
import { AlertPage } from '../AlertPage'
import { AlertList, Fact } from './parts'
import { usePageTitle } from '../../hooks/usePageTitle'

/**
 * /alerts/data-stale — last-poll facts, next-scheduled-poll, interval, and
 * what the last cycle couldn't reach.
 *
 * No stats cards — the page is all facts. Per-fact `known` means the client
 * can show "Last poll: 00:12:34Z, Next: —" when one side is set and the
 * other isn't, which the templates could not express.
 */
export function DataStaleAlert() {
  usePageTitle('Data is stale · HelloGitty')
  const q = useAlerts()
  const d = q.data
  const poll = d?.poll

  const sections = poll
    ? [
        {
          key: 'cycle',
          heading: 'Check cycle',
          body: (
            <AlertList>
              <Fact label="Last successful check" value={poll.lastUtc ?? 'none yet'} known={!!poll.lastUtc} />
              <Fact label="Next scheduled check" value={poll.nextUtc ?? 'unknown'} known={!!poll.nextUtc} />
              <Fact
                label="Poll interval"
                value={poll.intervalSeconds > 0 ? `every ${poll.intervalSeconds}s` : 'not configured'}
                known={poll.intervalSeconds > 0}
              />
              <Fact
                label="Repositories tracked"
                value={d!.totals.repoCount}
                known={true}
              />
            </AlertList>
          ),
        },
      ]
    : []

  if (poll && poll.failedRepos.length > 0) {
    sections.push({
      key: 'failed',
      heading: 'What the last check could not reach',
      body: (
        <AlertList>
          {poll.failedRepos.map((f) => (
            <Fact key={f.name} label={f.name} value={f.error} known={true} />
          ))}
        </AlertList>
      ),
    })
  }

  return (
    <AlertPage
      title="Data is stale"
      subtitle="The dashboard numbers are only as fresh as the last successful check of GitHub — this page shows when that was and what might be stopping the next one."
      /*
        A data-stale page is reachable in two world states: (a) a poll has
        completed but is old (stale), (b) no poll has ever completed. The
        page carries facts for either — it never pretends to a healthy
        cycle it doesn't have. So `known: true` always: the poll's own
        Known is carried per-fact above rather than at the page level.
      */
      known={true}
      notFetchedNote=""
      stats={[]}
      sections={sections}
      recovery={
        <>
          <p>
            <strong>Why this lit.</strong> The last check of GitHub is more than two hours old. HelloGitty keeps the dashboard showing what it last fetched; a stale number is still accurate at the time it was gathered.
          </p>
          <p className="mt-2">
            <strong>What to do.</strong> Most stale alerts clear themselves on the next poll — the dashboard refreshes automatically. If the counter does not move on refresh: check that your computer has network, then that your GitHub token is still valid (Settings → Account). If a specific repository's check keeps failing, it will appear in <a href="/alerts/check-failed" style={{ color: 'var(--hg-text)' }}>Check failed</a>; a missing token or an expired one goes into the server log.
          </p>
        </>
      }
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}
