import type { Identity } from '../theme/tokens'

/**
 * The art registry: one declaration per shipped asset.
 *
 * ADR-UI-002 §5, Assets: "inventory recording file, owner, license/provenance,
 * intended placement, safe-zone, source/export format, responsive variants and
 * fallback." This module is that inventory, in a form the TypeScript compiler
 * can read.
 *
 * WHY A REGISTRY AND NOT STRING INTERPOLATION. The shipped Go app used
 * `url(/art/header-${identity}.webp)` from inside the template. When a variant
 * did not exist the browser silently 404ed and the tile painted plain, which is
 * indistinguishable from "this identity has no art" by design — except in this
 * app that was a bug, not the intent. A registry keyed by (identity, slot)
 * turns the missing variant into a compile-time (via the union types) or
 * test-time (via `registry.test.ts`) failure, and gives components a typed
 * "absent" shape to render against instead of a dangling URL.
 *
 * FILENAMES ARE NOT RENAMED. The nine current .webp files use two conventions
 * (`header-<identity>` and `vermilion-<slot>`) and the Go server serves them
 * under those exact names. Normalising the asset KEY (identity + slot) in the
 * registry removes the mess from the caller's side without renaming anything
 * on disk, which would break the Go app in the same commit.
 *
 * PROVENANCE IS REQUIRED. Every asset must declare where it came from — the
 * type union below has no "unknown" arm. All nine current assets are AI
 * generated in-session originals with no external manifest; that is an open
 * question the owner is deciding on, and the registry records it as such
 * rather than hiding it.
 */

/**
 * Where an asset paints in the shell. One union, closed — a new slot has to
 * be added here before a component can ask for it.
 *
 *   header     the masthead scenic band
 *   footer     the full-width wave band at the bottom of the viewport
 *   empty      the illustration behind the Conversations empty state
 *   mascot     a figure that reads as a character (oni, cat, kitsune)
 *   ornament   per-tile or per-margin scenery (maple leaves, blossoms)
 */
export type ArtSlot = 'header' | 'footer' | 'empty' | 'mascot' | 'ornament'

/**
 * Where the pixels came from. Required, discriminated — a reviewer has to
 * look at the kind before approving a new asset, and the compiler forces
 * the kind to be present.
 */
export type Provenance =
  | {
      kind: 'ai-generated-in-session'
      /** Model or pipeline, when known. "unknown" is a valid answer and
       *  distinct from no answer. */
      pipeline: string
      /** ISO 8601 of generation. */
      generatedAt?: string
      /** Open question the owner is deciding: can we ship AI originals
       *  without a manifest? Linked here so the registry reflects reality
       *  while it is being decided, instead of silently assuming yes. */
      ownerDecision: 'pending' | 'approved' | 'rejected'
      notes?: string
    }
  | {
      kind: 'licensed'
      source: string
      license: string
      attributionRequired: boolean
      notes?: string
    }
  | {
      kind: 'original'
      author: string
      license: string
      notes?: string
    }

/**
 * A safe zone in percentages of the asset's own box — 0..100 — within which
 * UI text is allowed to sit. Everything outside is "busy" and needs a scrim
 * or a text-free margin. Percentage rather than pixels so a responsive
 * variant does not need its zone recomputed.
 */
export interface SafeZone {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * A rendered copy of the asset at a smaller width, for responsive serving.
 * `file` is the on-disk basename under public/art/, same as the top-level
 * `file`.
 */
export interface ResponsiveVariant {
  /** Rendered width in device-independent pixels. */
  width: number
  file: string
}

export interface AssetRecord {
  identity: Identity
  slot: ArtSlot
  /** Basename under public/art/. The public URL is `/art/${file}`. */
  file: string
  /** The natural size of the file on disk. Measured, not asserted. */
  intrinsic: { width: number; height: number }
  /** Where text may sit over this asset, as percentages of its box. */
  safeZone: SafeZone
  /**
   * Which component first asked for this asset, so a reviewer can trace
   * "why do we still have this". A free-text hint, not a selector.
   */
  intendedPlacement: string
  provenance: Provenance
  /** Smaller renders of the same art, if we have any. Empty when we do not. */
  responsiveVariants: ResponsiveVariant[]
  /**
   * What the caller should do if this asset turns out to be absent at
   * runtime — a hint for reviewers, not a URL. The resolver's "absent"
   * return value is the actual fallback mechanism.
   */
  fallback: string
}

/**
 * The provenance block all nine current assets share: generated in-session
 * for this prototype, pending the owner's decision on AI asset policy.
 */
const AI_IN_SESSION_PENDING: Provenance = {
  kind: 'ai-generated-in-session',
  pipeline: 'unknown',
  ownerDecision: 'pending',
  notes:
    'Owner is deciding whether in-session AI originals need an external ' +
    'manifest before this prototype can be used as a reference. Do not ' +
    'copy these files out of the prototype until that lands.',
}

/**
 * The registry. Declared as a readonly array so the order is stable and
 * duplicate keys would be a compile-time list, not a silent map overwrite.
 * The map built from it (below) is the lookup; the array is the manifest
 * the test and any future "which assets do we ship" report reads.
 */
export const ASSETS: readonly AssetRecord[] = [
  // ── Vermilion ────────────────────────────────────────────────────────
  {
    identity: 'vermilion',
    slot: 'header',
    file: 'header-vermilion.webp',
    intrinsic: { width: 1600, height: 187 },
    // Masthead measured the top ~38% as the text safe zone (scrim covers
    // the rest). The art itself is laid out with its horizon in the lower
    // third, so the top is the text-safe region.
    safeZone: { top: 0, right: 0, bottom: 62, left: 0 },
    intendedPlacement: 'Masthead scenic band (<Masthead>)',
    provenance: AI_IN_SESSION_PENDING,
    responsiveVariants: [],
    fallback: 'Render a plain --hg-canvas band; no identity mark painted.',
  },
  {
    identity: 'vermilion',
    slot: 'footer',
    // Naming inconsistency: this file predates the header-<identity> run.
    // Both names survive in the Go app, so the registry carries whichever
    // name the file was shipped under rather than renaming on disk.
    file: 'vermilion-footer.webp',
    intrinsic: { width: 1600, height: 180 },
    safeZone: { top: 0, right: 0, bottom: 55, left: 0 },
    intendedPlacement: 'Full-width wave band at the bottom of the viewport',
    provenance: AI_IN_SESSION_PENDING,
    responsiveVariants: [],
    fallback: 'No footer scenery; the canvas colour extends to the edge.',
  },
  {
    identity: 'vermilion',
    slot: 'empty',
    file: 'vermilion-empty.webp',
    intrinsic: { width: 1600, height: 400 },
    // ConversationsPanel measured the leading 42% as the text safe zone
    // (the scrim sits there); the scene itself lives in the right half.
    safeZone: { top: 0, right: 58, bottom: 0, left: 0 },
    intendedPlacement: 'ConversationsPanel empty state',
    provenance: AI_IN_SESSION_PENDING,
    responsiveVariants: [],
    fallback:
      'Render a clean empty state on --hg-surface; no illustration. ' +
      'The heading and body already carry the state.',
  },
  {
    identity: 'vermilion',
    slot: 'mascot',
    file: 'vermilion-oni.webp',
    intrinsic: { width: 800, height: 400 },
    // The oni fills the right half of the tile; the leading half is where
    // the numeral and label sit.
    safeZone: { top: 0, right: 0, bottom: 0, left: 50 },
    intendedPlacement: "KpiRail 'repos' tile",
    provenance: AI_IN_SESSION_PENDING,
    responsiveVariants: [],
    fallback: 'Render the tile with chrome only (strap + rivets + plate).',
  },
  {
    identity: 'vermilion',
    slot: 'ornament',
    file: 'vermilion-maple.webp',
    intrinsic: { width: 400, height: 400 },
    safeZone: { top: 0, right: 0, bottom: 0, left: 50 },
    intendedPlacement: "KpiRail 'prs' tile (maple leaves)",
    provenance: AI_IN_SESSION_PENDING,
    responsiveVariants: [],
    fallback: 'Render the tile with chrome only.',
  },

  // ── Azure ────────────────────────────────────────────────────────────
  {
    identity: 'azure',
    slot: 'header',
    file: 'header-azure.webp',
    intrinsic: { width: 1600, height: 187 },
    safeZone: { top: 0, right: 0, bottom: 62, left: 0 },
    intendedPlacement: 'Masthead scenic band (<Masthead>)',
    provenance: AI_IN_SESSION_PENDING,
    responsiveVariants: [],
    fallback: 'Render a plain --hg-canvas band.',
  },
  {
    identity: 'azure',
    slot: 'footer',
    file: 'footer-azure.webp',
    intrinsic: { width: 1920, height: 220 },
    safeZone: { top: 0, right: 0, bottom: 55, left: 0 },
    intendedPlacement: 'Full-width wave band at the bottom of the viewport',
    provenance: AI_IN_SESSION_PENDING,
    responsiveVariants: [],
    fallback: 'No footer scenery; the canvas colour extends to the edge.',
  },

  // ── Bone ─────────────────────────────────────────────────────────────
  {
    identity: 'bone',
    slot: 'header',
    file: 'header-bone.webp',
    intrinsic: { width: 1600, height: 187 },
    safeZone: { top: 0, right: 0, bottom: 62, left: 0 },
    intendedPlacement: 'Masthead scenic band (<Masthead>)',
    provenance: AI_IN_SESSION_PENDING,
    responsiveVariants: [],
    fallback: 'Render a plain --hg-canvas band.',
  },
  {
    identity: 'bone',
    slot: 'footer',
    file: 'footer-bone.webp',
    intrinsic: { width: 1920, height: 220 },
    safeZone: { top: 0, right: 0, bottom: 55, left: 0 },
    intendedPlacement: 'Full-width wave band at the bottom of the viewport',
    provenance: AI_IN_SESSION_PENDING,
    responsiveVariants: [],
    fallback: 'No footer scenery; the canvas colour extends to the edge.',
  },
] as const

/**
 * A lookup table built from the array. Duplicate (identity, slot) pairs are
 * refused at module load — silent overwrites are the class of bug this
 * registry exists to prevent.
 */
function buildIndex(): Map<string, AssetRecord> {
  const m = new Map<string, AssetRecord>()
  for (const a of ASSETS) {
    const key = `${a.identity}:${a.slot}`
    const prior = m.get(key)
    if (prior) {
      throw new Error(
        `art registry: duplicate key ${key} — "${a.file}" and "${prior.file}"`,
      )
    }
    m.set(key, a)
  }
  return m
}
export const ASSET_INDEX: ReadonlyMap<string, AssetRecord> = buildIndex()

/** Join the public-relative URL for an asset. */
export function publicUrl(record: AssetRecord): string {
  return `/art/${record.file}`
}
