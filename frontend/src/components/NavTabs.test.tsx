import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NavTabs, NAV_TABS, activeIdFor } from './NavTabs'
import { ThemeProvider } from '../theme/ThemeProvider'

/**
 * The navigation bar shipped with seven of its eight tabs dead — buttons
 * driving local state, so clicking "Issues" moved the highlight and navigated
 * nowhere. Nothing caught it, because a highlight moving is exactly what a tab
 * looks like it should do.
 *
 * These assert the two things that failure consisted of: that every tab is a
 * link with a destination, and that the highlight follows the URL rather than
 * a click.
 */

function renderAt(pathname: string) {
  return render(
    <ThemeProvider>
      <NavTabs pathname={pathname} />
    </ThemeProvider>,
  )
}

describe('NavTabs', () => {
  it('EVERY TAB IS A LINK WITH A REAL DESTINATION', () => {
    renderAt('/')
    const links = screen.getAllByRole('link')
    expect(links, 'a tab that is not a link cannot navigate').toHaveLength(NAV_TABS.length)
    for (const link of links) {
      const href = link.getAttribute('href')
      expect(href, `"${link.textContent?.trim()}" has no href`).toBeTruthy()
      expect(href!.startsWith('/'), `"${href}" is not an in-app path`).toBe(true)
    }
  })

  it('no tab is a button', () => {
    renderAt('/')
    // A button here is the exact regression this file exists to prevent.
    expect(screen.queryAllByRole('button'), 'tabs navigate, so they are links').toHaveLength(0)
  })

  it('marks the current page, from the URL rather than from a click', () => {
    renderAt('/issues')
    const current = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('Issues')
  })

  it('falls back to the dashboard for an unrecognised path', () => {
    expect(activeIdFor('/')).toBe('dashboard')
    expect(activeIdFor('/nothing-here')).toBe('dashboard')
  })

  it('does not let a shorter path claim a longer one', () => {
    // "/repos" and "/your-repos" both exist; prefix matching done carelessly
    // gives the wrong highlight on one of them.
    expect(activeIdFor('/your-repos')).toBe('repos')
    expect(activeIdFor('/repos')).toBe('tracked')
  })

  it('every destination is one the server actually serves', () => {
    // Guards against a tab pointing at a route that does not exist — the quiet
    // version of the same bug, where the tab navigates to a 404.
    const served = new Set(['/', '/work', '/pipeline', '/issues', '/repos', '/conversations', '/your-repos', '/settings'])
    for (const t of NAV_TABS) {
      expect(served.has(t.href), `${t.label} points at ${t.href}, which no handler route matches`).toBe(true)
    }
  })
})
