import { useAlerts } from '../../data/alerts'
import { AlertPage, type Stat } from '../AlertPage'
import { AlertList, EmptyNote } from './parts'

/** /alerts/stage-failed — pipeline repos with a failed stage. */
export function StageFailedAlert() {
  const q = useAlerts()
  const d = q.data
  const p = d?.pipeline
  const failedLabel = d?.labels.failed || 'Stage failed'

  const stats: Stat[] = p
    ? [
        {
          label: failedLabel,
          value: p.failed.length,
          known: p.known,
          tone: p.failed.length > 0 ? 'warn' : 'neutral',
        },
        { label: 'In pipeline', value: d!.totals.targetCount, known: p.known },
        { label: 'Tracked total', value: d!.totals.repoCount, known: true },
      ]
    : []

  return (
    <AlertPage
      title={failedLabel}
      subtitle="Repositories whose latest pipeline run failed at least one stage. Each row shows which stages passed, failed and are still running — the failure column tells you which step to look at first."
      known={!!p?.known}
      notFetchedNote="The pipeline has not run yet. Repositories with a failed stage will appear once it reports."
      stats={stats}
      sections={
        p && p.known
          ? [
              {
                key: 'failed',
                heading: `Repositories with a failed stage (${p.failed.length})`,
                body:
                  p.failed.length === 0 ? (
                    <EmptyNote>No pipeline stages are failing.</EmptyNote>
                  ) : (
                    <AlertList>
                      {p.failed.map((r) => (
                        <li
                          key={`${r.owner}/${r.name}`}
                          className="border-b px-4 py-3 last:border-b-0"
                          style={{ borderColor: 'var(--hg-line)' }}
                        >
                          <div className="flex flex-wrap items-baseline gap-3">
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="min-w-0 flex-1 truncate text-[12.5px] font-medium no-underline hover:underline"
                              style={{ color: 'var(--hg-text)' }}
                            >
                              {r.owner}/{r.name}
                            </a>
                            <span
                              className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                              style={{ background: 'var(--hg-warning)', color: 'var(--hg-canvas)' }}
                            >
                              {r.label || 'failed'}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1 font-mono text-[11px]">
                            {r.phases.map((ph) => {
                              const state = ph.state.toLowerCase()
                              const isFailed = state === 'failed'
                              return (
                                <span
                                  key={ph.abbr}
                                  title={`${ph.name}: ${ph.state}`}
                                  className="rounded px-1.5 py-0.5"
                                  style={{
                                    background: isFailed ? 'var(--hg-warning)' : 'var(--hg-surface-raised)',
                                    color: isFailed
                                      ? 'var(--hg-canvas)'
                                      : state === 'ok'
                                        ? 'var(--hg-success)'
                                        : state === 'doing'
                                          ? 'var(--hg-text)'
                                          : 'var(--hg-text-muted)',
                                  }}
                                >
                                  {ph.abbr}
                                </span>
                              )
                            })}
                          </div>
                          <p className="mt-2 text-[11px]">
                            <a
                              href={`${r.url}/actions`}
                              target="_blank"
                              rel="noreferrer noopener"
                              style={{ color: 'var(--hg-text)' }}
                            >
                              Open the Actions runs for this repository →
                            </a>
                          </p>
                        </li>
                      ))}
                    </AlertList>
                  ),
              },
            ]
          : []
      }
      recovery={
        <>
          <p>
            <strong>Why this lit.</strong> A stage in the pipeline reported failure on at least one tracked repository. The failing stage is the one marked yellow above; the rest of the row shows what passed, so a cascade is distinguishable from a single break.
          </p>
          <p className="mt-2">
            <strong>What to do.</strong> Open the Actions tab linked on the row and find the latest run of the failing workflow — the error is in that run's logs. A transient failure (network, flaky test) usually clears itself when the next scheduled run passes; a real break needs a fix pushed and the workflow re-run.
          </p>
        </>
      }
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}
