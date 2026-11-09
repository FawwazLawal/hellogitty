import { describe, expect, it } from 'vitest'
import { stepFresh } from './freshRows'

describe('stepFresh (fresh-row tracking)', () => {
  it('seeds on the first data load — nothing is fresh on page open', () => {
    // The first render of /feed is the first data load; marking every
    // row as fresh would flash the whole list on arrival, which is
    // what the templated page avoided by seeding `known` from the
    // server-rendered children.
    const { nextKnown, freshIds } = stepFresh(null, ['a', 'b', 'c'])
    expect(freshIds.size).toBe(0)
    expect([...nextKnown].sort()).toEqual(['a', 'b', 'c'])
  })

  it('marks only ids not previously seen as fresh on later loads', () => {
    // The second load brought one new row (d). Only that one should
    // flash — a and b were already known. c dropped out, which the
    // function ignores since it only cares about new arrivals.
    const prev = new Set(['a', 'b', 'c'])
    const { nextKnown, freshIds } = stepFresh(prev, ['a', 'b', 'd'])
    expect([...freshIds]).toEqual(['d'])
    // The known set is a UNION, not a replacement: an id that drops
    // out of the current view shouldn't flash if it reappears later
    // (the GitHub notification kind that was acked server-side would
    // be the real case).
    expect([...nextKnown].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns empty fresh set when nothing changed', () => {
    const prev = new Set(['a', 'b'])
    const { freshIds } = stepFresh(prev, ['a', 'b'])
    expect(freshIds.size).toBe(0)
  })

  it('does not mutate the input prevKnown set', () => {
    // Important: the caller stores prevKnown in a ref across renders,
    // and the useEffect runs after commit — a shared mutation here
    // would corrupt the state React sees next render.
    const prev = new Set(['a'])
    const prevSnapshot = new Set(prev)
    stepFresh(prev, ['a', 'b'])
    expect([...prev]).toEqual([...prevSnapshot])
  })
})
