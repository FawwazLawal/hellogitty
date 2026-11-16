import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SecurityPanel } from './SecurityPanel'
import { ThemeProvider } from '../theme/ThemeProvider'
import type { SecurityDoc } from '../data/security'

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

const feed: SecurityDoc = {
  cves: [
    {
      id: 'CVE-2026-0001',
      description: 'An attacker can escalate privileges via a crafted token.',
      severity: 'HIGH',
      published: '2026-11-03',
      url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-0001',
      packages: ['acme'],
    },
  ],
  tips: [{ text: 'Rotate your GitHub tokens this week.', level: 'warn' }],
  fetchedAt: '2026-11-08T10:00:00Z',
}

describe('SecurityPanel', () => {
  it('renders CVE rows with severity, id, description, published date, and packages', () => {
    renderInTheme(<SecurityPanel data={feed} />)
    expect(screen.getByText('HIGH')).toBeDefined()
    const link = screen.getByRole('link', { name: 'CVE-2026-0001' }) as HTMLAnchorElement
    expect(link.href).toContain('/CVE-2026-0001')
    expect(link.rel).toContain('noopener')
    expect(screen.getByText(/crafted token/)).toBeDefined()
    expect(screen.getByText(/2026-11-03/)).toBeDefined()
    expect(screen.getByText(/acme/)).toBeDefined()
  })

  it('renders tips below the CVE list with the "Tips for your workflow" heading', () => {
    renderInTheme(<SecurityPanel data={feed} />)
    expect(screen.getByText('Tips for your workflow')).toBeDefined()
    expect(screen.getByText(/Rotate your GitHub tokens/)).toBeDefined()
  })

  it('renders the fetchedAt timestamp when present', () => {
    renderInTheme(<SecurityPanel data={feed} />)
    expect(screen.getByText(/Updated 2026-11-08T10:00:00Z/)).toBeDefined()
  })

  // Empty `cves` AFTER a successful fetch is a real answer — "no high-severity
  // CVEs in the last 7 days" — not an unknown. This is the "unknown is not
  // zero" rule applied to a list: an empty list after fetchedAt is set is
  // different from an empty list before any fetch has happened.
  it('renders a "no CVEs" note when the list is empty and no error', () => {
    const empty: SecurityDoc = {
      cves: [],
      tips: [],
      fetchedAt: '2026-11-08T10:00:00Z',
    }
    renderInTheme(<SecurityPanel data={empty} />)
    expect(screen.getByText(/No high-severity CVEs/)).toBeDefined()
  })

  // The three states this panel distinguishes:
  //   (a) error with no data        → error line, no list, no empty note
  //   (b) error with stale cves     → BOTH error line and list, in order
  //   (c) data with no error        → list only
  it('renders the error line WITH the stale cve list when both are present', () => {
    const stale: SecurityDoc = { ...feed, error: 'NVD 503' }
    renderInTheme(<SecurityPanel data={stale} />)
    expect(screen.getByText(/NVD fetch failed/)).toBeDefined()
    // The previous fetch's cves are still shown — silencing them would hide
    // information the user cares about.
    expect(screen.getByText('CVE-2026-0001')).toBeDefined()
  })

  it('renders the error line alone when no cves are present', () => {
    const errOnly: SecurityDoc = { cves: [], tips: [], fetchedAt: '', error: 'NVD 503' }
    renderInTheme(<SecurityPanel data={errOnly} />)
    expect(screen.getByText(/NVD fetch failed/)).toBeDefined()
    // No "no high-severity CVEs" happy-path note here — the panel does not
    // know the current state, so it does not claim one.
    expect(screen.queryByText(/No high-severity CVEs/)).toBeNull()
  })

  it('CVE links are same-tab-safe (noopener)', () => {
    renderInTheme(<SecurityPanel data={feed} />)
    const link = screen.getByRole('link', { name: 'CVE-2026-0001' }) as HTMLAnchorElement
    expect(link.rel).toContain('noopener')
    // target="_blank" without rel="noopener" is a documented window.opener
    // phishing vector; the attribute is load-bearing.
    expect(link.target).toBe('_blank')
  })
})
