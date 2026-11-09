import { lazy, Suspense } from 'react'
import { Masthead } from './components/Masthead'
import { NavTabs } from './components/NavTabs'
import { SettingsPage } from './components/SettingsPage'
import { PipelinePage } from './components/PipelinePage'
import { WorkPage } from './components/WorkPage'
import { IssuesPage } from './components/IssuesPage'
import { HelpPage } from './components/HelpPage'
import { YourReposPage } from './components/YourReposPage'
import { ConversationsPage } from './components/ConversationsPage'
import { FeedPage } from './components/FeedPage'
import { KpiRail } from './components/KpiRail'
import { ConversationsPanel } from './components/ConversationsPanel'
import { TrackedRepos } from './components/TrackedRepos'
import { PipelinePanel } from './components/PipelinePanel'
import { YourWorkPanel } from './components/YourWorkPanel'
import { useDashboard, toTrackedRepo, toPipelineView, toWorkView } from './data/dashboard'
import { useArt } from './art'
import { DASHBOARD } from './fixtures/dashboard'
import { usePageTitle } from './hooks/usePageTitle'

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
/**
 * ReposPage is LOADED ON DEMAND, and that is a size decision, not a style one.
 *
 * It is the only page that imports `motion`, and motion costs 44 KB gzipped —
 * measured, by building the commit before it and the commit after. Imported at
 * the top level it rode in the single shared chunk, so every reader of every
 * page paid 44 KB for one card-reorder animation on /repos that most of them
 * never see. That is what pushed the bundle from 137 KB to 181 KB, through a
 * 150 KB ceiling nobody was watching.
 *
 * Splitting it here puts motion in the /repos chunk, where the people who use
 * /repos pay for it and nobody else does.
 *
 * The other pages stay eagerly imported on purpose: none of them carries a
 * dependency worth a second network round trip, and a Suspense flash on a page
 * that would have rendered instantly is a worse trade than the bytes.
 */
/**
 * The eleven /alerts/* pages, also on demand.
 *
 * Same reasoning, different shape: these are never an entry point. A reader
 * arrives at an alert from a link because something needs attention, which
 * means the fetch happens while they are already reading a sentence about
 * what went wrong. Eleven components' worth of markup does not belong in the
 * chunk that renders the dashboard.
 */
/*
  EVERY SUSPENSE FALLBACK CARRIES data-loading="true", and nothing else does.

  A page that has not arrived yet still renders a <main>, so any check that
  enumerates a page's contents can land on the placeholder and find nothing
  wrong with it — passing by finding nothing, which is the same failure as a
  gate whose selector stopped matching. The nav lives in the shell outside
  these boundaries, so waiting for the nav does not help: it resolves while
  the real <main> is still a fallback.

  `main:not([data-loading])` is the signal that real content has painted. It
  works for every page without a per-page marker, and a future lazy page gets
  it for free by using this same fallback shape.
*/
const AlertsRouter = lazy(() =>
  import('./components/alerts/AlertsRouter').then((m) => ({ default: m.AlertsRouter })),
)

const ReposPage = lazy(() =>
  import('./components/ReposPage').then((m) => ({ default: m.ReposPage })),
)

/*
  ListPage is lazy for the same reason as ReposPage: it is not an entry
  point. Readers arrive at /list from a pipeline number or a /your-repos
  overview tile, and the fetch happens while they are already reading. The
  page itself is small, but keeping it out of the entry chunk leaves the
  150 KB budget with the headroom it needs for the pages that are entry
  points.
*/
const ListPage = lazy(() =>
  import('./components/ListPage').then((m) => ({ default: m.ListPage })),
)

/**
 * Which view this URL is.
 *
 * Not a router. §3 warns that "an unnecessary second router ... increases
 * operational risk", and with two views a switch on the pathname is the whole
 * of what a router would do for us. The moment a third view needs nested
 * routes or params, this becomes an argument for one — until then it is not.
 */
type View =
  | 'dashboard'
  | 'settings'
  | 'pipeline'
  | 'work'
  | 'issues'
  | 'repos'
  | 'your-repos'
  | 'conversations'
  | 'help'
  | 'alerts'
  | 'feed'
  | 'list'

/**
 * Still not a router.
 *
 * §3 warns an unnecessary second router increases operational risk, and this
 * table is the whole of what one would do for us: every destination is a
 * document the server renders, with no nested routes and no params. The moment
 * one of those is needed, this becomes the argument for a router rather than
 * an excuse not to have one.
 *
 * ORDERING MATTERS where one prefix prefixes another. `viewFor` walks this
 * list in order and takes the first prefix match, so a longer path that
 * starts with a shorter one must come first — e.g. `/your-repos` has to sit
 * before `/repos` or it gets swallowed. Nothing currently in the table does,
 * but new entries are the moment that silently breaks.
 */
const ROUTES: { prefix: string; view: View }[] = [
  { prefix: '/settings', view: 'settings' },
  { prefix: '/pipeline', view: 'pipeline' },
  { prefix: '/work', view: 'work' },
  { prefix: '/issues', view: 'issues' },
  // Kept longest-first as a habit, though `viewFor` matches
  // `pathname === prefix || pathname.startsWith(prefix + '/')`, so
  // /your-repos is never swallowed by /repos — /your-repos neither equals
  // /repos nor starts with /repos/. Order here is harmless either way.
  { prefix: '/your-repos', view: 'your-repos' },
  { prefix: '/repos', view: 'repos' },
  { prefix: '/conversations', view: 'conversations' },
  { prefix: '/help', view: 'help' },
  // Every /alerts/* path, one view. AlertsRouter picks the specific alert
  // from the pathname — same reasoning as the top-level dispatch: each
  // destination is a document the server also serves.
  { prefix: '/alerts', view: 'alerts' },
  { prefix: '/feed', view: 'feed' },
  { prefix: '/list', view: 'list' },
]

function viewFor(pathname: string): View {
  const hit = ROUTES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))
  return hit ? hit.view : 'dashboard'
}

export default function App() {
  const pathname = typeof location !== 'undefined' ? location.pathname : '/'
  const view = viewFor(pathname)
  // The dashboard is the only view with no per-page component — it is
  // inline JSX in this function — so App owns its title. Every other
  // view's page component sets its own via usePageTitle, and gets the
  // null branch here so the parent effect does not clobber the child's.
  // The templated /legacy dashboard has `<title>HelloGitty</title>`, same
  // as the shell's static default in index.html.
  usePageTitle(view === 'dashboard' ? 'HelloGitty' : null)
  // No `identity` read here any more: the registry resolves per identity, so
  // this component no longer needs to know which one it is in.
  const footerArt = useArt('footer')

  /*
    EVERY SECTION OF THIS PAGE IS LIVE.

    This began as Phase 3's single vertical slice — the KPI rail on real Go
    data, everything below it still drawn from the frozen fixture, with the
    document carrying a `partial` flag so the client could not quietly assume
    it had everything. Phases 3 and 4 landed the rest: repositories, pipeline,
    work and conversations all read from the same document now.

    The flag outlived the staging it described. It stayed hardcoded `true`
    long after the last section went live, so a document that carried
    everything kept announcing that it did not — the same shape of error as
    rendering unknown as zero, pointing the other way. It is gone rather than
    pinned to `false`, because a flag that can only hold one value is a signal
    nobody can trust and someone will eventually branch on.

    The fixture remains, but only as the fallback for NO ANSWER — see
    `answered` below, which is the distinction that replaced it.
  */
  const dashboard = useDashboard()

  const liveTiles = dashboard.isSuccess ? dashboard.data?.kpis : undefined
  const tiles = liveTiles
    ? DASHBOARD.kpis.map((fixture) => {
        const live = liveTiles.find((k) => k.id === fixture.id)
        return live
          ? { ...fixture, value: live.value, label: live.label, sublabel: live.sublabel }
          : fixture
      })
    : DASHBOARD.kpis

  const unknown = new Set((liveTiles ?? []).filter((k) => !k.known).map((k) => k.id))

  /*
    PHASE 4, first increment: the repository table on live data.

    The fixture stays as the fallback rather than being deleted. §7 is explicit
    that legacy paths come out "only after replacement passes regression tests
    and approval" — and approval has not happened. Until it does, an endpoint
    that cannot be reached shows the fixture rather than an empty table, and
    the dashboard degrades instead of going blank.
  */
  /*
    AN EMPTY ANSWER IS AN ANSWER.

    This first shipped as `liveRepos.length > 0 ? live : fixture`, which treats
    "the server says you track nothing" the same as "the server did not
    answer". On a live dashboard that renders openai/codex and flutter/flutter
    to someone who tracks neither — demo data wearing the clothes of real data,
    which is worse than an empty table because nothing about it looks wrong.

    The fixture is a fallback for NO ANSWER, not for a quiet one. Once the
    query succeeds, what it returned is the truth even when it is empty.
  */
  const answered = dashboard.isSuccess && dashboard.data !== undefined
  const repos = answered
    ? dashboard.data.repos.map((r) => toTrackedRepo(r, dashboard.data!.generatedAt))
    : DASHBOARD.repos
  const repoTotals = answered ? dashboard.data.repoTotals : DASHBOARD.repoTotals

  /*
    The three rails, off fixture at last.

    These were the most misleading thing on the page: a pipeline showing
    "20 17 1 14 3 3 12 / Rate 57%" and a work rail showing "11 need you", none
    of it the owner's. Numbers that look exactly like data and are not are
    worse than an empty panel, for the same reason the repository table was.
  */
  const pipeline = answered ? toPipelineView(dashboard.data.pipeline, dashboard.data.repoTotals.repoCount) : DASHBOARD.pipeline
  const work = answered ? toWorkView(dashboard.data.work) : DASHBOARD.work
  const conversations = answered
    ? { quiet: dashboard.data.conversations.quiet, total: dashboard.data.conversations.total }
    : DASHBOARD.conversations

  return (
    <div className="relative isolate min-h-full" style={{ background: 'var(--hg-canvas)' }}>
      {/* The footer band, fixed to the viewport bottom, behind everything. */}
      <div
        aria-hidden="true"
        className="hg-decor pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-[180px] bg-bottom bg-no-repeat"
        style={{
          backgroundImage: footerArt.kind === 'present' ? `url(${footerArt.url})` : undefined,
          backgroundSize: '100% 100%',
        }}
      />

      <Masthead data={DASHBOARD} />
      <NavTabs pathname={pathname} />

      {view === 'settings' && <SettingsPage />}
      {view === 'pipeline' && <PipelinePage />}
      {view === 'work' && <WorkPage />}
      {view === 'issues' && <IssuesPage />}
      {view === 'repos' && (
        <Suspense fallback={<main data-loading="true" className="px-4 py-10 text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>Loading repositories…</main>}>
          <ReposPage />
        </Suspense>
      )}
      {view === 'your-repos' && <YourReposPage />}
      {view === 'conversations' && <ConversationsPage />}
      {view === 'help' && <HelpPage />}
      {view === 'alerts' && (
        <Suspense fallback={<main data-loading="true" className="px-4 py-10 text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>Loading…</main>}>
          <AlertsRouter pathname={pathname} />
        </Suspense>
      )}
      {view === 'feed' && <FeedPage />}
      {view === 'list' && (
        <Suspense fallback={<main data-loading="true" className="px-4 py-10 text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>Loading…</main>}>
          <ListPage />
        </Suspense>
      )}

      {view === 'dashboard' && (
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
            <ConversationsPanel data={conversations} />
            <TrackedRepos repos={repos} totals={repoTotals} />
          </div>

          <div className="flex flex-col gap-3">
            <PipelinePanel pipeline={pipeline} />
            <YourWorkPanel work={work} user={answered ? dashboard.data.work.login || DASHBOARD.user : DASHBOARD.user} />
          </div>
        </div>
      </main>
      )}
    </div>
  )
}
