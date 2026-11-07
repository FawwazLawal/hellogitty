import { Masthead } from './components/Masthead'
import { NavTabs } from './components/NavTabs'
import { KpiRail } from './components/KpiRail'
import { ConversationsPanel } from './components/ConversationsPanel'
import { TrackedRepos } from './components/TrackedRepos'
import { PipelinePanel } from './components/PipelinePanel'
import { YourWorkPanel } from './components/YourWorkPanel'
import { useTheme } from './theme/ThemeProvider'
import { useDashboard } from './data/dashboard'
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

  /*
    PHASE 3, the first vertical slice on real Go data.

    Only the KPI rail is live. Everything below still renders from the frozen
    fixture, and the server says which is which in `partial` rather than
    leaving the client to infer it. That is the "safe legacy path" §7 asks for,
    held inside one build: if the endpoint is unreachable the rail degrades and
    the rest of the dashboard is untouched.
  */
  const dashboard = useDashboard()

  const liveTiles = dashboard.data?.kpis
  const tiles = liveTiles
    ? DASHBOARD.kpis.map((fixture) => {
        const live = liveTiles.find((k) => k.id === fixture.id)
        return live
          ? { ...fixture, value: live.value, label: live.label, sublabel: live.sublabel }
          : fixture
      })
    : DASHBOARD.kpis

  const unknown = new Set((liveTiles ?? []).filter((k) => !k.known).map((k) => k.id))

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

      <main className="min-w-0 overflow-x-hidden px-4 pb-[200px] pt-3">
        <KpiRail
          tiles={tiles}
          state={{
            loading: dashboard.isPending,
            error: dashboard.error ? dashboard.error.message : null,
            unknown,
            onRetry: () => void dashboard.refetch(),
          }}
        />

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
