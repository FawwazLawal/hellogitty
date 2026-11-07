import { createContext, forwardRef, useContext } from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './cn'

/**
 * A segmented single-select / multi-select button group.
 *
 * WHY THIS EXISTS. Four pages ship with a hand-rolled version of this: two in
 * the Masthead, one in SettingsPage (as a local `SegmentedControl`), one each
 * in PipelinePage, WorkPage and YourReposPage. All are the same WAI-ARIA
 * radiogroup pattern wearing `<button aria-pressed>` + `role="group"` clothes.
 * They work with a mouse and with Tab, but not with arrow keys — tabbing
 * through the Masthead's two 3-option groups is six Tab presses when the
 * WAI-ARIA pattern asks for two (one into the group, arrows within it).
 *
 * `@radix-ui/react-toggle-group` ships the roving-tabindex, arrow-key
 * navigation and focus-return logic, and `class-variance-authority` lets the
 * two sizes we use (the Masthead's control size, and the SettingsPage's
 * slightly denser one) be declared once instead of mixed into each call site.
 *
 * NOT ADOPTED: the native `<select>`s on `/repos` and `/pipeline`. Native
 * select is keyboard-complete, screen-reader-complete, and the styling we
 * have on them is already in tokens — replacing them with
 * `@radix-ui/react-select` would be form over function. The brief said
 * `a hand-rolled control that already passes axe and keyboard navigation is
 * not automatically worth replacing`, and `<select>` is the canonical
 * version of that case.
 */

const itemVariants = cva(
  // Active state is driven by Radix's `data-state="on"` on the item, so the
  // selector follows the real selection rather than a parent-held flag.
  // tokens stay in `var(--hg-*)` — cva owns size only, tokens own colour.
  'border-l transition-colors first:border-l-0 whitespace-nowrap ' +
    'bg-[var(--hg-surface)] text-[var(--hg-text-muted)] ' +
    'data-[state=on]:bg-[var(--hg-accent-fill)] data-[state=on]:text-[var(--hg-accent-ink)] ' +
    'data-[state=on]:font-semibold',
  {
    variants: {
      size: {
        // Masthead picker sizing — narrow, dense.
        sm: 'px-2.5 py-1.5 text-[12px]',
        // SettingsPage sizing — a hair larger, matched to form rows.
        md: 'px-3 py-1.5 text-[12px]',
      },
    },
    defaultVariants: { size: 'sm' },
  },
)

type ItemVariants = VariantProps<typeof itemVariants>

const SizeContext = createContext<NonNullable<ItemVariants['size']>>('sm')

/**
 * Single-select toggle group (one option on at a time).
 *
 * `value` + `onValueChange` drive it in controlled mode, mirroring the
 * existing `aria-pressed` idiom at every call site. Hard-coded to Radix's
 * `type="single"` because every group that migrated here was semantically a
 * radiogroup; a multi-select variant can be added later with its own export
 * when the first real multi-select appears.
 */
type ToggleGroupSingleProps = React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> extends infer R
  ? R extends { type: 'single' }
    ? R
    : never
  : never

export const ToggleGroup = forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  Omit<ToggleGroupSingleProps, 'type'> & {
    size?: NonNullable<ItemVariants['size']>
  }
>(({ className, size = 'sm', children, ...props }, ref) => (
  <SizeContext.Provider value={size}>
    <ToggleGroupPrimitive.Root
      ref={ref}
      type="single"
      className={cn('inline-flex border', className)}
      style={{ borderColor: 'var(--hg-line-strong)' }}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  </SizeContext.Provider>
))
ToggleGroup.displayName = 'ToggleGroup'

export const ToggleGroupItem = forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, style, children, ...props }, ref) => {
  const size = useContext(SizeContext)
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(itemVariants({ size }), className)}
      style={{ borderColor: 'var(--hg-line-strong)', ...style }}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
})
ToggleGroupItem.displayName = 'ToggleGroupItem'
