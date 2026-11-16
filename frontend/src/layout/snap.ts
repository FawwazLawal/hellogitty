/**
 * Panel snap-to-row arithmetic — the TypeScript mirror of
 * `SnapRowsToBoundary` in internal/dashboard/snap.go and of
 * `snapPanelToRowBoundary` in web/index.html (around :5704).
 *
 * All three implement the same algorithm so a panel opting in with
 * `data-snap-rows` lands on a whole-row boundary rather than slicing a
 * row at the bottom edge. Keeping them in lockstep is a maintenance
 * obligation: the Go test's cases are repeated here, verbatim, and the
 * JS templated version carries the same walk. If you change the
 * algorithm, change all three.
 *
 * Why it is pure. Separating the arithmetic from the DOM measurements
 * is what lets a vitest run against a known fixture catch a regression
 * before it meets a real browser. The `.presize` handle slice reads
 * element metrics (row bounding rects, computed border widths) and
 * feeds them to this function; nothing here touches the DOM.
 */

/**
 * Pick the height the panel should actually settle at.
 *
 * @param rows   visible row heights in order, in CSS pixels. Non-positive
 *               entries are skipped so a transiently unmeasurable row
 *               does not corrupt the prefix sum.
 * @param chrome everything the panel renders that is NOT a row — the
 *               heading, any sort bar or table head, the resize handle
 *               itself, AND the panel's own top + bottom borders. The
 *               height applies to the border box, so leaving the
 *               borders out of `chrome` puts the boundary a couple of
 *               pixels past the clip and lets a sliver of the next
 *               row show at the edge (the exact bug the templated
 *               comment at :5711-5713 describes).
 * @param wanted the height the caller asked for, in CSS pixels.
 *
 * The result:
 *
 *   1. is never greater than `wanted` (floor-against-wanted),
 *   2. lands at `chrome + sum-of-row-heights` when any prefix of
 *      rows fits in `wanted - chrome`,
 *   3. falls back to `min(wanted, chrome + rows[0])` when the first
 *      visible row is taller than the whole content area (a mobile
 *      viewport case).
 *
 * Callers pass `MINH`-flooring in BEFORE calling this — `snap` only
 * walks the row algorithm; the minimum-height rule and the final
 * `Math.round` live in the caller (and the comment at web/index.html:5680
 * does `Math.max(MINH, Math.round(h))` before snap sees it).
 */
export function snapRowsToBoundary(rows: readonly number[], chrome: number, wanted: number): number {
  if (wanted <= 0) return wanted
  if (chrome < 0) chrome = 0
  const avail = wanted - chrome
  if (avail <= 0 || rows.length === 0) return wanted

  let acc = 0
  let lastFit = -1
  for (const h of rows) {
    if (h <= 0) continue
    const next = acc + h
    if (next > avail) break
    acc = next
    lastFit = acc
  }
  if (lastFit < 0) {
    // No row fits in the available space. Keep the floor-against-wanted
    // promise even when a single row is taller than the whole area.
    const firstPositive = rows.find((h) => h > 0)
    if (firstPositive === undefined) return wanted
    const oneRow = chrome + firstPositive
    return oneRow <= wanted ? oneRow : wanted
  }
  return chrome + lastFit
}

/** The smallest a user-resized panel can be, in CSS pixels. Floor
 *  applied BEFORE `snapRowsToBoundary`: a wanted-below-MINH collapses
 *  to MINH first, then snaps. Same value as web/index.html:5686. */
export const MINH = 120

/** Below this pointer-travel in pixels, a pointerdown/up on the
 *  resize handle is treated as a click (restore the stored height),
 *  not a drag (commit a new one). Templated code at :6073:
 *  `Math.abs(ev.clientY - startY) > 2`. Without this threshold,
 *  every click on the handle writes a new size, because the handle
 *  is positioned via sticky and pixel-level mouse jitter moves
 *  clientY by one or two between down and up. */
export const DRAG_THRESHOLD_PX = 2

/** Keyboard step for resize arrow keys, in CSS pixels. Templated
 *  code at :6080-6081. ArrowUp shrinks (handle sits on the bottom
 *  edge, so up brings that edge up); ArrowDown grows. */
export const RESIZE_STEP_PX = 40
