import { Home, Briefcase, GitPullRequest, CircleDot, Calendar, MessageSquare, Boxes, Settings } from 'lucide-react'
import { TAB_NOTCH } from './chrome/Ornament'

/**
 * The navigation tabs.
 *
 * THESE ARE LINKS, NOT BUTTONS, and that is the whole point of this file.
 *
 * They shipped as `<button>` elements driving local state: clicking "Issues"
 * moved the highlight and did nothing else. Seven of the eight tabs were dead
 * on a dashboard being used daily — the most immediate hole in the React UI,
 * and invisible to every test we had, because a highlight moving is exactly
 * what a tab appears to do.
 *
 * Each tab now points at the route that serves it. The dashboard is this page;
 * the rest are still rendered by the Go templates and will be until each is
 * converted. That is not a workaround — ADR-UI-002 §7 Phase 4 requires deep
 * links be preserved through the conversion, and a tab that navigates to the
 * working legacy page is how a half-migrated app stays usable.
 *
 * NO ROUTER. §3 warns that "an unnecessary second router ... increases
 * operational risk", and there is nothing to route: every destination is a
 * document the server renders. Plain anchors give back-button behaviour,
 * middle-click, open-in-new-tab and copy-link for free, none of which a click
 * handler would.
 *
 * NOT COLOUR ALONE. The active tab carries the seated plate, a bolder label and
 * `aria-current`, so which one you are on does not depend on seeing a hue.
 *
 * When a page is converted, its `href` changes and nothing else here does.
 */

interface Tab {
  id: string
  label: string
  href: string
  Icon: typeof Home
  /** False while the Go templates still render this destination. */
  react: boolean
}

const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/', Icon: Home, react: true },
  { id: 'work', label: 'Your work', href: '/work', Icon: Briefcase, react: true },
  { id: 'pipeline', label: 'PR Pipeline', href: '/pipeline', Icon: GitPullRequest, react: true },
  { id: 'issues', label: 'Issues', href: '/issues', Icon: CircleDot, react: true },
  { id: 'tracked', label: 'Tracked repos', href: '/repos', Icon: Calendar, react: false },
  { id: 'conversations', label: 'Conversations', href: '/conversations', Icon: MessageSquare, react: false },
  { id: 'repos', label: 'Your repositories', href: '/your-repos', Icon: Boxes, react: false },
  { id: 'settings', label: 'Settings', href: '/settings', Icon: Settings, react: true },
]

/**
 * Which tab the current URL belongs to.
 *
 * Read from the pathname rather than held in state, so the highlight is a fact
 * about where you are instead of a memory of what you clicked. Those are the
 * same thing until the back button, a bookmark or a reload disagrees.
 */
export function activeIdFor(pathname: string): string {
  // Longest match first, so "/your-repos" is not claimed by a shorter prefix.
  const match = [...TABS]
    .filter((t) => t.href !== '/')
    .sort((a, b) => b.href.length - a.href.length)
    .find((t) => pathname === t.href || pathname.startsWith(t.href + '/'))
  return match ? match.id : 'dashboard'
}

export function NavTabs({
  pathname = typeof location !== 'undefined' ? location.pathname : '/',
}: {
  pathname?: string
}) {
  const activeId = activeIdFor(pathname)

  return (
    <nav
      aria-label="Primary"
      className="relative flex items-stretch gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none]"
      style={{ borderColor: 'var(--hg-line)', background: 'color-mix(in srgb, var(--hg-canvas) 82%, transparent)' }}
    >
      {TABS.map(({ id, label, href, Icon }) => {
        const isActive = activeId === id
        return (
          <a
            key={id}
            href={href}
            /*
              `aria-current="page"`, not a tab role. These navigate to separate
              documents, so they are links in a navigation landmark; calling
              them tabs would promise a tablist's arrow-key behaviour that full
              page loads cannot deliver.
            */
            aria-current={isActive ? 'page' : undefined}
            className="relative isolate flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-[12.5px] no-underline transition-colors"
            style={{
              color: isActive ? 'var(--hg-text)' : 'var(--hg-text-muted)',
              fontWeight: isActive ? 600 : 400,
            }}
          >
            <Icon size={14} aria-hidden="true" style={{ color: isActive ? 'var(--hg-accent)' : 'currentColor' }} />
            {label}
            {isActive && (
              <>
                <span
                  aria-hidden="true"
                  className="hg-decor absolute inset-0 -z-10"
                  style={{
                    background: 'var(--hg-surface)',
                    clipPath: TAB_NOTCH,
                    borderTop: '1px solid var(--hg-line-strong)',
                  }}
                />
                <span
                  aria-hidden="true"
                  className="hg-decor absolute inset-x-0 bottom-0 h-[2px]"
                  style={{ background: 'var(--hg-accent)' }}
                />
              </>
            )}
          </a>
        )
      })}
    </nav>
  )
}

/** Exported for the tests, which check the bar links where it claims to. */
export const NAV_TABS = TABS
