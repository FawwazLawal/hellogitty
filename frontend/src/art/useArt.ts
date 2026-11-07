import { useMemo } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { resolveArt, type ResolvedArt } from './resolve'
import type { ArtSlot } from './registry'

/**
 * React-facing convenience: resolve an art slot against the active identity.
 *
 * The loader itself is framework-agnostic (see `resolve.ts`). This hook is
 * the single line a component writes to subscribe to identity changes — the
 * memo depends on the live identity, and nothing else — so the resolver can
 * be unit-tested, called from a web worker or from a Playwright setup block
 * without dragging the React runtime along.
 *
 * NO LOADING STATE. The URL is a static path under `public/art/`; the
 * browser's image decoder owns the loading lifecycle. A hook that invented
 * `{ loading, present, absent }` here would have no one to tell about
 * loading, since the real event is `<img onLoad>` on whichever element
 * paints the URL. Keep that where it belongs.
 */
export function useArt(slot: ArtSlot): ResolvedArt {
  const { identity } = useTheme()
  return useMemo(() => resolveArt(identity, slot), [identity, slot])
}
