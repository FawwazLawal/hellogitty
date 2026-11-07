import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthRow } from './parts'
import type { HealthItem } from '../../data/alerts'

/**
 * HealthRow carries the alert pages' only count-field-as-absence hazard:
 * a never-polled repository's Open and GFI are zero because nobody
 * looked, not because nothing is open. The row is supposed to render
 * both as em-dashes when `polled` is false, same shape as every other
 * unknown-vs-zero branch on these pages.
 *
 * In practice the dormant/slow filter upstream already drops never-polled
 * repos (their Health is UNKNOWN by store.HealthLabel), so this is a
 * defensive test — if a caller ever renders an off-filter row, the dashes
 * stop the lie before someone notices the zeros.
 */
describe('HealthRow', () => {
  const base: HealthItem = {
    owner: 'o', name: 'r', url: 'https://example.test',
    health: 'DORMANT', polled: true, open: 7, gfi: 2, ageKnown: true, ageDays: 42,
  }

  it('renders the counts when polled', () => {
    render(
      <ul>
        <HealthRow item={base} />
      </ul>,
    )
    expect(screen.getByText('7 open')).toBeTruthy()
    expect(screen.getByText('2 GFI')).toBeTruthy()
  })

  it('renders em-dashes for the counts when never polled', () => {
    const unpolled: HealthItem = { ...base, polled: false, open: 0, gfi: 0 }
    render(
      <ul>
        <HealthRow item={unpolled} />
      </ul>,
    )
    expect(screen.getByText('— open')).toBeTruthy()
    expect(screen.getByText('— GFI')).toBeTruthy()
    // And nothing claiming "0 open" survived.
    expect(screen.queryByText('0 open')).toBeNull()
    expect(screen.queryByText('0 GFI')).toBeNull()
  })

  it('renders an em-dash for last-commit age when AgeKnown is false', () => {
    const noAge: HealthItem = { ...base, ageKnown: false, ageDays: 0 }
    render(
      <ul>
        <HealthRow item={noAge} />
      </ul>,
    )
    expect(screen.getByText('—')).toBeTruthy()
  })
})
