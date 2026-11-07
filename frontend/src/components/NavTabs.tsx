import { useId, useState } from 'react'
import { Home, Briefcase, GitPullRequest, CircleDot, Calendar, MessageSquare, Boxes, Settings } from 'lucide-react'
import { TAB_NOTCH } from './chrome/Ornament'

/**
 * The navigation tabs.
 *
 * ADR-UI-002 §6 lists navigation tabs among the signature components. In all
 * three renders the active tab is marked by a bright underline plus a lift in
 * the label's weight and colour.
 *
 * NOT COLOUR ALONE. The active tab carries three cues — the underline, a bolder
 * label, and `aria-current="page"` — because §5's quality bar and the design-QA
 * note both ask for states identifiable without colour. A user with a red/green
 * deficiency reading the Vermilion identity would otherwise be told which tab
 * is active by a red bar and nothing else.
 */

const TABS = [
  { id: 'dashboard', label: 'Dashboard', Icon: Home },
  { id: 'work', label: 'Your work', Icon: Briefcase },
  { id: 'pipeline', label: 'PR Pipeline', Icon: GitPullRequest },
  { id: 'issues', label: 'Issues', Icon: CircleDot },
  { id: 'tracked', label: 'Tracked repos', Icon: Calendar },
  { id: 'conversations', label: 'Conversations', Icon: MessageSquare },
  { id: 'repos', label: 'Your repositories', Icon: Boxes },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const

export function NavTabs() {
  const [active, setActive] = useState<string>('dashboard')
  const navId = useId()

  return (
    <nav
      aria-label="Primary"
      id={navId}
      /*
        `overflow-x-auto` so eight tabs scroll inside the bar instead of
        widening the document. At 390px the row is 822px long, and without this
        it set the page's scrollWidth and dragged every other panel out with it.
        Horizontal scrolling is the right answer for a tab bar specifically —
        wrapping to two rows moves the content below it on every narrow load.
      */
      className="relative flex items-stretch gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none] [&::-webkit-scrollbar]{display:none}"
      style={{ borderColor: 'var(--hg-line)', background: 'color-mix(in srgb, var(--hg-canvas) 82%, transparent)' }}
    >
      {TABS.map(({ id, label, Icon }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            aria-current={isActive ? 'page' : undefined}
            className="relative isolate flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-[12.5px] transition-colors"
            style={{
              color: isActive ? 'var(--hg-text)' : 'var(--hg-text-muted)',
              fontWeight: isActive ? 600 : 400,
            }}
          >
            <Icon size={14} aria-hidden="true" style={{ color: isActive ? 'var(--hg-accent)' : 'currentColor' }} />
            {label}
            {isActive && (
              <>
                {/*
                  The active tab is a plate seated into the bar, with its
                  trailing edge cut at an angle — the renders do this, and a
                  plain underline was the laziest part of the first pass.
                  z-index -1 inside the button's own stacking context so the
                  label and icon stay above it.
                */}
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
          </button>
        )
      })}
    </nav>
  )
}
