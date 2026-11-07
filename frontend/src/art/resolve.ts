import type { Identity } from '../theme/tokens'
import {
  ASSET_INDEX,
  publicUrl,
  type ArtSlot,
  type AssetRecord,
  type SafeZone,
  type Provenance,
} from './registry'

/**
 * Resolve a (identity, slot) request to either a present asset or an
 * explicit absence.
 *
 * The whole point of the module is this return shape. Before the registry,
 * components asked "what is the URL" and got a string that sometimes 404ed;
 * now they ask "is there an asset for this" and get a typed answer. A caller
 * that wants to render clean chrome on a missing asset writes a switch on
 * `kind`, which the compiler checks is exhaustive. No string gets built from
 * a variant that was never cut.
 */
export type ResolvedArt =
  | {
      kind: 'present'
      url: string
      intrinsic: { width: number; height: number }
      safeZone: SafeZone
      provenance: Provenance
      asset: AssetRecord
    }
  | {
      kind: 'absent'
      identity: Identity
      slot: ArtSlot
      /** A one-line explanation for the reviewer who sees a bare surface. */
      reason: string
      /** The author-written fallback intent from the registry, if one existed
       *  for a sibling identity on the same slot. Hints a next step; does
       *  not resolve the UI. */
      fallbackHint?: string
    }

/**
 * Look up the record for (identity, slot). Pure — no I/O, no React. Safe to
 * call from a server render, a worker, or the Playwright setup block.
 */
export function resolveArt(identity: Identity, slot: ArtSlot): ResolvedArt {
  const record = ASSET_INDEX.get(`${identity}:${slot}`)
  if (record) {
    return {
      kind: 'present',
      url: publicUrl(record),
      intrinsic: record.intrinsic,
      safeZone: record.safeZone,
      provenance: record.provenance,
      asset: record,
    }
  }

  // Absent. Surface the fallback intent from any sibling identity that DOES
  // carry this slot, so a reviewer looking at the "absent" result can see
  // what the sibling render does instead.
  let hint: string | undefined
  for (const r of ASSET_INDEX.values()) {
    if (r.slot === slot) {
      hint = r.fallback
      break
    }
  }
  return {
    kind: 'absent',
    identity,
    slot,
    reason: `no art registered for identity="${identity}" slot="${slot}"`,
    fallbackHint: hint,
  }
}

/**
 * A narrow convenience for the common component shape: give me the URL, or
 * `null`. Use this when the whole render is "src=X if there, otherwise skip
 * the <img>"; use `resolveArt` directly when you also care about the safe
 * zone or provenance.
 */
export function artUrl(identity: Identity, slot: ArtSlot): string | null {
  const r = resolveArt(identity, slot)
  return r.kind === 'present' ? r.url : null
}
