import { useAlerts } from '../../data/alerts'
import { AlertPage, type Stat } from '../AlertPage'
import { AlertList, EmptyNote } from './parts'

/** /alerts/repo-flagged — repositories the pipeline tool flagged. */
export function RepoFlaggedAlert() {
  const q = useAlerts()
  const d = q.data
  const p = d?.pipeline
  const flaggedLabel = d?.labels.flagged || 'Flagged'

  const stats: Stat[] = p
    ? [
        {
          label: flaggedLabel,
          value: p.flagged.length,
          known: p.known,
          tone: p.flagged.length > 0 ? 'caution' : 'neutral',
        },
        { label: 'In pipeline', value: d!.totals.targetCount, known: p.known },
        { label: 'Tracked total', value: d!.totals.repoCount, known: true },
      ]
    : []

  return (
    <AlertPage
      title={flaggedLabel}
      subtitle="Repositories your pipeline has flagged for attention — the label and the stage come from the pipeline, so what to do about it is pipeline-specific."
      known={!!p?.known}
      notFetchedNote="The pipeline has not run yet. Flagged repositories will appear once it reports."
      stats={stats}
      sections={
        p && p.known
          ? [
              {
                key: 'flagged',
                heading: `Flagged repositories (${p.flagged.length})`,
                body:
                  p.flagged.length === 0 ? (
                    <EmptyNote>No pipeline repositories are flagged.</EmptyNote>
                  ) : (
                    <AlertList>
                      {p.flagged.map((r) => (
                        <li
                          key={`${r.owner}/${r.name}`}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
                          style={{ borderColor: 'var(--hg-line)' }}
                        >
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="min-w-0 truncate text-[12.5px] font-medium no-underline hover:underline"
                            style={{ color: 'var(--hg-text)' }}
                          >
                            {r.owner}/{r.name}
                          </a>
                          <span className="font-mono text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
                            {r.stage ? `stage: ${r.stage}` : ''}
                          </span>
                          <span
                            className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                            style={{ background: 'var(--hg-accent-fill)', color: 'var(--hg-accent-ink)' }}
                          >
                            {r.label || 'flagged'}
                          </span>
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
            <strong>Why this lit.</strong> The pipeline raised a flag on each listed repository. The flag's meaning is set by the pipeline itself, not by the dashboard.
          </p>
          <p className="mt-2">
            <strong>What to do.</strong> Open the repository on GitHub and inspect the stage shown above — the pipeline's output for that stage names the gate and what it looked at. If the flag is a false positive the pipeline tool clears it; if it is real, address what the gate flagged and the pipeline will re-score on its next run.
          </p>
        </>
      }
      loading={q.isPending}
      error={q.error ? q.error.message : null}
      onRetry={() => void q.refetch()}
    />
  )
}
