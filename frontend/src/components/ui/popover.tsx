import { forwardRef } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from './cn'
import { FLOATING_SURFACE_STYLE, FLOATING_SURFACE_CLASS, FLOATING_TRANSITION } from './floating'

/**
 * Popover, styled against our tokens.
 *
 * The status legend is the first candidate: it holds the three health states
 * with their colours and short definitions, and it should open on click
 * rather than hover (unlike the stage-chip tooltips) so a user can read
 * without their cursor pinning the trigger.
 *
 * A Popover carries real content — potentially a form field, a filter group —
 * so the padding is more generous than a tooltip and the surface is the same
 * raised chrome as a menu.
 */

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export const PopoverContent = forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        FLOATING_SURFACE_CLASS,
        FLOATING_TRANSITION,
        'z-50 w-[18rem] p-3 text-[12px] text-[var(--hg-text)]',
        className,
      )}
      style={FLOATING_SURFACE_STYLE}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = 'PopoverContent'
