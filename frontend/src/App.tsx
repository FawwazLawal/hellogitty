import type { ReactNode } from 'react'
import { lazy, Suspense, useState } from 'react'
import { Masthead } from './components/Masthead'
import { NavTabs } from './components/NavTabs'
import { KpiRail } from './components/KpiRail'
import { ChecksPanel } from './components/ChecksPanel'
import { SecurityPanel } from './components/SecurityPanel'
import { WatchedPanel } from './components/WatchedPanel'
import { RecentIssuesPanel } from './components/RecentIssuesPanel'
import { FeedPanel } from './components/FeedPanel'
import { YourReposPanel } from './components/YourReposPanel'
import { useSettings } from './data/settings'
import { useSecurity } from './data/security'
import { useRecentIssues } from './data/recentIssues'
import { useFeed } from './data/feed'
import { ConversationsPanel } from './components/ConversationsPanel'
import { TrackedRepos } from './components/TrackedRepos'
import { PipelinePanel } from './components/PipelinePanel'
import { YourWorkPanel } from './components/YourWorkPanel'
import { DashboardFooter } from './components/DashboardFooter'
import { useDashboard, toTrackedRepo, toPipelineView, toWorkView } from './data/dashboard'
import { useArt } from './art'
import { DASHBOARD } from './fixtures/dashboard'
import { usePageTitle } from './hooks/usePageTitle'
import { useLayout } from './layout/useLayout'
import { useShortcuts } from './layout/useShortcuts'
import type { PanelId } from './layout/schema'

/*
  The dashboard panel-layout dialog. Lazy because it opens on a
  user action — a Layout button in the dashboard header — and
  keeping it out of the entry chunk saves the budget for the
  work it enables. See /src/layout/* for the storage boundary,
  reducer, hook, Grip and keyboard shortcuts this dialog sits on
  top of; #282 ships them together.
*/
const LayoutDialog = lazy(() =>
  import('./layout/LayoutDialog').then((m) => ({ default: m.LayoutDialog })),
)

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
/*
  The help page, on demand.

  It carries the stemmed search ranker — a stemmer, a stop-word list, an
  alternatives table and a scoring pass — which exists to serve one search box
  on one page that a reader opens when they are stuck. Everyone else was paying
  for it on every page load.

  Same reasoning as /repos and /alerts below: weight that serves one destination
  belongs in that destination's chunk.
*/
/*
  Every page component is lazy, with ONE exception: the dashboard is the
  landing route and lives inline in App — splitting it off would add a
  round trip on the one page where that is felt. Everything else below
  takes the same shape: `lazy()` wrapping a dynamic import that unwraps
  the named export back to a default. The pattern is one line of real
  work; the repetition is the point. A `map` would hide one piece of
  copy-paste risk behind a worse one (a missing route silently doing
  nothing while the entry chunk gets smaller).

  The seven below were eager until #322. The size budget caught the
  previous four one at a time, each under deadline from unrelated work;
  converting the rest together ends it, and means ONE decision about the
  `<Suspense>` fallback instead of seven. The fallback is load-bearing —
  `data-loading="true"` is what lets gates wait for real content rather
  than asserting against a spinner — so getting it wrong seven times is
  more likely than getting it wrong once.
*/
const HelpPage = lazy(() =>
  import('./components/HelpPage').then((m) => ({ default: m.HelpPage })),
)

const AlertsRouter = lazy(() =>
  import('./components/alerts/AlertsRouter').then((m) => ({ default: m.AlertsRouter })),
)

const ReposPage = lazy(() =>
  import('./components/ReposPage').then((m) => ({ default: m.ReposPage })),
)

const ListPage = lazy(() =>
  import('./components/ListPage').then((m) => ({ default: m.ListPage })),
)

const SettingsPage = lazy(() =>
  import('./components/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)

const PipelinePage = lazy(() =>
  import('./components/PipelinePage').then((m) => ({ default: m.PipelinePage })),
)

const WorkPage = lazy(() =>
  import('./components/WorkPage').then((m) => ({ default: m.WorkPage })),
)

const IssuesPage = lazy(() =>
  import('./components/IssuesPage').then((m) => ({ default: m.IssuesPage })),
)

const YourReposPage = lazy(() =>
  import('./components/YourReposPage').then((m) => ({ default: m.YourReposPage })),
)

const ConversationsPage = lazy(() =>
  import('./components/ConversationsPage').then((m) => ({ default: m.ConversationsPage })),
)

const FeedPage = lazy(() =>
  import('./components/FeedPage').then((m) => ({ default: m.FeedPage })),
)

/**
 * The one place the Suspense fallback is written.
 *
 * `data-loading="true"` is the signal gates and tests wait on to tell a
 * placeholder from real content. Every lazy route goes through this
 * component so the attribute cannot be forgotten on a new page — the same
 * reasoning as colocating the lazy() calls above: the repetition is where
 * mistakes land, and one source of truth for the markup means one place
 * to audit.
 *
 * `label` is per-route only because the earlier manual fallbacks already
 * varied ("Loading repositories…", "Loading help…", "Loading…"). Keeping
 * them honours what readers were seeing before the refactor; a generic
 * "Loading…" is the no-label default.
 */
function Lazy({ children, label = 'Loading…' }: { children: ReactNode; label?: string }) {
  return (
    <Suspense
      fallback={
        <main
          data-loading="true"
          className="px-4 py-10 text-[12px]"
          style={{ color: 'var(--hg-text-muted)' }}
        >
          {label}
        </main>
      }
    >
      {children}
    </Suspense>
  )
}

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
  const settings = useSettings()
  const security = useSecurity()
  const recentIssues = useRecentIssues()
  const feed = useFeed()

  /*
    The panel-layout engine. `useLayout` reads storage on mount
    (or forces `focus` in extension-popup mode via ?ext=popup),
    and `useShortcuts` attaches one window-level listener for
    c/e/1–9. The dialog state is here so the Layout button can
    toggle it; the dialog is lazy, so mounting the suspense
    boundary at `layoutOpen` means the chunk only loads when
    the user asks.
  */
  const layout = useLayout({
    configDefault: settings.data?.config.layoutDefault ?? null,
    search: typeof location !== 'undefined' ? location.search : '',
  })
  useShortcuts({ state: layout.state, dispatch: layout.dispatch })
  const [layoutOpen, setLayoutOpen] = useState(false)

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

      {view === 'settings' && <Lazy><SettingsPage /></Lazy>}
      {view === 'pipeline' && <Lazy><PipelinePage /></Lazy>}
      {view === 'work' && <Lazy><WorkPage /></Lazy>}
      {view === 'issues' && <Lazy><IssuesPage /></Lazy>}
      {view === 'repos' && <Lazy label="Loading repositories…"><ReposPage /></Lazy>}
      {view === 'your-repos' && <Lazy><YourReposPage /></Lazy>}
      {view === 'conversations' && <Lazy><ConversationsPage /></Lazy>}
      {view === 'help' && <Lazy label="Loading help…"><HelpPage /></Lazy>}
      {view === 'alerts' && <Lazy><AlertsRouter pathname={pathname} /></Lazy>}
      {view === 'feed' && <Lazy><FeedPage /></Lazy>}
      {view === 'list' && <Lazy><ListPage /></Lazy>}

      {view === 'dashboard' && (
      <main className="min-w-0 overflow-x-hidden px-4 pb-[200px] pt-3">
        <div className="flex items-center justify-between gap-2">
          <KpiRail
            tiles={tiles}
            state={{
              loading: dashboard.isPending,
              error: dashboard.error ? dashboard.error.message : null,
              unknown,
              onRetry: () => void dashboard.refetch(),
            }}
          />
        </div>

        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setLayoutOpen(true)}
            className="border px-2 py-1 text-[11px]"
            style={{
              borderColor: 'var(--hg-line-strong)',
              color: 'var(--hg-text)',
              background: 'var(--hg-surface-raised)',
            }}
            aria-haspopup="dialog"
          >
            Layout
          </button>
        </div>

        {(() => {
          /*
            Build the panels map once per render. Each entry is the
            JSX for a panel id; the layout state picks which are
            rendered, in which order, and whether hidden / folded.
            Hidden panels are skipped entirely — they are
            re-mountable by unhiding — folded panels render but
            carry a data attribute the CSS reads to hide the body.
          */
          const panels: Partial<Record<PanelId, ReactNode>> = {
            'your-work': <YourWorkPanel work={work} user={answered ? dashboard.data.work.login || DASHBOARD.user : DASHBOARD.user} />,
            conversations: <ConversationsPanel data={conversations} />,
            'your-repos': answered ? <YourReposPanel work={dashboard.data.work} /> : null,
            tracked: <TrackedRepos repos={repos} totals={repoTotals} />,
            feed: feed.data ? <FeedPanel rows={feed.data.rows} known={feed.data.known} /> : null,
            watched: answered ? <WatchedPanel rows={dashboard.data.watched} /> : null,
            issues: recentIssues.data ? <RecentIssuesPanel rows={recentIssues.data.issues} total={recentIssues.data.total} /> : null,
            security: security.data ? <SecurityPanel data={security.data} /> : null,
            pipeline: <PipelinePanel pipeline={pipeline} />,
            checks: settings.data ? <ChecksPanel data={settings.data} /> : null,
          }
          const render = (col: 'main' | 'rail') =>
            layout.state[col].map((id) => {
              if (layout.state.hidden.includes(id)) return null
              const node = panels[id]
              if (!node) return null
              const folded = layout.state.folded.includes(id)
              return (
                <div
                  key={id}
                  data-panel={id}
                  data-folded={folded || undefined}
                  className="hg-panel-slot"
                >
                  {node}
                </div>
              )
            })
          return (
            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="flex min-w-0 flex-col gap-3">{render('main')}</div>
              <div className="flex flex-col gap-3">{render('rail')}</div>
            </div>
          )
        })()}

        {/*
          The dialog is lazy: the Suspense boundary is only reached
          when `layoutOpen` is true, so the chunk loads on the
          first Layout click, not before.
        */}
        {layoutOpen && (
          <Suspense fallback={null}>
            <LayoutDialog
              open={layoutOpen}
              onClose={() => setLayoutOpen(false)}
              state={layout.state}
              dispatch={layout.dispatch}
            />
          </Suspense>
        )}
      </main>
      )}

      {/*
        Dashboard footer: Last check · GitHub API · repo count. Sits OUTSIDE
        the <main> so its own <footer> element gets the `contentinfo` role
        (a `<footer>` nested inside `<main>` has no landmark role; moving it
        here is the cheapest way to make it one). Repo count comes from the
        SAME document the repository table reads — the footer takes the
        prop from here, not from the settings doc, so the two numbers
        can't disagree. See DashboardFooter for the one-fact-one-source
        rule.
      */}
      {view === 'dashboard' && <DashboardFooter repoCount={repoTotals.repoCount} />}
    </div>
  )
}
