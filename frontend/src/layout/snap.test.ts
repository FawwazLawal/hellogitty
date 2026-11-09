import { describe, expect, it } from 'vitest'
import { snapRowsToBoundary, MINH, DRAG_THRESHOLD_PX, RESIZE_STEP_PX } from './snap'

/**
 * Pin the snap arithmetic against the SAME case set the Go reference
 * uses in internal/dashboard/snap_test.go. Two mirrors of one
 * algorithm — Go, JS templated, TS here — all need to compute the
 * same answer. Shipping the arithmetic without the test is how the
 * first JS version silently sliced non-uniform rows: it multiplied
 * one row height by N, which the live case [85, 86×9, 223] revealed
 * only after a user noticed.
 *
 * The case names below are kept verbatim from the Go test so a
 * reader diffing the two files sees the drift immediately.
 */

interface Case {
  name: string
  rows: number[]
  chrome: number
  wanted: number
  expect: number
  floor: boolean // assert result <= wanted
}

const cases: Case[] = [
  {
    name: 'uniform rows, preset-sized panel',
    rows: [86, 86, 86, 86, 86, 86, 86, 86, 86],
    chrome: 91,
    wanted: 720,
    expect: 91 + 7 * 86, // 693
    floor: true,
  },
  {
    name: 'non-uniform rows — first is 85, rest are 86: the live case',
    rows: [85, 86, 86, 86, 86, 86, 86, 86, 86, 86],
    chrome: 115,
    wanted: 710,
    expect: 115 + (85 + 5 * 86), // 630 — six rows, not seven
    floor: true,
  },
  {
    name: 'a tall row in the middle: walk accumulates until the next row would overflow',
    rows: [85, 86, 86, 223, 86, 86, 86],
    chrome: 115,
    wanted: 600,
    expect: 115 + (85 + 86 + 86 + 223), // 595 — fourth row is the tall one
    floor: true,
  },
  {
    name: 'wanted smaller than chrome — honour wanted, do not jump above it',
    rows: [86, 86, 86],
    chrome: 115,
    wanted: 80,
    expect: 80,
    floor: true,
  },
  {
    name: 'no row fits — return chrome + first row when that still respects wanted',
    rows: [90, 90, 90],
    chrome: 115,
    wanted: 210,
    expect: 115 + 90, // 205 ≤ 210
    floor: true,
  },
  {
    name: 'mobile case — tall row, small wanted. floor promise beats chrome+rows[0]',
    rows: [300, 100],
    chrome: 115,
    wanted: 200,
    expect: 200, // chrome+300 = 415, above wanted; floor says return wanted
    floor: true,
  },
  {
    name: 'empty rows list — return wanted',
    rows: [],
    chrome: 115,
    wanted: 400,
    expect: 400,
    floor: false,
  },
  {
    name: 'zero-height rows are skipped so a transiently unmeasurable row does not corrupt the prefix',
    rows: [86, 0, 86, 86, 86],
    chrome: 115,
    wanted: 500,
    expect: 115 + (86 + 86 + 86 + 86), // 459
    floor: true,
  },
]

describe('snapRowsToBoundary — mirrors internal/dashboard/snap.go case for case', () => {
  it.each(cases)('$name', ({ rows, chrome, wanted, expect: want, floor }) => {
    const got = snapRowsToBoundary(rows, chrome, wanted)
    expect(got).toBe(want)
    if (floor) {
      expect(got).toBeLessThanOrEqual(wanted)
    }
  })
})

describe('snapRowsToBoundary — border-box arithmetic check', () => {
  // The templated comment at web/index.html:5711-5713 describes a
  // once-debugged failure: the panel's own borders eat into the
  // content area, and leaving them out of `chrome` put the boundary
  // two pixels past the clip and let a sliver of the next row show.
  // Caller is expected to include borderTopWidth + borderBottomWidth
  // in `chrome`; this test shows what happens when they are vs
  // aren't, so a future refactor cannot drop the borders silently.
  it('omitting the 2px of borders moves the snap boundary past the clip', () => {
    // 5 rows of 100px, chrome WITHOUT borders = 100. wanted = 601.
    // avail = 501 → 5 rows fit (500). snap = 100 + 500 = 600.
    const withoutBorders = snapRowsToBoundary([100, 100, 100, 100, 100], 100, 601)
    expect(withoutBorders).toBe(600)
    // Same panel, chrome WITH 2px of borders = 102. avail = 499 →
    // only 4 rows fit (400). snap = 102 + 400 = 502. The two-pixel
    // difference is the sliver.
    const withBorders = snapRowsToBoundary([100, 100, 100, 100, 100], 102, 601)
    expect(withBorders).toBe(502)
  })
})

describe('MINH / DRAG_THRESHOLD_PX / RESIZE_STEP_PX', () => {
  // These three constants carry the templated values exactly — if a
  // future edit changes them silently the behaviour drifts without a
  // test to speak up. Stated with the templated line reference in a
  // comment so the review can diff the constant.
  it('MINH is 120 — matches web/index.html:5686', () => {
    expect(MINH).toBe(120)
  })
  it('DRAG_THRESHOLD_PX is 2 — matches web/index.html:6073', () => {
    expect(DRAG_THRESHOLD_PX).toBe(2)
  })
  it('RESIZE_STEP_PX is 40 — matches web/index.html:6080-6081', () => {
    expect(RESIZE_STEP_PX).toBe(40)
  })
})
