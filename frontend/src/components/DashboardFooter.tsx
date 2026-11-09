import { useSettings } from '../data/settings'
import { useLiveClock } from '../data/clock'

/**
 * The dashboard footer status line.
 *
 * Templated `/legacy` dashboard carries this row (`web/index.html:4737`):
 *   Last check {ago} · GitHub API N of 5000 this hour · M repos — Reloads every 5 min · …
 * React shipped without it. The figures were already on the page in other
 * forms, but the rolled-up telemetry line was gone and a reader checking
 * "when did this last update" had nowhere to look.
 *
 * SOURCE OF TRUTH — one fact, one source. Repo count comes from the
 * dashboard document (`repoTotals.repoCount`), passed in as a prop, because
 * that is the document the repository table reads from and the two numbers
 * must never disagree. Last-poll, API quota, interval and pipeline-target
 * count come from the settings document — the dashboard doesn't carry them,
 * so there's nothing to drift against. If a future change adds polling data
 * to the dashboard document, the footer should switch sources and the
 * settings copy here should be dropped, not maintained in parallel.
 *
 * LIVE AGO — the "N minutes ago" stamp uses `useLiveClock()` to recompute on
 * every tick, matching the templated page which runs a 60s timer on
 * `data-since`. A React component that formats once on render would say
 * "2 minutes ago" an hour later, which is worse than the templated version
 * and exactly the drift this issue exists to close.
 */

// The templated foot-note constants. Pinned here so a test can assert React
// and templated agree without reading them out of the running pages.
const REFRESH_MINUTES = 5
const WORK_MINUTES = 5

interface DashboardFooterProps {
  /** From the dashboard document — the SAME number the repository-table
   * header shows. Passing it in rather than reading `useSettings().repos.count`
   * is deliberate; see the component comment. */
  repoCount: number
}

export function DashboardFooter({ repoCount }: DashboardFooterProps) {
  const settings = useSettings()
  const now = useLiveClock()

  const d = settings.data

  // Prefer not to render before the first settings response: a partial
  // footer that fills in halfway is the kind of micro-jitter that catches
  // the eye more than a one-frame absence would.
  if (!d) return null

  const polling = d.polling
  const api = d.api
  const inPipeline = d.hasPipeline ? d.repos.inPipeline : null

  const lastCheck = polling.known
    ? relativeAgo(now, parseIso(polling.lastPollUtc))
    : null

  return (
    <footer
      aria-label="Dashboard status"
      className="mx-auto max-w-[1400px] px-5 pb-6 pt-2 text-[12px]"
      style={{ color: 'var(--hg-text-muted)' }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="whitespace-nowrap">
          <span className="font-medium" style={{ color: 'var(--hg-text)' }}>Last check</span>{' '}
          {lastCheck
            ? <time dateTime={polling.lastPollUtc} title={`${polling.lastPollUtc} UTC`}>{lastCheck}</time>
            : <span style={{ color: 'var(--hg-text-muted)' }}>not yet</span>}
        </span>

        <span aria-hidden="true">·</span>

        <span className="whitespace-nowrap">
          <span className="font-medium" style={{ color: 'var(--hg-text)' }}>GitHub API</span>{' '}
          {api.known ? (
            <>
              <span className="font-mono tabular-nums">{api.used.toLocaleString()}</span>
              {' of '}
              <span className="font-mono tabular-nums">{api.limit.toLocaleString()}</span>
              {' this hour'}
              <ApiGauge percent={api.percent} />
            </>
          ) : (
            <span>no data yet</span>
          )}
        </span>

        <span aria-hidden="true">·</span>

        <span className="whitespace-nowrap">
          <span className="font-mono tabular-nums" style={{ color: 'var(--hg-text)' }}>{repoCount}</span>{' '}
          repos
          {inPipeline !== null && (
            <>
              {' · '}
              <span className="font-mono tabular-nums" style={{ color: 'var(--hg-text)' }}>{inPipeline}</span>
              {' in the pipeline'}
            </>
          )}
        </span>
      </div>

      <p className="mt-1 text-[11px]">
        Reloads every {REFRESH_MINUTES} minutes · checks your repositories every{' '}
        {polling.intervalMinutes} minutes and your work every {WORK_MINUTES} · runs only on this
        computer
      </p>
    </footer>
  )
}

function ApiGauge({ percent }: { percent: number }) {
  // Visual pill matching the templated footer's `.gauge` (hot at ≥90%).
  // Using an actual meter element so a screen reader can describe it,
  // but it also doubles as a visible fill bar.
  const clamped = Math.max(0, Math.min(100, percent))
  const hot = clamped >= 90
  return (
    <span
      role="meter"
      aria-label={`${clamped} percent of the hourly quota used`}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className="ml-1 inline-block h-[6px] w-[36px] overflow-hidden rounded-sm align-middle"
      style={{ background: 'var(--hg-surface-raised)' }}
    >
      <span
        aria-hidden="true"
        className="block h-full"
        style={{
          width: `${clamped}%`,
          background: hot ? 'var(--hg-danger)' : 'var(--hg-accent)',
        }}
      />
    </span>
  )
}

/**
 * The server sends `lastPollUtc` as a string already formatted for display
 * ("14:37:02", or similar). We need a `Date` to compute "N minutes ago"
 * — so we rebuild one from the UTC time it carries. The server also sends
 * a `polling.known` flag, so an unparseable string here is a shape
 * mismatch rather than a legitimate empty, and treating it as "not yet"
 * is safer than crashing on bad input.
 */
function parseIso(s: string): Date | null {
  if (!s) return null
  // The settings endpoint sends "HH:MM:SS UTC"-style strings for lastPollUtc,
  // not an ISO timestamp — we don't have the date here. The relative
  // calculation needs a real moment, so we assume today and roll back a
  // day if the parsed moment is in the future, which happens around the
  // UTC day boundary.
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (!match) {
    // ISO fallback for a future server change that starts sending RFC3339.
    const t = Date.parse(s)
    return Number.isFinite(t) ? new Date(t) : null
  }
  const [, hh, mm, ss] = match
  const base = new Date()
  base.setUTCHours(Number(hh), Number(mm), Number(ss ?? '0'), 0)
  // Future → yesterday. A one-minute slop lets "just now" land at zero
  // rather than flipping to "23 hours ago".
  if (base.getTime() > Date.now() + 60_000) base.setUTCDate(base.getUTCDate() - 1)
  return base
}

/**
 * The templated page's own ladder — "just now", "N minutes ago", "N hours ago",
 * "N days ago". Kept in one place rather than per-row so if the owner tunes
 * the wording we move it once.
 */
export function relativeAgo(now: Date, then: Date | null): string | null {
  if (!then) return null
  const delta = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000))
  if (delta < 45) return 'just now'
  if (delta < 90) return 'a minute ago'
  const minutes = Math.round(delta / 60)
  if (minutes < 45) return `${minutes} minutes ago`
  if (minutes < 90) return 'an hour ago'
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days < 2) return 'a day ago'
  return `${days} days ago`
}

// Named exports for tests that pin the refresh-cadence constants as literals
// rather than re-reading them out of the component.
export { REFRESH_MINUTES, WORK_MINUTES }
