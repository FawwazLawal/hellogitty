import { useAlerts } from '../../data/alerts'
import { AlertPage, type Stat } from '../AlertPage'
import { AlertList, Fact } from './parts'

/**
 * /alerts/api-low — the quota meter and a line-by-line reset breakdown.
 *
 * The gate on this page is literally GitHub's own response: `.APIKnown` is
 * false until GitHub reports a rate-limit header. The templated page already
 * branches on this via `{{if .APIKnown}}`; carrying the flag through the
 * schema makes the React branch obvious.
 */
export function ApiLowAlert() {
  const q = useAlerts()
  const d = q.data
  const api = d?.api
  const poll = d?.poll
  const remaining = api ? api.limit - api.used : 0

  const stats: Stat[] = api
    ? [
        { label: 'Remaining', value: remaining, known: api.known, tone: 'caution' },
        { label: 'Used', value: api.used, known: api.known },
        { label: 'Hourly limit', value: api.limit, known: api.known },
      ]
    : []

  const sections = api
    ? [
        {
          key: 'quota',
          heading: 'Quota',
          body: (
            <div className="px-4 py-3">
              <div
                className="h-2 w-full overflow-hidden"
                style={{ background: 'var(--hg-surface-raised)' }}
                role="progressbar"
                aria-valuenow={api.known ? api.percent : undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="GitHub quota used"
              >
                <div
                  style={{
                    width: `${api.known ? api.percent : 0}%`,
                    height: '100%',
                    background: 'var(--hg-accent-fill)',
                  }}
                />
              </div>
              <div
                className="mt-1.5 flex justify-between font-mono text-[11px] tabular-nums"
                style={{ color: 'var(--hg-text-muted)' }}
              >
                <span>{api.known ? `${api.percent}% used` : '—'}</span>
                <span>resets {api.resetUtc || 'on the hour'}</span>
              </div>
            </div>
          ),
        },
        {
          key: 'facts',
          heading: 'Details',
          body: (
            <AlertList>
              <Fact label="Used this hour" value={`${api.used} / ${api.limit} points`} known={api.known} />
              <Fact label="Reset at" value={api.resetUtc || 'unknown'} known={api.known && !!api.resetUtc} />
              <Fact label="Repositories tracked" value={d!.totals.repoCount} known={true} />
              <Fact
                label="Poll interval"
                value={poll && poll.intervalSeconds > 0 ? `every ${poll.intervalSeconds}s` : 'not configured'}
                known={!!poll && poll.intervalSeconds > 0}
              />
            </AlertList>
          ),
        },
      ]
    : []

  return (
    <AlertPage
      title="API running low"
      subtitle="Under 10% of the hourly GitHub quota remains — HelloGitty will keep working, but any additional traffic from this account's token (another tool, a browser session) could run the quota out before it resets."
      known={!!api?.known}
      notFetchedNote="GitHub hasn't reported a quota yet — this normally means the first check has not completed."
      stats={stats}
      sections={sections}
      recovery={
        <>
          <p>
            <strong>Why this lit.</strong> GitHub's REST and GraphQL APIs share a 5,000-point hourly budget per token. HelloGitty's refresh costs about 45 points, so the dashboard alone takes under 1% an hour. A spike almost always means another tool is using the same token.
          </p>
          <p className="mt-2">
            <strong>What to do.</strong> Wait for the reset time above — the counter clears at the top of the hour. If the alert keeps lighting between resets, check what else is calling GitHub with the same token (a CI job, a scripts folder, a browser extension that signed in), and either narrow the tracked repository list in <a href="/settings" style={{ color: 'var(--hg-text)' }}>Settings</a> or give that other tool its own token. HelloGitty automatically slows its own polling when the quota is near empty.
          </p>
        </>
      }
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}
