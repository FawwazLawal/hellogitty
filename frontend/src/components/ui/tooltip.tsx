import { forwardRef } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from './cn'
import { FLOATING_SURFACE_STYLE, FLOATING_SURFACE_CLASS, FLOATING_TRANSITION } from './floating'

/**
 * Tooltip, styled against our tokens.
 *
 * The seven pipeline stage chips and the status legend need these — stage
 * chips carry only a three-letter code, and a stage's full name lives in
 * a tooltip or nowhere.
 *
 * `TooltipProvider` must wrap the app once; keeping it as a re-export here
 * means a caller importing from this file gets everything they need.
 *
 * TOUCH. Radix opens tooltips only on keyboard focus and hover, never on tap.
 * That is correct: a tap-to-see tooltip hides the thing it labels. Where
 * mobile users need the label, use a Popover or put the label in the DOM.
 */

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        FLOATING_SURFACE_CLASS,
        FLOATING_TRANSITION,
        // Tooltips are narrower and lighter than menus: smaller padding,
        // smaller type, a single line by default.
        'z-50 max-w-[16rem] px-2.5 py-1 text-[11px] leading-snug text-[var(--hg-text)]',
        className,
      )}
      style={FLOATING_SURFACE_STYLE}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = 'TooltipContent'
