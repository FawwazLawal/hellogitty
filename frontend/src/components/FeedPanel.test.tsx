import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeedPanel } from './FeedPanel'
import { ThemeProvider } from '../theme/ThemeProvider'
import type { FeedRow } from '../data/feed'

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

const row = (over: Partial<FeedRow> = {}): FeedRow => ({
  id: 'r1',
  kind: 'issue-opened',
  label: 'New issue',
  repo: 'acme/rocket',
  number: 101,
  text: 'engine sputters at altitude',
  url: 'https://github.com/acme/rocket/issues/101',
  actor: 'octocat',
  at: 'just now',
  key: 'acme/rocket#101',
  acked: false,
  watched: false,
  ...over,
})

describe('FeedPanel', () => {
  // "Known" is the key signal: before the first poll, the panel must say
  // the feed appears after GitHub has been checked — NOT "nothing new",
  // which is a real positive answer about a server that has given none.
  it('says the feed appears after the first check when known is false', () => {
    renderInTheme(<FeedPanel rows={[]} known={false} />)
    expect(screen.getByText(/appears once HelloGitty has checked GitHub/)).toBeDefined()
    expect(screen.queryByText(/Nothing new/)).toBeNull()
  })

  it('says nothing-new when the fetch completed with no unacked rows', () => {
    renderInTheme(<FeedPanel rows={[]} known={true} />)
    expect(screen.getByText(/Nothing new/)).toBeDefined()
  })

  it('renders unacked rows with their label, text and repo#number', () => {
    renderInTheme(<FeedPanel rows={[row()]} known={true} />)
    expect(screen.getByText('New issue')).toBeDefined()
    expect(screen.getByText('engine sputters at altitude')).toBeDefined()
    expect(screen.getByText(/acme\/rocket #101 · just now/)).toBeDefined()
    expect(screen.getByText('1')).toBeDefined() // "N new" counter
  })

  it('hides acked rows', () => {
    renderInTheme(
      <FeedPanel
        rows={[row({ id: 'a', acked: true, text: 'already seen' }), row({ id: 'b', acked: false })]}
        known={true}
      />,
    )
    expect(screen.queryByText('already seen')).toBeNull()
    expect(screen.getByText('engine sputters at altitude')).toBeDefined()
  })

  // Panel caps at eight rows. The ninth and beyond appear as a "N more on
  // the full feed" footer linking to /feed.
  it('shows at most eight rows and reports the rest as "N more on the full feed"', () => {
    const many: FeedRow[] = Array.from({ length: 10 }, (_, i) =>
      row({ id: `r${i}`, text: `row ${i}` }),
    )
    renderInTheme(<FeedPanel rows={many} known={true} />)
    expect(screen.getByText('row 0')).toBeDefined()
    expect(screen.getByText('row 7')).toBeDefined()
    expect(screen.queryByText('row 8')).toBeNull()
    expect(screen.queryByText('row 9')).toBeNull()
    expect(screen.getByText(/2 more on the/)).toBeDefined()
  })

  it('opens row links in a new tab with noopener', () => {
    renderInTheme(<FeedPanel rows={[row()]} known={true} />)
    const link = screen.getByRole('link', { name: /engine sputters/ }) as HTMLAnchorElement
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  it('links "Open in a window" to /feed in a new tab', () => {
    renderInTheme(<FeedPanel rows={[row()]} known={true} />)
    const open = screen.getByRole('link', { name: 'Open in a window' }) as HTMLAnchorElement
    expect(open.getAttribute('href')).toBe('/feed')
    expect(open.target).toBe('_blank')
    expect(open.rel).toContain('noopener')
  })
})
