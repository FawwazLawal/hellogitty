import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Class-name helper for the UI primitives.
 *
 * Kept inside `components/ui/` because `clsx + tailwind-merge` is the shadcn
 * convention this folder is aligned to, and nothing outside this folder has
 * needed it yet. The rest of the codebase writes inline `style` objects.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
