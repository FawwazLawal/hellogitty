import { useState } from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import { STAGES, type Pipeline } from '../fixtures/dashboard'

/**
 * The pipeline panel.
 *
 * Seven stage chips over a bar of (Opened, Open, Merged, Closed, Rate), then a
 * one-line formula caption and the three controls the render carries at the
 * bottom. The whole thing has to fold legibly at 380px, which is the right
 * rail's declared width — the seven-column grid is the first thing that breaks,
 * so its chip sizing and font sizing are set for that width and comfortable
 * everywhere wider.
 *
 * The collapse chevron is wired to real local state. A chevron that only
 * rotated would be a lie: brief says a dead chevron is worse than no chevron.
 */
export function PipelinePanel({ pipeline }: { pipeline: Pipeline }) {
  const [collapsed, setCollapsed] = useState(false)

  const bodyId = 'pipeline-body'

  return (
    <Panel>
      <PanelHeader
        icon={<GitBranch size={14} aria-hidden="true" />}
        title="Pipeline"
      >
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--hg-text-muted)' }}>
          {pipeline.repoCount} repos by stage
        </span>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? 'Expand pipeline' : 'Collapse pipeline'}
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center justify-center"
          style={{ color: 'var(--hg-text-muted)' }}
        >
          <ChevronDown
            size={14}
            aria-hidden="true"
            style={{
              transform: collapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform var(--hg-motion-fast, 120ms) var(--hg-motion-ease, ease)',
            }}
          />
        </button>
      </PanelHeader>

      {!collapsed && (
        <div id={bodyId} className="px-4 py-3">
          {/* Stage grid. Seven columns, codes above, counts below. */}
          <div className="grid grid-cols-7 gap-1">
            {STAGES.map((stage) => {
              const count = pipeline.byStage.find((s) => s.stage === stage)?.count ?? 0
              const empty = count === 0
              return (
                <div key={stage} className="flex flex-col items-center">
                  <span
                    className="text-[10px] font-semibold tracking-wider"
                    style={{ color: 'var(--hg-text-muted)' }}
                  >
                    {stage}
                  </span>
                  <span
                    className="mt-0.5 text-[22px] font-bold leading-none tabular-nums"
                    style={{ color: empty ? 'var(--hg-text-muted)' : 'var(--hg-text)' }}
                  >
                    {count}
                  </span>
                </div>
              )
            })}
          </div>

          {/* KPI row. Four counts plus the rate; the rate's numeral is the one accent mark. */}
          <div
            className="mt-4 grid grid-cols-5 gap-2 border-t pt-3"
            style={{ borderColor: 'var(--hg-line)' }}
          >
            <PipelineStat label="Opened" value={pipeline.opened} />
            <PipelineStat label="Open" value={pipeline.open} />
            <PipelineStat label="Merged" value={pipeline.merged} />
            <PipelineStat label="Closed" value={pipeline.closed} />
            <PipelineStat label="Rate" value={`${pipeline.ratePercent}%`} accent />
          </div>

          <p
            className="mt-2 text-[11px] italic leading-snug"
            style={{ color: 'var(--hg-text-muted)' }}
          >
            Rate is merged ÷ (merged + closed). Open ones don't count yet.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="border px-2.5 py-1 text-[11px] font-medium"
              style={{
                borderColor: 'var(--hg-line-strong)',
                background: 'var(--hg-surface-raised)',
                color: 'var(--hg-text)',
              }}
            >
              Open
            </button>
            {/*
              No link when there is nothing to link to.

              This rendered an <a> with an empty body whenever `latest` was
              absent, which axe caught as link-name: a focusable control a
              screen reader announces as "link" with no name, and a sighted
              user cannot see at all. It surfaced the moment this panel moved
              off fixture data, because the endpoint carries no latest pull
              request yet — the fixture always had one, so the empty case had
              never actually rendered.

              An em dash says the same "nothing here" without putting an
              unusable control in the tab order.
            */}
            {pipeline.latest ? (
              <a
                href={`https://github.com/${pipeline.latest}`}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 flex-1 truncate text-[11px] tabular-nums underline-offset-2 hover:underline"
                style={{ color: 'var(--hg-accent)' }}
                title={pipeline.latest}
              >
                {pipeline.latest}
              </a>
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-[11px]"
                style={{ color: 'var(--hg-text-muted)' }}
              >
                —
              </span>
            )}
            <button
              type="button"
              className="border px-2.5 py-1 text-[11px] font-medium"
              style={{
                borderColor: 'var(--hg-line-strong)',
                background: 'var(--hg-surface-raised)',
                color: 'var(--hg-text)',
              }}
            >
              PR log
            </button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function PipelineStat({
  label,
  value,
  accent = false,
}: {
  label: string
  value: number | string
  accent?: boolean
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--hg-text-muted)' }}>
        {label}
      </span>
      <span
        className="mt-0.5 text-[16px] font-bold leading-none tabular-nums"
        style={{ color: accent ? 'var(--hg-accent)' : 'var(--hg-text)' }}
      >
        {value}
      </span>
    </div>
  )
}
