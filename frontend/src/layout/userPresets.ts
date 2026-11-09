import type { LayoutState } from './schema'
import { STORAGE_KEYS, normalize } from './schema'

/**
 * User-named presets — the `hellogitty-layout-presets` key the
 * templated page writes at web/index.html:5375. A map of
 * `name → LayoutState`, bare JSON, no envelope — same v0 shape
 * as the other two keys; the "absent is not invalid" rule applies
 * here too.
 *
 * Read on demand rather than on mount: a user who never opens the
 * dialog never pays for a parse, and the dialog slice is already
 * doing the work on open. Reads and writes carry the same
 * unreachable-vs-empty discipline as the main layout hook —
 * `getItem` can throw when storage is disabled, which is a
 * different signal from "nothing saved" and must not collapse into it.
 */

export type UserPresets = Record<string, LayoutState>

export type ReadUserPresetsOutcome =
  | { kind: 'ok'; value: UserPresets }
  | { kind: 'unreachable'; detail: string }

export function readUserPresets(storage: Storage = localStorage): ReadUserPresetsOutcome {
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEYS.presets)
  } catch (e) {
    return { kind: 'unreachable', detail: e instanceof Error ? e.message : String(e) }
  }
  if (raw === null) return { kind: 'ok', value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Malformed JSON — treat as empty rather than refuse to load
    // the dashboard. Same discipline as readLayout.
    return { kind: 'ok', value: {} }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'ok', value: {} }
  }
  const out: UserPresets = {}
  for (const [name, state] of Object.entries(parsed as Record<string, unknown>)) {
    // Each entry is a LayoutState; normalize so an entry naming a
    // panel that no longer exists loses that entry, not the whole
    // preset. Same rule as everywhere else in this codebase.
    if (state && typeof state === 'object') {
      out[name] = normalize(state)
    }
  }
  return { kind: 'ok', value: out }
}

export function writeUserPresets(
  presets: UserPresets,
  storage: Storage = localStorage,
): { ok: true } | { ok: false; detail: string } {
  try {
    storage.setItem(STORAGE_KEYS.presets, JSON.stringify(presets))
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
