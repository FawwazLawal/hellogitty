/**
 * Pure reducer over LayoutState. No DOM, no storage — the pieces that
 * touch the world live in their own slices (useLayout hook, Grip
 * component, keyboard shortcuts), each testable against this reducer.
 *
 * Mirrors the templated `change(fn)` wrapper at web/index.html:5413:
 * every edit that isn't a wholesale preset switch sets the active
 * preset to "custom" while remembering the preset it drifted from
 * in `base` — that is what powers the Reset button's "Reset to
 * <preset>". `selectPreset` and `resetToBase` are the two actions
 * that bypass that rule, because picking a preset IS the user
 * declaring that `custom` no longer describes what they want.
 */

import type { LayoutState, PanelId, PresetName } from './schema'
import { PRESETS, normalize } from './schema'

/** Which column a panel is in. Returns null when hidden from both. */
export function columnOf(state: LayoutState, id: PanelId): 'main' | 'rail' | null {
  if (state.main.includes(id)) return 'main'
  if (state.rail.includes(id)) return 'rail'
  return null
}

/** All action shapes the reducer accepts. Union discriminated on
 *  `type` so an exhaustive switch catches a missing handler at
 *  compile time rather than silently failing at runtime. */
export type LayoutAction =
  | { type: 'toggle-hidden'; id: PanelId }
  | { type: 'toggle-folded'; id: PanelId }
  | { type: 'move-within-column'; id: PanelId; delta: -1 | 1 }
  | { type: 'move-across-columns'; id: PanelId }
  | { type: 'set-column'; id: PanelId; column: 'main' | 'rail' }
  | { type: 'set-size'; id: PanelId; px: number }
  | { type: 'clear-size'; id: PanelId }
  | { type: 'select-preset'; preset: PresetName; userPreset?: LayoutState }
  | { type: 'reset-to-base' }

/** `change`-style wrapper: mark the result as custom and remember
 *  where we drifted from. `base` only gets set the first time an
 *  edit happens from a non-custom preset; later edits keep the
 *  same base, matching the templated code. */
function asCustom(prev: LayoutState, next: Partial<LayoutState>): LayoutState {
  const base = prev.base ?? (prev.preset === 'custom' ? undefined : prev.preset)
  return {
    ...prev,
    ...next,
    preset: 'custom',
    base,
  }
}

function withToggled(arr: PanelId[], id: PanelId): PanelId[] {
  return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]
}

export function reduce(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'toggle-hidden':
      return asCustom(state, { hidden: withToggled(state.hidden, action.id) })

    case 'toggle-folded':
      return asCustom(state, { folded: withToggled(state.folded, action.id) })

    case 'set-size': {
      if (!Number.isFinite(action.px) || action.px <= 0) return state
      return asCustom(state, {
        sizes: { ...state.sizes, [action.id]: Math.round(action.px) },
      })
    }

    case 'clear-size': {
      if (state.sizes[action.id] === undefined) return state
      const next = { ...state.sizes }
      delete next[action.id]
      return asCustom(state, { sizes: next })
    }

    case 'move-within-column': {
      const col = columnOf(state, action.id)
      if (!col) return state
      const arr = state[col]
      const i = arr.indexOf(action.id)
      const j = i + action.delta
      if (j < 0 || j >= arr.length) return state
      const next = [...arr]
      ;[next[i], next[j]] = [next[j], next[i]]
      return asCustom(state, { [col]: next } as Partial<LayoutState>)
    }

    case 'move-across-columns': {
      const from = columnOf(state, action.id)
      if (!from) return state
      const to = from === 'main' ? 'rail' : 'main'
      const i = state[from].indexOf(action.id)
      // Hold the panel's VISUAL position where possible: try to drop
      // it in the other column at the same index, clamped to the new
      // column's length so the end-of-column case still works.
      const fromArr = state[from].filter((x) => x !== action.id)
      const toArr = [...state[to]]
      const atIndex = Math.min(i, toArr.length)
      toArr.splice(atIndex, 0, action.id)
      return asCustom(state, {
        [from]: fromArr,
        [to]: toArr,
      } as Partial<LayoutState>)
    }

    // Move a panel to the END of the named column. The templated
    // keyboard contract at web/index.html expects this: ArrowLeft from
    // the rail places the panel at the bottom of main, not at its
    // current rail index projected onto main (which is what
    // `move-across-columns` does for an eventual drag-drop user). The
    // two actions are deliberately distinct.
    //
    // Strips the id from BOTH columns before appending — mirrors
    // `place` in the templated code, which does the same as a guard
    // against an id showing up in both arrays and being rendered
    // twice. Equivalent-mutant per the three-category rubric when
    // state invariants are intact; kept as belt-and-braces.
    case 'set-column': {
      const cur = columnOf(state, action.id)
      if (cur === action.column) return state
      const main = state.main.filter((x) => x !== action.id)
      const rail = state.rail.filter((x) => x !== action.id)
      if (action.column === 'main') {
        return asCustom(state, { main: [...main, action.id], rail })
      }
      return asCustom(state, { main, rail: [...rail, action.id] })
    }

    // Picking a preset is a wholesale replacement — the user is
    // declaring custom no longer applies. `base` resets to the
    // chosen preset's name so a subsequent edit's Reset button
    // reads "Reset to <name>".
    case 'select-preset': {
      if (action.userPreset) {
        return normalize({ ...action.userPreset, preset: action.preset, base: undefined })
      }
      const builtin = (PRESETS as Record<string, LayoutState | undefined>)[action.preset as string]
      if (!builtin) return state
      return {
        ...builtin,
        main: [...builtin.main],
        rail: [...builtin.rail],
        hidden: [...builtin.hidden],
        folded: [...builtin.folded],
        sizes: { ...builtin.sizes },
        preset: action.preset,
        base: undefined,
      }
    }

    case 'reset-to-base': {
      const base = state.base ?? state.preset
      if (base === 'custom' || base.startsWith('user:')) return state
      const key = base as Exclude<PresetName, 'custom' | `user:${string}`>
      const builtin = (PRESETS as Record<string, LayoutState | undefined>)[key]
      if (!builtin) return state
      return {
        ...builtin,
        main: [...builtin.main],
        rail: [...builtin.rail],
        hidden: [...builtin.hidden],
        folded: [...builtin.folded],
        sizes: { ...builtin.sizes },
        preset: base,
        base: undefined,
      }
    }
  }
}

/**
 * Structural equality for two layout states. Preset and base are
 * ignored on purpose: this answers "do these describe the same
 * dashboard arrangement", which is the question the Reset button
 * is really asking when it checks whether to disable itself.
 * Mirrors `stateEq` at web/index.html:5379.
 */
export function stateEq(a: LayoutState, b: LayoutState): boolean {
  const arrEq = (x: PanelId[], y: PanelId[]) =>
    x.length === y.length && x.every((v, i) => v === y[i])
  if (!arrEq(a.main, b.main)) return false
  if (!arrEq(a.rail, b.rail)) return false
  if (!arrEq(a.hidden, b.hidden)) return false
  if (!arrEq(a.folded, b.folded)) return false
  const aKeys = Object.keys(a.sizes)
  const bKeys = Object.keys(b.sizes)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (a.sizes[k as PanelId] !== b.sizes[k as PanelId]) return false
  }
  return true
}
