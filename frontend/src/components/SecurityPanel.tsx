import { ShieldAlert } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import type { SecurityDoc } from '../data/security'

/**
 * DevSecOps — recent high-severity CVEs and workflow tips.
 *
 * ADR-UI-002 §4: a projection of the feed `security.Cache` already holds
 * server-side. The panel does nothing clever: it lists what the server
 * reports, in the order the server reported it (sorted by severity on
 * the Go side). Rendering the severity label from the server's own
 * vocabulary (CRITICAL / HIGH / MEDIUM / LOW) means the badge colour
 * stays a styling choice here rather than a second place that could
 * disagree about what severity a CVE is.
 *
 * The three states this panel has — "error with no data", "error with
 * stale data beside it", and "data, no error" — are treated as different
 * things rather than collapsed. An error alone renders as an error note
 * and no list; an error with a non-empty `cves` list renders BOTH, in
 * that order, because the previous fetch's data is still the best
 * answer we have and silencing it would hide information the user cares
 * about. "Known" is not a flag on this document: an empty list AFTER
 * `fetchedAt` is set is a real "no high-severity CVEs in the last 7
 * days" answer, not an unknown.
 */

const severityToken: Record<SecurityDoc['cves'][number]['severity'], string> = {
  CRITICAL: 'var(--hg-sev-critical, #b71c1c)',
  HIGH: 'var(--hg-sev-high, #d9480f)',
  MEDIUM: 'var(--hg-sev-medium, #b47e00)',
  LOW: 'var(--hg-sev-low, #526e79)',
}

export function SecurityPanel({ data }: { data: SecurityDoc }) {
  const hasCves = data.cves.length > 0
  const hasTips = data.tips.length > 0

  return (
    <Panel>
      <PanelHeader icon={<ShieldAlert size={14} aria-hidden="true" />} title="DevSecOps">
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          CVEs &amp; tips
        </span>
      </PanelHeader>
      <div className="px-4 py-3">
        {data.error && (
          <p
            className="mb-3 text-[12px]"
            style={{ color: 'var(--hg-text-muted)' }}
            role="status"
          >
            NVD fetch failed.{' '}
            <small style={{ color: 'var(--hg-sev-high, #d9480f)' }}>({data.error})</small>
          </p>
        )}

        {hasCves ? (
          <ul className="flex flex-col gap-2">
            {data.cves.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-3 border-b pb-2 last:border-b-0 last:pb-0"
                style={{ borderColor: 'var(--hg-line)' }}
              >
                <span
                  className="mt-0.5 shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{
                    background: severityToken[c.severity],
                    color: 'var(--hg-on-accent, #fff)',
                  }}
                >
                  {c.severity}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-[12px] font-medium underline decoration-dotted underline-offset-2"
                    style={{ color: 'var(--hg-text)' }}
                  >
                    {c.id}
                  </a>
                  <span className="text-[11.5px]" style={{ color: 'var(--hg-text)' }}>
                    {c.description}
                  </span>
                  <span className="text-[10.5px]" style={{ color: 'var(--hg-text-muted)' }}>
                    {c.published}
                    {c.packages && c.packages.length > 0 && (
                      <>
                        {' · '}
                        <span>{c.packages.join(', ')}</span>
                      </>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          !data.error && (
            <p className="text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
              No high-severity CVEs published in the last 7 days.
            </p>
          )
        )}

        {hasTips && (
          <div
            className="mt-4 border-t pt-3"
            style={{ borderColor: 'var(--hg-line)' }}
          >
            <h3
              className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--hg-text-muted)' }}
            >
              Tips for your workflow
            </h3>
            {data.tips.map((t, i) => (
              <p
                key={i}
                className="mb-1 text-[11.5px] last:mb-0"
                style={{
                  color: t.level === 'warn' ? 'var(--hg-sev-medium, #b47e00)' : 'var(--hg-text)',
                }}
              >
                {t.text}
              </p>
            ))}
          </div>
        )}

        {data.fetchedAt && (
          <p
            className="mt-3 text-[10.5px]"
            style={{ color: 'var(--hg-text-muted)' }}
          >
            Updated {data.fetchedAt}
          </p>
        )}
      </div>
    </Panel>
  )
}
