import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RecentIssuesPanel } from './RecentIssuesPanel'
import { ThemeProvider } from '../theme/ThemeProvider'
import type { RecentIssueFromApi } from '../data/recentIssues'

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

const rows: RecentIssueFromApi[] = [
  {
    number: 101,
    title: 'engine sputters at altitude',
    url: 'https://github.com/acme/rocket/issues/101',
    repo: 'acme/rocket',
    ago: '3h',
    agoTitle: '2026-11-09 07:00Z',
    labels: ['bug', 'propulsion'],
    taken: '',
    watched: false,
    k: 'acme/rocket#101',
    search: 'acme/rocket #101 engine sputters at altitude bug propulsion',
  },
  {
    number: 202,
    title: 'telemetry drops after launch',
    url: 'https://github.com/acme/rocket/issues/202',
    repo: 'acme/rocket',
    ago: '1d',
    agoTitle: '2026-11-08 09:00Z',
    labels: [],
    taken: 'claimed',
    watched: false,
    k: 'acme/rocket#202',
    search: 'acme/rocket #202 telemetry drops after launch',
  },
  {
    number: 1,
    title: 'battery check',
    url: 'https://github.com/sleepyco/lullaby/issues/1',
    repo: 'sleepyco/lullaby',
    ago: '2d',
    agoTitle: '2026-11-07 09:00Z',
    labels: ['chore'],
    taken: 'assigned',
    watched: false,
    k: 'sleepyco/lullaby#1',
    search: 'sleepyco/lullaby #1 battery check chore',
  },
]

describe('RecentIssuesPanel', () => {
  it('renders every row with repo#number, title and labels', () => {
    renderInTheme(<RecentIssuesPanel rows={rows} total={rows.length} />)
    expect(screen.getByText('acme/rocket#101')).toBeDefined()
    expect(screen.getByText('engine sputters at altitude')).toBeDefined()
    expect(screen.getByText('bug')).toBeDefined()
    expect(screen.getByText('battery check')).toBeDefined()
  })

  it('renders the taken badge with the server label verbatim', () => {
    renderInTheme(<RecentIssuesPanel rows={rows} total={rows.length} />)
    // Both server words appear — not translated.
    expect(screen.getByText('claimed')).toBeDefined()
    expect(screen.getByText('assigned')).toBeDefined()
  })

  it('filters by the search box against the server-composed search blob', () => {
    renderInTheme(<RecentIssuesPanel rows={rows} total={rows.length} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'propulsion' } })
    // Only the row whose search contains "propulsion" survives.
    expect(screen.getByText('engine sputters at altitude')).toBeDefined()
    expect(screen.queryByText('telemetry drops after launch')).toBeNull()
    expect(screen.queryByText('battery check')).toBeNull()
  })

  it('filters by the repo dropdown', () => {
    renderInTheme(<RecentIssuesPanel rows={rows} total={rows.length} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'sleepyco/lullaby' } })
    expect(screen.queryByText('engine sputters at altitude')).toBeNull()
    expect(screen.queryByText('telemetry drops after launch')).toBeNull()
    expect(screen.getByText('battery check')).toBeDefined()
  })

  it('shows "No issues match." when filters leave nothing', () => {
    renderInTheme(<RecentIssuesPanel rows={rows} total={rows.length} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'xxxnothingxxx' } })
    expect(screen.getByText('No issues match.')).toBeDefined()
  })

  // Empty rows AFTER a successful fetch is a real "nothing to show" state —
  // the panel reports it as such rather than as an unknown. The caller is
  // responsible for holding the panel out of the tree while loading.
  it('renders the "no open issues" note when the list is empty', () => {
    renderInTheme(<RecentIssuesPanel rows={[]} total={0} />)
    expect(screen.getByText(/No open issues/)).toBeDefined()
  })

  it('opens issue links in a new tab with noopener', () => {
    renderInTheme(<RecentIssuesPanel rows={rows} total={rows.length} />)
    const links = screen.getAllByRole('link')
    const issueLinks = links.filter((l) => (l as HTMLAnchorElement).target === '_blank')
    expect(issueLinks.length).toBeGreaterThan(0)
    for (const l of issueLinks) {
      expect((l as HTMLAnchorElement).rel).toContain('noopener')
    }
  })

  // The Show all anchor goes to /issues (same-tab); the templated page uses
  // the same navigation.
  it('links Show all to /issues', () => {
    renderInTheme(<RecentIssuesPanel rows={rows} total={42} />)
    const showAll = screen.getByRole('link', { name: 'Show all' }) as HTMLAnchorElement
    expect(showAll.getAttribute('href')).toBe('/issues')
  })
})
