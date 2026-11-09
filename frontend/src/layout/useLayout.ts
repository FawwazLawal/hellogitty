import { useCallback, useReducer, useRef, useState } from 'react'
import {
  isExtPopup,
  popupLayout,
  readLayout,
  resolveLayout,
  writeLayout,
  type LayoutState,
} from './schema'
import { reduce, type LayoutAction } from './reducer'

/**
 * The hook that wires the pure reducer and the storage boundary.
 *
 * Three states this function refuses to collapse:
 *
 *   - "popup"        → forced focus preset, reads nothing, writes nothing
 *   - "warning"      → a stored value we did not use (future-version or
 *                      unreachable storage); the layout rendered is the
 *                      fall-through, not what's in storage, and the
 *                      warning is surfaced so the UI can say so
 *   - "writeError"   → the last write failed (quota, disabled); the UI
 *                      renders the change but notes the save did not
 *                      land, rather than silently diverging
 *
 * `source` names where the active layout came from (saved / config /
 * default / popup) so the dialog's "reset to" labelling has the right
 * target even on first paint.
 */

export interface UseLayoutOptions {
  /** `SettingsAPI.Config.LayoutDefault` from `/app/api/settings.json`.
   *  Undefined while the settings query is pending — the hook treats
   *  that as "no config default" and will re-resolve when it arrives
   *  by the caller invalidating the mount. Empty string and the JS
   *  literal "null" are both treated as no default, matching how the
   *  templated page tolerated an unconfigured layoutDefault. */
  configDefault: string | null | undefined
  /** `window.location.search` or equivalent. The hook detects
   *  `?ext=popup` and short-circuits storage — see `isExtPopup`. */
  search: string
  /** Storage impl; defaults to `localStorage`. Pass a fake for tests
   *  and a null for server-side renders. */
  storage?: Storage | null
}

export interface UseLayoutResult {
  state: LayoutState
  dispatch: (action: LayoutAction) => void
  source: 'saved' | 'config' | 'default' | 'popup'
  /** Non-null when a stored value was NOT used and the caller should
   *  tell the viewer why. Two cases: future-version storage (we are
   *  the older build) or getItem threw (storage disabled). */
  warning?: string
  /** Non-null when the last write failed — surfaced so a save that
   *  silently diverged from the screen is instead visible. */
  writeError?: string
  /** True in extension-popup mode. Guards the dialog's Save Preset
   *  and similar persistent affordances — they should not appear. */
  isPopup: boolean
}

/** Initial-state resolver. Separate function so tests can call it
 *  directly, and so the hook's useReducer initialiser is cheap. */
export function initialLayout(opts: UseLayoutOptions): {
  state: LayoutState
  source: UseLayoutResult['source']
  warning?: string
  isPopup: boolean
} {
  if (isExtPopup(opts.search)) {
    return { state: popupLayout(), source: 'popup', isPopup: true }
  }
  const storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  const saved = storage
    ? readLayout(storage)
    : { kind: 'empty' as const }
  const resolved = resolveLayout({ saved, configDefault: opts.configDefault })
  return { state: resolved.state, source: resolved.source, warning: resolved.warning, isPopup: false }
}

export function useLayout(opts: UseLayoutOptions): UseLayoutResult {
  // Resolving the initial state is cheap but not free (it parses the
  // stored value and may run a size migration), so pin it via
  // useReducer's lazy initialiser — `initialLayout` runs once, not
  // once per render.
  const initialRef = useRef<ReturnType<typeof initialLayout> | null>(null)
  if (initialRef.current === null) {
    initialRef.current = initialLayout(opts)
  }
  const initial = initialRef.current

  const [state, dispatchRaw] = useReducer(reduce, initial.state)
  const [writeError, setWriteError] = useState<string | undefined>()

  const storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  const isPopup = initial.isPopup

  const dispatch = useCallback(
    (action: LayoutAction) => {
      // Compute the next state ourselves so we can persist it in the
      // same tick without waiting for React to re-render. Reducers are
      // pure, so this cannot drift from the reducer the useReducer
      // call runs — same function, same input.
      const next = reduce(state, action)
      dispatchRaw(action)
      // THE POPUP INVARIANT. Not writing in popup mode is the other
      // half of what the templated page guarantees at :5312 — a popup
      // session that writes would overwrite the real dashboard's
      // saved layout and nothing on screen would say so.
      if (isPopup || !storage) return
      const result = writeLayout(next, storage)
      if (!result.ok) {
        setWriteError(result.detail)
      } else if (writeError !== undefined) {
        setWriteError(undefined)
      }
    },
    [state, storage, isPopup, writeError],
  )

  return {
    state,
    dispatch,
    source: initial.source,
    warning: initial.warning,
    writeError,
    isPopup,
  }
}
