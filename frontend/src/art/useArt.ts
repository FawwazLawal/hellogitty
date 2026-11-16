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
/*
 * The identity names (`vermilion | azure | bone`) that keyed the art
 * registry were the three appearances of the Oni pack. Under the new
 * pack+appearance model the active identity is derived rather than held:
 * on Oni, amoled → vermilion, dark → azure, light → bone. On any other
 * pack there is no art (no other pack ships any today), so `useArt`
 * resolves the absent shape and callers render their fallback.
 */
import type { Identity } from '../theme/tokens'

export function useArt(slot: ArtSlot): ResolvedArt {
  const { pack, resolvedScheme } = useTheme()
  const identity: Identity | null = useMemo(() => {
    if (pack !== 'oni') return null
    if (resolvedScheme === 'amoled') return 'vermilion'
    if (resolvedScheme === 'light') return 'bone'
    return 'azure'
  }, [pack, resolvedScheme])
  return useMemo<ResolvedArt>(() => {
    if (identity) return resolveArt(identity, slot)
    // Non-Oni pack: no art today. The 'absent' shape still wants an
    // identity for logging context — use 'vermilion' as the arbitrary
    // identity-shaped carrier since the registry's test fixtures do.
    return {
      kind: 'absent',
      identity: 'vermilion',
      slot,
      reason: `No art for the active pack. Render the slot's non-art fallback.`,
    }
  }, [identity, slot])
}
