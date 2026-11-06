import { Masthead } from './components/Masthead'
import { NavTabs } from './components/NavTabs'
import { KpiRail } from './components/KpiRail'
import { ConversationsPanel } from './components/ConversationsPanel'
import { TrackedRepos } from './components/TrackedRepos'
import { PipelinePanel } from './components/PipelinePanel'
import { YourWorkPanel } from './components/YourWorkPanel'
import { useTheme } from './theme/ThemeProvider'
import { DASHBOARD } from './fixtures/dashboard'

/**
 * The dashboard shell.
 *
 * Phase 1 of ADR-UI-002: "a self-contained React/Vite prototype of the exact
 * dashboard shell ... The prototype is not a replacement for the live app."
 * Nothing here talks to the Go service; everything renders from `DASHBOARD`,
 * the parsed fixture.
 *
 * The layout is the render's: a full-bleed masthead, the nav beneath it, then a
 * two-column body — the KPI rail spanning both, the conversations panel and the
 * repo table on the left, pipeline and your-work rails on the right. At narrow
 * widths the right rail drops under the main column rather than shrinking,
 * because the pipeline grid stops being readable below about 300px.
 */
export default function App() {
  const { identity } = useTheme()

  return (
    <div className="relative isolate min-h-full" style={{ background: 'var(--hg-canvas)' }}>
      {/* The footer band, fixed to the viewport bottom, behind everything. */}
      <div
        aria-hidden="true"
        className="hg-decor pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-[180px] bg-bottom bg-no-repeat"
        style={{
          backgroundImage:
            identity === 'vermilion'
              ? 'url(/art/vermilion-footer.webp)'
              : `url(/art/footer-${identity}.webp)`,
          backgroundSize: '100% 100%',
        }}
      />

      <Masthead data={DASHBOARD} />
      <NavTabs />

      <main className="px-4 pb-[200px] pt-3">
        <KpiRail tiles={DASHBOARD.kpis} />

        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-3">
            <ConversationsPanel data={DASHBOARD.conversations} />
            <TrackedRepos repos={DASHBOARD.repos} totals={DASHBOARD.repoTotals} />
          </div>

          <div className="flex flex-col gap-3">
            <PipelinePanel pipeline={DASHBOARD.pipeline} />
            <YourWorkPanel work={DASHBOARD.work} user={DASHBOARD.user} />
          </div>
        </div>
      </main>
    </div>
  )
}
