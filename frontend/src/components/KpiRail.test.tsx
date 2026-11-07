import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KpiRail } from './KpiRail'
import { ThemeProvider } from '../theme/ThemeProvider'
import { DASHBOARD } from '../fixtures/dashboard'

/**
 * The first component tests in this codebase.
 *
 * ADR-UI-002 §3 lists "Vitest + React Testing Library (required)", and until
 * now React Testing Library was installed and imported by nothing — 57 passing
 * assertions, none of which rendered a component. The suite could not have
 * caught a component that renders the wrong thing, only a token that measures
 * wrong.
 *
 * These start where the risk is highest rather than where coverage is easiest:
 * the rail is the one surface whose job is to tell the owner how much needs
 * them, so the difference between "nothing needs you" and "we have not looked"
 * is the thing worth holding a test against.
 */

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('KpiRail', () => {
  it('renders each tile with its figure and label', () => {
    renderInTheme(<KpiRail tiles={DASHBOARD.kpis} />)
    expect(screen.getByText('Needs you')).toBeDefined()
    expect(screen.getByText('11')).toBeDefined()
    expect(screen.getByText('4,755')).toBeDefined()
  })

  it('AN UNKNOWN FIGURE IS A DASH, NOT A ZERO', () => {
    renderInTheme(
      <KpiRail tiles={DASHBOARD.kpis} state={{ unknown: new Set(['needs', 'prs']) }} />,
    )
    // The two unknown tiles must not show their fixture values...
    expect(screen.queryByText('11')).toBeNull()
    expect(screen.queryByText('17')).toBeNull()
    // ...and must not show a zero, which would read as "nothing needs you".
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    // The known ones still show their figures.
    expect(screen.getByText('80')).toBeDefined()
  })

  it('shows a dash for every tile while loading', () => {
    renderInTheme(<KpiRail tiles={DASHBOARD.kpis} state={{ loading: true }} />)
    expect(screen.getAllByText('—')).toHaveLength(DASHBOARD.kpis.length)
  })

  it('gives every tile an accessible name from its own content', () => {
    // WCAG 2.5.3: the accessible name must contain the visible text. This
    // shipped broken — aria-label="Needs you: 11" against visible "11 Needs
    // you" — so the name now comes from content and this holds it there.
    renderInTheme(<KpiRail tiles={DASHBOARD.kpis} />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(DASHBOARD.kpis.length)
    for (const link of links) {
      expect(link.getAttribute('aria-label'), 'an aria-label here re-introduces the Label in Name failure').toBeNull()
      expect(link.textContent?.trim().length).toBeGreaterThan(0)
    }
  })
})
