import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { YourReposPanel } from './YourReposPanel'
import { ThemeProvider } from '../theme/ThemeProvider'
import type { WorkFromApi, WorkItemFromApi } from '../data/dashboard'

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

const item = (over: Partial<WorkItemFromApi> = {}): WorkItemFromApi => ({
  key: 'acme/rocket#1',
  kind: 'pr',
  repo: 'alice/myrepo',
  number: 1,
  title: 'ready for review',
  url: 'https://github.com/alice/myrepo/pull/1',
  why: 'ready-for-review',
  ago: '3h',
  agoTitle: '2026-11-09 07:00Z',
  level: 'ok',
  yourMove: true,
  status: 'OPEN',
  ...over,
})

const base: WorkFromApi = {
  known: true,
  partial: false,
  login: 'alice',
  needYou: 1,
  total: 2,
  items: [item()],
}

describe('YourReposPanel', () => {
  // Known-vs-empty is the first invariant: before the first refresh we must
  // say so, and we must NOT render a "no activity" claim that reads like a
  // completed read. Same rule as every other panel's empty state.
  it('shows the pre-refresh message when work.known is false', () => {
    renderInTheme(<YourReposPanel work={{ ...base, known: false, items: [] }} />)
    expect(screen.getByText(/once HelloGitty has refreshed/)).toBeDefined()
    expect(screen.queryByText(/No activity/)).toBeNull()
  })

  it('filters work.items to repos whose owner matches work.login', () => {
    const work: WorkFromApi = {
      ...base,
      items: [
        item({ key: 'a', repo: 'alice/myrepo', title: 'mine', yourMove: true }),
        item({ key: 'b', repo: 'bob/other', title: 'not mine', yourMove: true }),
      ],
    }
    renderInTheme(<YourReposPanel work={work} />)
    expect(screen.getByText('mine')).toBeDefined()
    expect(screen.queryByText('not mine')).toBeNull()
  })

  // The panel defaults to "needs you" — the rail's whole purpose is to
  // distinguish that from everything else, and showing everything by default
  // would wash out the signal.
  it('defaults to needs-you only, and reveals waiting rows on Show all', () => {
    const work: WorkFromApi = {
      ...base,
      items: [
        item({ key: 'a', repo: 'alice/myrepo', title: 'needs me', yourMove: true }),
        item({ key: 'b', repo: 'alice/myrepo', title: 'waiting', yourMove: false }),
      ],
    }
    renderInTheme(<YourReposPanel work={work} />)
    expect(screen.getByText('needs me')).toBeDefined()
    expect(screen.queryByText('waiting')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getByText('needs me')).toBeDefined()
    expect(screen.getByText('waiting')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Only needs me' })).toBeDefined()
  })

  it('reports counts of needs-you and waiting in the header', () => {
    const work: WorkFromApi = {
      ...base,
      items: [
        item({ key: 'a', repo: 'alice/myrepo', yourMove: true }),
        item({ key: 'b', repo: 'alice/myrepo', yourMove: false }),
        item({ key: 'c', repo: 'alice/myrepo', yourMove: false }),
      ],
    }
    renderInTheme(<YourReposPanel work={work} />)
    // One "need you", two "waiting"; headers render them separately so a
    // single number can't accidentally merge the two signals.
    expect(screen.getByText('1')).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
  })

  // Empty needs-you with items in waiting is a specific state — the panel
  // must not say "nothing in your repositories" when there is in fact
  // waiting work. It should point the user at Show all.
  it('says "nothing needs you" with a nudge to Show all when only waiting rows exist', () => {
    const work: WorkFromApi = {
      ...base,
      items: [item({ key: 'b', yourMove: false, repo: 'alice/myrepo' })],
    }
    renderInTheme(<YourReposPanel work={work} />)
    expect(screen.getByText(/Nothing needs you/)).toBeDefined()
    // "Show all" appears twice: the header button and the copy nudge.
    // The nudge is the one that signals "there is waiting work to see".
    expect(screen.getByText(/Press ("|“)Show all/)).toBeDefined()
  })

  // No items at all in the owner's repos is yet another distinct state.
  it('says "no activity" when the owner has no rows in their own repos', () => {
    const work: WorkFromApi = {
      ...base,
      login: 'alice',
      items: [item({ key: 'a', repo: 'bob/other' })],
    }
    renderInTheme(<YourReposPanel work={work} />)
    expect(screen.getByText(/No activity/)).toBeDefined()
  })

  it('opens row links in a new tab with noopener', () => {
    renderInTheme(<YourReposPanel work={base} />)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })
})
