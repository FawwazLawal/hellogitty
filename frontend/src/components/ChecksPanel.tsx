import { Activity } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import type { SettingsDoc } from '../data/settings'

/**
 * The Checks panel — a key/value readout of how HelloGitty is polling GitHub.
 *
 * ADR-UI-002 §4: a projection of what the server already knows, with no
 * computed figures of our own. Each field is either a timestamp the server
 * has (lastPollUtc, nextPollUtc, resetUtc), a startup constant it was
 * configured with (intervalMinutes, workIntervalMinutes), or a measurement
 * it recorded on the last cycle (lastCycleMs, callsPerCycle).
 *
 * THE "UNKNOWN IS NOT ZERO" RULES THIS PANEL CARRIES.
 *
 * `polling.known` says one thing: at least one repo poll has completed
 * since the process started. The templated page gates its "not yet /
 * starting" readouts on that: if no poll has completed, there is nothing
 * useful to say about last/next/intervals, and the UI writes "not yet"
 * and "starting".
 *
 * `lastCycleMs` and `callsPerCycle` carry their OWN unknown signal. They
 * come from `tel.CycleDuration` and `tel.CycleRequests`, which the server
 * only records when a cycle completes end-to-end. A rate-limited cycle
 * ticks `polling.known` from the per-repo poll it finished first, but
 * leaves these two at zero. If the panel gated the em-dash on `!known`,
 * a rate-limited run would render "0 ms" and "0 calls" — real numbers
 * for a cycle that aborted, which is the exact shape of lie the project
 * calls "unknown rendered as zero". So the em-dash gate on these two
 * fields is `value === 0`, independent of `known`. Tested in
 * ChecksPanel.test.tsx `renders em-dash when polling.known is true but
 * the cycle never finished recording`.
 *
 * `workIntervalMinutes` is a startup constant. In production the binary
 * always wires it from a const in main.go; zero only appears in test
 * fakes and malformed configs. Rendering em-dash on zero — the same
 * treatment as the other two — matches the panel's own discipline and
 * avoids a case where "0 min" reads as "refreshes immediately".
 */

type Checks = Pick<SettingsDoc, 'polling' | 'api'>

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`
  const m = s / 60
  return `${m.toFixed(1)} min`
}

export function ChecksPanel({ data }: { data: Checks }) {
  const { polling, api } = data

  return (
    <Panel>
      <PanelHeader icon={<Activity size={14} aria-hidden="true" />} title="Checks" />
      <div className="px-4 py-3">
        <dl
          className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-[12px]"
          style={{ color: 'var(--hg-text)' }}
        >
          <dt style={{ color: 'var(--hg-text-muted)' }}>Last check finished</dt>
          <dd>
            {polling.known ? (
              <>
                {polling.lastPollUtc} <span style={{ color: 'var(--hg-text-muted)' }}>UTC</span>
              </>
            ) : (
              <span style={{ color: 'var(--hg-text-muted)' }}>not yet</span>
            )}
          </dd>

          <dt style={{ color: 'var(--hg-text-muted)' }}>Next check</dt>
          <dd>
            {polling.known ? (
              <>
                {polling.nextPollUtc} <span style={{ color: 'var(--hg-text-muted)' }}>UTC</span>
              </>
            ) : (
              <span style={{ color: 'var(--hg-text-muted)' }}>starting</span>
            )}
          </dd>

          <dt style={{ color: 'var(--hg-text-muted)' }}>Checks run every</dt>
          <dd>{polling.intervalMinutes} min</dd>

          <dt style={{ color: 'var(--hg-text-muted)' }}>Last check took</dt>
          <dd>
            {polling.lastCycleMs > 0 ? (
              fmtMs(polling.lastCycleMs)
            ) : (
              <span style={{ color: 'var(--hg-text-muted)' }}>—</span>
            )}
          </dd>

          <dt style={{ color: 'var(--hg-text-muted)' }}>API calls per check</dt>
          <dd>
            {api.callsPerCycle > 0 ? (
              api.callsPerCycle
            ) : (
              <span style={{ color: 'var(--hg-text-muted)' }}>—</span>
            )}
          </dd>

          <dt style={{ color: 'var(--hg-text-muted)' }}>API quota resets</dt>
          <dd>
            {api.known && api.resetUtc ? (
              <>
                {api.resetUtc} <span style={{ color: 'var(--hg-text-muted)' }}>UTC</span>
              </>
            ) : (
              <span style={{ color: 'var(--hg-text-muted)' }}>—</span>
            )}
          </dd>

          <dt style={{ color: 'var(--hg-text-muted)' }}>Your work refresh</dt>
          <dd>
            {polling.workIntervalMinutes > 0 ? (
              `${polling.workIntervalMinutes} min`
            ) : (
              <span style={{ color: 'var(--hg-text-muted)' }}>—</span>
            )}
          </dd>

          <dt style={{ color: 'var(--hg-text-muted)' }}>Data file</dt>
          <dd>
            <a
              href="/snapshot.json"
              className="underline decoration-dotted underline-offset-2"
              style={{ color: 'var(--hg-text)' }}
            >
              snapshot.json
            </a>
          </dd>
        </dl>
      </div>
    </Panel>
  )
}
