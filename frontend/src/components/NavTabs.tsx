import { useId, useState } from 'react'
import { Home, Briefcase, GitPullRequest, CircleDot, Calendar, MessageSquare, Boxes, Settings } from 'lucide-react'

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
      className="relative flex items-stretch gap-1 border-b px-4"
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
            className="relative flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] transition-colors"
            style={{
              color: isActive ? 'var(--hg-text)' : 'var(--hg-text-muted)',
              fontWeight: isActive ? 600 : 400,
            }}
          >
            <Icon size={14} aria-hidden="true" style={{ color: isActive ? 'var(--hg-accent)' : 'currentColor' }} />
            {label}
            {isActive && (
              <span
                aria-hidden="true"
                className="hg-decor absolute inset-x-1 bottom-0 h-[2px]"
                style={{ background: 'var(--hg-accent)' }}
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}
