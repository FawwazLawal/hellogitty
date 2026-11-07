import { YourMoveAlert } from './YourMoveAlert'
import { WatchedClaimedAlert } from './WatchedClaimedAlert'
import { WatchedClosedAlert } from './WatchedClosedAlert'
import { CheckFailedAlert } from './CheckFailedAlert'
import { RepoHealthAlert } from './RepoHealthAlert'
import { UnresolvedThreadsAlert } from './UnresolvedThreadsAlert'
import { DataStaleAlert } from './DataStaleAlert'
import { RepoFlaggedAlert } from './RepoFlaggedAlert'
import { StageFailedAlert } from './StageFailedAlert'
import { ApiLowAlert } from './ApiLowAlert'

/**
 * Pick the alert page for `/alerts/<name>`.
 *
 * Not a router — a pathname match. Same shape as App.tsx's top-level
 * dispatch, and for the same reason: every page in this subtree maps to a
 * document the server would also render, so there is nothing a router
 * would do for us.
 */
export function AlertsRouter({ pathname }: { pathname: string }) {
  switch (pathname) {
    case '/alerts/your-move':
      return <YourMoveAlert />
    case '/alerts/watched-claimed':
      return <WatchedClaimedAlert />
    case '/alerts/watched-closed':
      return <WatchedClosedAlert />
    case '/alerts/check-failed':
      return <CheckFailedAlert />
    case '/alerts/repo-dormant':
      return <RepoHealthAlert health="DORMANT" />
    case '/alerts/repo-slow':
      return <RepoHealthAlert health="SLOW" />
    case '/alerts/unresolved-threads':
      return <UnresolvedThreadsAlert />
    case '/alerts/data-stale':
      return <DataStaleAlert />
    case '/alerts/repo-flagged':
      return <RepoFlaggedAlert />
    case '/alerts/stage-failed':
      return <StageFailedAlert />
    case '/alerts/api-low':
      return <ApiLowAlert />
    default:
      // The server routes unknown /alerts/* paths to 404; render a tiny
      // explainer here for the case where this component is reached via
      // an unexpected pathname (a deep-link typo, say).
      return (
        <main className="mx-auto max-w-[920px] px-4 pb-24 pt-8">
          <h1 className="text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>Unknown alert</h1>
          <p className="mt-2 text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            There is no alert page at <code>{pathname}</code>.
          </p>
        </main>
      )
  }
}
