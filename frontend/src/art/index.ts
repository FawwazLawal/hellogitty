/**
 * Barrel re-exports for the art loader.
 *
 * Components import from `../art` rather than reaching into the file layout
 * inside this module, so the registry can be split or refactored without
 * touching callers.
 */
export { ASSETS, ASSET_INDEX, publicUrl } from './registry'
export type {
  ArtSlot,
  AssetRecord,
  Provenance,
  ResponsiveVariant,
  SafeZone,
} from './registry'
export { resolveArt, artUrl } from './resolve'
export type { ResolvedArt } from './resolve'
export { useArt } from './useArt'
