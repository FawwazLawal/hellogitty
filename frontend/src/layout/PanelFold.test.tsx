import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { PanelFold } from './PanelFold'
import type { LayoutAction } from './reducer'

describe('PanelFold', () => {
  it('dispatches toggle-folded on click', () => {
    const dispatch = vi.fn<(a: LayoutAction) => void>()
    render(<PanelFold id="feed" panelName="Live" folded={false} dispatch={dispatch} />)
    fireEvent.click(screen.getByRole('button'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggle-folded', id: 'feed' })
  })

  // aria-expanded is TRUE when the panel is OPEN (not folded). That
  // is counterintuitive the first time and worth a pin: a toggle
  // that announces aria-expanded=true while its body is hidden is
  // a specific accessibility defect.
  it('aria-expanded is TRUE when not folded', () => {
    render(<PanelFold id="feed" panelName="Live" folded={false} dispatch={() => {}} />)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  })

  it('aria-expanded is FALSE when folded', () => {
    render(<PanelFold id="feed" panelName="Live" folded={true} dispatch={() => {}} />)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('label switches between Expand / Collapse so screen readers know what the click will do', () => {
    const { rerender } = render(
      <PanelFold id="feed" panelName="Live" folded={false} dispatch={() => {}} />,
    )
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/^Collapse /)
    rerender(<PanelFold id="feed" panelName="Live" folded={true} dispatch={() => {}} />)
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/^Expand /)
  })
})
