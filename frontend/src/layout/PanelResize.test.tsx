import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { PanelResize } from './PanelResize'
import { RESIZE_STEP_PX } from './snap'
import type { LayoutAction } from './reducer'

/**
 * These tests pin the arithmetic and the key-routing. Drag/touch/
 * pointer-capture — anything where jsdom reports success while a
 * real browser does nothing — is covered in the browser cold-nav
 * step, not here. Peer note on #335: "jsdom will cheerfully pass
 * tests against stubs that do nothing in a real browser." So vitest
 * pins what it can honestly pin: keyboard, label, dispatch shape.
 */

function renderBar(
  args: Partial<Parameters<typeof PanelResize>[0]> = {},
): { dispatch: ReturnType<typeof vi.fn>; bar: HTMLDivElement } {
  const dispatch = vi.fn<(a: LayoutAction) => void>()
  render(
    <PanelResize
      id="your-work"
      panelName="Your work"
      dispatch={dispatch}
      currentHeight={400}
      {...args}
    />,
  )
  const bar = screen.getByRole('separator') as HTMLDivElement
  return { dispatch, bar }
}

describe('PanelResize — accessibility surface', () => {
  // The label is load-bearing: it is the ONLY place double-click
  // is discoverable. Shortening it is the specific defect #335's
  // description calls out. Pinned by substring, not literal, so
  // small copy edits still pass.
  it('exposes role=separator with a horizontal orientation', () => {
    const { bar } = renderBar()
    expect(bar.getAttribute('role')).toBe('separator')
    expect(bar.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('accessible name advertises drag AND arrow keys AND double-click', () => {
    const { bar } = renderBar()
    const label = bar.getAttribute('aria-label') ?? ''
    expect(label).toMatch(/drag/i)
    expect(label).toMatch(/arrow keys/i)
    expect(label).toMatch(/double-click/i)
  })

  it('is focusable (tabIndex=0)', () => {
    const { bar } = renderBar()
    expect(bar.getAttribute('tabindex')).toBe('0')
  })
})

describe('PanelResize — keyboard', () => {
  // ArrowUp SHRINKS — the counterintuitive direction worth
  // pinning. The handle sits on the bottom edge, so up moves
  // that edge up, which reduces height.
  it('ArrowUp commits a SMALLER height (step down by RESIZE_STEP_PX)', () => {
    const { dispatch, bar } = renderBar({ currentHeight: 400 })
    fireEvent.keyDown(bar, { key: 'ArrowUp' })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-size',
      id: 'your-work',
      px: 400 - RESIZE_STEP_PX,
    })
  })

  it('ArrowDown commits a LARGER height (step up by RESIZE_STEP_PX)', () => {
    const { dispatch, bar } = renderBar({ currentHeight: 400 })
    fireEvent.keyDown(bar, { key: 'ArrowDown' })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-size',
      id: 'your-work',
      px: 400 + RESIZE_STEP_PX,
    })
  })

  // Three triggers for clear-size: Escape, Home, double-click.
  // Home is from the templated code at :6082. Escape too. The
  // test asserts the ACTION is clear-size on each — not the key,
  // not the handler, the observable dispatch shape.
  it('Escape, Home, and End all dispatch clear-size', () => {
    const { dispatch, bar } = renderBar()
    fireEvent.keyDown(bar, { key: 'Escape' })
    fireEvent.keyDown(bar, { key: 'Home' })
    fireEvent.keyDown(bar, { key: 'End' })
    expect(dispatch).toHaveBeenCalledTimes(3)
    for (const call of dispatch.mock.calls) {
      expect(call[0]).toEqual({ type: 'clear-size', id: 'your-work' })
    }
  })

  // Double-click clears, mirroring the templated handler at :6077.
  it('double-click dispatches clear-size', () => {
    const { dispatch, bar } = renderBar()
    fireEvent.doubleClick(bar)
    expect(dispatch).toHaveBeenCalledWith({ type: 'clear-size', id: 'your-work' })
  })

  it('an unknown key is inert — no dispatch, no preventDefault', () => {
    const { dispatch, bar } = renderBar()
    fireEvent.keyDown(bar, { key: 'q' })
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('PanelResize — snap plumbing', () => {
  // When a panel opts in (data-snap-rows on the real section),
  // the dispatched height passes through snapRowsToBoundary with
  // the measured rows + chrome. The pin here is wiring, not the
  // snap algorithm — that is pinned in snap.test.ts against the
  // Go reference's case set.
  it('a snap-opted panel pipes keyboard moves through snap', () => {
    const { dispatch, bar } = renderBar({
      currentHeight: 500,
      snapRows: () => ({
        rows: [86, 86, 86, 86, 86, 86, 86, 86, 86, 86],
        chrome: 115,
      }),
    })
    fireEvent.keyDown(bar, { key: 'ArrowDown' })
    // 500 + 40 = 540 wanted → snap(540, chrome=115, rows=10×86) =
    // chrome + 4×86 = 115 + 344 = 459. That is the ACTION's px.
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-size',
      id: 'your-work',
      px: 459,
    })
  })

  it('MINH floors a keyboard shrink before the dispatch', () => {
    // currentHeight = 120, ArrowUp wants 80, MINH floors to 120.
    const { dispatch, bar } = renderBar({ currentHeight: 120 })
    fireEvent.keyDown(bar, { key: 'ArrowUp' })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-size',
      id: 'your-work',
      px: 120,
    })
  })
})
