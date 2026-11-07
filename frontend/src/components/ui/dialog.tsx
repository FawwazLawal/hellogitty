import { forwardRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from './cn'
import { FLOATING_SURFACE_STYLE, FLOATING_SURFACE_CLASS, FLOATING_TRANSITION } from './floating'

/**
 * Dialog, styled against our tokens.
 *
 * Nothing in the app opens one yet — but confirm flows ("Drop this repo?",
 * "Turn down this issue?") need somewhere trustworthy to live, and a browser
 * `confirm()` is not it: it does not inherit identity, it does not survive
 * reduced-motion correctly on every platform, and it steals the keyboard in
 * ways the rest of the dashboard does not.
 *
 * Accessibility is Radix's: focus trap on open, focus return to the trigger
 * on close, Escape closes, `aria-labelledby` wired from `DialogTitle`.
 * Overriding onKeyDown or managing focus by hand would undo the point.
 *
 * `DialogDescription` is kept available so a caller can satisfy
 * `aria-describedby` without boilerplate — Radix emits a dev-time warning if
 * a dialog has no description and the caller did not opt out.
 */

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogPortal = DialogPrimitive.Portal
export const DialogClose = DialogPrimitive.Close

export const DialogOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 ' +
        'transition-opacity duration-150 ease-out ' +
        'data-[state=closed]:opacity-0 data-[state=open]:opacity-100',
      className,
    )}
    {...props}
  
    style={{ background: 'var(--hg-scrim)' }}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

export const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showClose?: boolean }
>(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        FLOATING_SURFACE_CLASS,
        FLOATING_TRANSITION,
        // Centred modal. Keep the width conservative; the dashboard's dialogs
        // ask a question, they do not hold a form flow.
        'fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 p-6 origin-center',
        className,
      )}
      style={FLOATING_SURFACE_STYLE}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close
          aria-label="Close dialog"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center text-[var(--hg-text-muted)] hover:text-[var(--hg-text)] transition-colors"
        >
          <X size={14} aria-hidden="true" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DialogContent.displayName = 'DialogContent'

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1.5', className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-5 flex items-center justify-end gap-2', className)} {...props} />
}

export const DialogTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-[15px] font-semibold leading-tight text-[var(--hg-text)]', className)}
    {...props}
  />
))
DialogTitle.displayName = 'DialogTitle'

export const DialogDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-[12px] leading-relaxed text-[var(--hg-text-muted)]', className)}
    {...props}
  />
))
DialogDescription.displayName = 'DialogDescription'
