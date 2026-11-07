import { forwardRef } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { cn } from './cn'
import { FLOATING_SURFACE_STYLE, FLOATING_SURFACE_CLASS, FLOATING_TRANSITION } from './floating'

/**
 * Dropdown menu, styled against our tokens.
 *
 * The masthead "Layout" button needs this today; the per-repo row menu will
 * use it next. Keyboard behaviour (Arrow/Home/End to navigate, Esc to close,
 * typeahead) is Radix's and we do not override it.
 *
 * Styling touches the floating surface and item states only. The surface
 * chrome is shared via `FLOATING_SURFACE_STYLE` — see that file for the
 * reduced-chrome decision.
 */

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal
export const DropdownMenuSub = DropdownMenuPrimitive.Sub
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

/**
 * Item style used by every selectable row — Item, CheckboxItem, RadioItem,
 * SubTrigger. One definition keeps the three visually identical except for
 * the indicator.
 */
const itemClass =
  'relative flex cursor-default select-none items-center gap-2 px-3 py-1.5 text-[12px] outline-none ' +
  // Highlighted (Radix sets `data-highlighted` as the pointer moves or the
  // arrow keys land). Keep contrast on both — `accent-fill` carries white ink.
  'data-[highlighted]:bg-[var(--hg-accent-fill)] data-[highlighted]:text-[var(--hg-accent-ink)] ' +
  // Disabled dims to --hg-text-muted and ignores highlight.
  'data-[disabled]:pointer-events-none data-[disabled]:text-[var(--hg-text-muted)] data-[disabled]:opacity-60 ' +
  // Text default
  'text-[var(--hg-text)]'

export const DropdownMenuSubTrigger = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger ref={ref} className={cn(itemClass, 'pr-2', className)} {...props}>
    {children}
    <ChevronRight size={12} className="ml-auto" aria-hidden="true" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger'

export const DropdownMenuSubContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      FLOATING_SURFACE_CLASS,
      FLOATING_TRANSITION,
      'z-50 min-w-[10rem] py-1',
      className,
    )}
    style={FLOATING_SURFACE_STYLE}
    {...props}
  />
))
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent'

export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        FLOATING_SURFACE_CLASS,
        FLOATING_TRANSITION,
        'z-50 min-w-[10rem] py-1',
        className,
      )}
      style={FLOATING_SURFACE_STYLE}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item ref={ref} className={cn(itemClass, className)} {...props} />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

export const DropdownMenuCheckboxItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem ref={ref} className={cn(itemClass, 'pl-7', className)} {...props}>
    <span className="absolute left-2 flex h-3 w-3 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check size={12} aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem'

export const DropdownMenuRadioItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(itemClass, 'pl-7', className)} {...props}>
    <span className="absolute left-2 flex h-3 w-3 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle size={6} className="fill-current" aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem'

export const DropdownMenuLabel = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--hg-text-muted)]',
      className,
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = 'DropdownMenuLabel'

export const DropdownMenuSeparator = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-[var(--hg-line)]', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator'

export function DropdownMenuShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('ml-auto text-[10px] tracking-widest text-[var(--hg-text-muted)]', className)}
      {...props}
    />
  )
}
