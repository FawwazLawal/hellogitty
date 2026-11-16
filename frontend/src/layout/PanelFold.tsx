import { ChevronUp } from 'lucide-react'
import type { PanelId } from './schema'
import type { LayoutAction } from './reducer'

/**
 * Per-panel fold toggle — `.pfold` in the templated page
 * (web/index.html:26-29, :6036-6040). Lives at the trailing edge
 * of a panel's heading. Click flips `state.folded`; the CSS at
 * `[data-folded="true"] > section > *:not(header)` hides the body.
 *
 * The chevron rotates 180° when collapsed so the control teaches
 * its direction: pointing up when expanded (click to collapse),
 * down when collapsed (click to expand). Reduced-motion disables
 * the rotation transition — see the index.css rule.
 *
 * aria-expanded is the signal screen readers read; the component
 * sets it directly from the folded state.
 */

export interface PanelFoldProps {
  id: PanelId
  /** Accessible display name for the panel ("Live", "Watched issues", ...). */
  panelName: string
  folded: boolean
  dispatch: (action: LayoutAction) => void
  className?: string
}

export function PanelFold({ id, panelName, folded, dispatch, className = '' }: PanelFoldProps) {
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'toggle-folded', id })}
      className={`pfold ${className}`}
      aria-expanded={!folded}
      aria-label={`${folded ? 'Expand' : 'Collapse'} ${panelName}`}
      title={folded ? 'Expand' : 'Collapse'}
      data-pfold-for={id}
    >
      <ChevronUp size={14} aria-hidden="true" />
    </button>
  )
}
