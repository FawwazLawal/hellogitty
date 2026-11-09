import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WatchedPanel } from './WatchedPanel'
import { ThemeProvider } from '../theme/ThemeProvider'
import type { WatchItemFromApi } from '../data/dashboard'

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('WatchedPanel', () => {
  it('renders the empty state when nothing is watched', () => {
    renderInTheme(<WatchedPanel rows={[]} />)
    expect(screen.getByText(/Nothing watched/)).toBeDefined()
    expect(screen.getByText(/hellogitty watch owner\/name 123/)).toBeDefined()
    expect(screen.getByText('0 watched')).toBeDefined()
  })

  it('renders a row with the server status word, not a translation of it', () => {
    const rows: WatchItemFromApi[] = [
      {
        repo: 'acme/rocket',
        number: 123,
        title: 'engine sputters at altitude',
        url: 'https://github.com/acme/rocket/issues/123',
        status: 'CLAIMED',
        claimDetail: 'octocat',
        outside: false,
        seen: false,
        changedAt: '2026-11-07T10:00:00Z',
      },
    ]
    renderInTheme(<WatchedPanel rows={rows} />)
    expect(screen.getByText('acme/rocket#123')).toBeDefined()
    expect(screen.getByText(/engine sputters/)).toBeDefined()
    // The badge element carries the server's raw status word on a data
    // attribute, so a theme can style per state without the component
    // deciding what a label means.
    const badge = document.querySelector('[data-status="CLAIMED"]')
    expect(badge).not.toBeNull()
    expect(screen.getByText(/octocat/)).toBeDefined()
    expect(screen.getByText(/changed 2026-11-07T10:00:00Z/)).toBeDefined()
  })

  // Seen rows dim. Testing the opacity is brittle, but the data attribute
  // the row lifts into the DOM is not.
  it('marks seen rows with reduced opacity on the list item', () => {
    const rows: WatchItemFromApi[] = [
      {
        repo: 'acme/rocket',
        number: 1,
        title: 'ok',
        url: 'https://github.com/acme/rocket/issues/1',
        status: 'CLAIMED',
        claimDetail: '',
        outside: false,
        seen: true,
        changedAt: '',
      },
    ]
    renderInTheme(<WatchedPanel rows={rows} />)
    const li = screen.getByText(/ok/).closest('li') as HTMLElement
    expect(li.style.opacity).toBe('0.55')
  })

  it('opens issue links in a new tab with noopener', () => {
    const rows: WatchItemFromApi[] = [
      {
        repo: 'acme/rocket',
        number: 1,
        title: 'ok',
        url: 'https://github.com/acme/rocket/issues/1',
        status: 'OPEN',
        claimDetail: '',
        outside: false,
        seen: false,
        changedAt: '',
      },
    ]
    renderInTheme(<WatchedPanel rows={rows} />)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  // An outside row is in a repo the owner does not track (watched with
  // the eye on another page's issue). The row still renders — the rule
  // is that the display styles it subtler, not that it hides it.
  it('still renders outside rows', () => {
    const rows: WatchItemFromApi[] = [
      {
        repo: 'elsewhere/thing',
        number: 42,
        title: 'remote issue',
        url: 'https://github.com/elsewhere/thing/issues/42',
        status: 'OPEN',
        claimDetail: '',
        outside: true,
        seen: false,
        changedAt: '',
      },
    ]
    renderInTheme(<WatchedPanel rows={rows} />)
    expect(screen.getByText('elsewhere/thing#42')).toBeDefined()
    expect(screen.getByText('remote issue')).toBeDefined()
  })
})
