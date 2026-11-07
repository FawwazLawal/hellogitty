import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'

/**
 * Collapsible, styled against our tokens.
 *
 * Panels collapse in three places already and two were hand-rolled. Taking
 * Radix means consistent keyboard behaviour (Enter/Space on the trigger,
 * aria-expanded wired, aria-controls wired) without re-solving it in every
 * panel.
 *
 * Radix's `Content` adds `--radix-collapsible-content-height`, which the
 * global reduced-motion rule neutralises; the height animation here is the
 * conventional keyframe (0 → var) behind `data-state="open"`. Under reduce it
 * resolves to the final height immediately, so collapsed content jumps open
 * rather than stalling in a 1px strip.
 *
 * No styling of the content container itself: a Collapsible is a wrapper, not
 * a surface. It inherits whatever Panel it sits inside.
 */

export const Collapsible = CollapsiblePrimitive.Root
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger

export function CollapsibleContent({
  className = '',
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      className={
        'overflow-hidden ' +
        'data-[state=open]:animate-[hg-collapsible-open_160ms_cubic-bezier(0.2,0,0,1)] ' +
        'data-[state=closed]:animate-[hg-collapsible-close_120ms_cubic-bezier(0.2,0,0,1)] ' +
        className
      }
      {...props}
    >
      {children}
    </CollapsiblePrimitive.Content>
  )
}

/**
 * The keyframes the animation above references. Injected once, globally, so
 * every Collapsible on the page shares them — a module-scope side effect
 * rather than an effect inside a component so it runs before first paint.
 *
 * Kept inside this file because the keyframes exist only to serve this
 * primitive. If a second component needs them, they move to `index.css`.
 */
if (typeof document !== 'undefined') {
  const id = 'hg-collapsible-keyframes'
  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id
    style.textContent =
      '@keyframes hg-collapsible-open{from{height:0}to{height:var(--radix-collapsible-content-height)}}' +
      '@keyframes hg-collapsible-close{from{height:var(--radix-collapsible-content-height)}to{height:0}}'
    document.head.appendChild(style)
  }
}
