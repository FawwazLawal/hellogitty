import { useEffect, useRef, useState } from 'react'
import type { LayoutState, PanelId, PresetName } from './schema'
import { BUILTIN_PRESETS, PRESETS } from './schema'
import { stateEq, visibleAllFolded, type LayoutAction } from './reducer'
import { readUserPresets, writeUserPresets, type UserPresets } from './userPresets'

/**
 * The layout-configuration dialog — opens on a user action, which
 * is why this whole module lives behind a lazy() import in App.tsx.
 * The entry chunk never pays for the dialog's cost; the chunk loads
 * when the user clicks Layout.
 *
 * Six built-in presets along the top (the five from PRESETS plus
 * "Custom", which is always available). A list of per-panel rows
 * below — show/hide, fold, column select, up/down arrows. User
 * presets below that: save the current layout under a name, pick
 * it, rename, delete. A Collapse-all / Expand-all control that
 * reads `visibleAllFolded` for its label and title, and whose
 * title text carries the keyboard shortcut hint ("Expand all
 * panels (e)" / "Collapse all panels (c)") — matching the
 * templated page as the one place the shortcuts are advertised.
 *
 * The dialog itself is an HTML <dialog> element — native modal
 * semantics for free (Escape to close, focus trap, inert
 * everything outside). The "open"/"close" transitions use React's
 * useEffect to call `showModal()` / `close()` imperatively rather
 * than relying on the `open` attribute, because setting `open`
 * directly bypasses the modal behaviour and the user ends up
 * clicking through the page behind.
 */

export interface LayoutDialogProps {
  open: boolean
  onClose: () => void
  state: LayoutState
  dispatch: (action: LayoutAction) => void
  /** Pass a fake for tests and a null for SSR. Defaults to the
   *  ambient localStorage. */
  storage?: Storage | null
  /** Panel display names, keyed by id. Falls back to the id when
   *  a name is missing. The dashboard supplies these from its own
   *  panel registry. */
  panelNames?: Partial<Record<PanelId, string>>
}

function nameFor(id: PanelId, names: LayoutDialogProps['panelNames']): string {
  return names?.[id] ?? id
}

export function LayoutDialog({
  open,
  onClose,
  state,
  dispatch,
  storage,
  panelNames,
}: LayoutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [userPresets, setUserPresets] = useState<UserPresets>({})
  const [presetsError, setPresetsError] = useState<string | undefined>()
  const [newName, setNewName] = useState('')

  // Open / close as modal — imperative so the modal behaviour and
  // focus trap engage. Setting <dialog open> directly makes the
  // dialog visible but NOT modal.
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // Load user presets when the dialog opens. Reading on every open
  // rather than once-on-mount keeps us in step with a save that
  // may have happened in another tab, and the cost is one storage
  // read when the user clicks Layout — not a perceptible one.
  useEffect(() => {
    if (!open) return
    const s = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage
    if (!s) {
      setUserPresets({})
      return
    }
    const r = readUserPresets(s)
    if (r.kind === 'ok') {
      setUserPresets(r.value)
      if (presetsError !== undefined) setPresetsError(undefined)
    } else {
      setUserPresets({})
      setPresetsError(r.detail)
    }
    // Intentionally not depending on presetsError so re-opening
    // reloads from storage rather than showing stale state; a
    // conditional set keeps the re-render shallow.
  }, [open, storage]) // eslint-disable-line react-hooks/exhaustive-deps

  function persistUserPresets(next: UserPresets) {
    const s = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage
    if (!s) return
    const out = writeUserPresets(next, s)
    if (!out.ok) setPresetsError(out.detail)
  }

  const allFolded = visibleAllFolded(state)
  const foldAllLabel = allFolded ? 'Expand all' : 'Collapse all'
  const foldAllTitle = allFolded ? 'Expand all panels (e)' : 'Collapse all panels (c)'

  const presetDefaults = (name: PresetName): LayoutState | null => {
    if (name === 'custom') return null
    if (name.startsWith('user:')) {
      const un = name.slice('user:'.length)
      return userPresets[un] ?? null
    }
    return PRESETS[name as Exclude<typeof name, 'custom' | `user:${string}`>] ?? null
  }

  const base = state.base ?? state.preset
  const baseDef = presetDefaults(base)
  const canReset = baseDef !== null && !stateEq(state, baseDef)
  const resetLabel = base === 'custom' ? 'Reset' : `Reset to ${presetLabel(base, userPresets)}`

  function onSaveUserPreset() {
    const trimmed = newName.trim()
    if (!trimmed) return
    const next = { ...userPresets, [trimmed]: state }
    setUserPresets(next)
    persistUserPresets(next)
    dispatch({ type: 'select-preset', preset: `user:${trimmed}` as PresetName, userPreset: state })
    setNewName('')
  }

  function onDeleteUserPreset(name: string) {
    const next = { ...userPresets }
    delete next[name]
    setUserPresets(next)
    persistUserPresets(next)
    // If the deleted preset is the active one, fall back to Custom —
    // same reasoning as web/index.html:5528 on rename-delete.
    if (state.preset === `user:${name}`) {
      dispatch({ type: 'select-preset', preset: 'custom' })
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="layout-dialog-h"
      className="w-full max-w-[460px] border"
      style={{
        background: 'var(--hg-surface)',
        borderColor: 'var(--hg-line-strong)',
        color: 'var(--hg-text)',
      }}
      onClose={onClose}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--hg-line)' }}>
        <h2 id="layout-dialog-h" className="text-[14px] font-semibold">
          Layout
        </h2>
        <button
          type="button"
          disabled={!canReset}
          onClick={() => dispatch({ type: 'reset-to-base' })}
          className="ml-auto border px-2 py-1 text-[11px] disabled:opacity-40"
          style={{ borderColor: 'var(--hg-line-strong)' }}
          title={canReset ? resetLabel : 'Nothing to reset'}
        >
          {resetLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="border px-2 py-1 text-[11px]"
          style={{ borderColor: 'var(--hg-line-strong)' }}
          aria-label="Close layout dialog"
        >
          Done
        </button>
      </div>

      <div className="px-4 py-3">
        <p className="mb-3 text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          Saved in this browser. Hidden panels still count in the alert cells.
        </p>

        {/* Collapse / Expand all — label is derived from visibleAllFolded */}
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: allFolded ? 'unfold-all' : 'fold-all' })}
            className="border px-2 py-1 text-[12px]"
            style={{ borderColor: 'var(--hg-line-strong)' }}
            title={foldAllTitle}
            data-testid="fold-all-btn"
          >
            {foldAllLabel}
          </button>
        </div>

        {/* Built-in presets */}
        <div
          role="group"
          aria-label="Layout presets"
          className="mb-3 flex flex-wrap gap-1"
        >
          {BUILTIN_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={state.preset === p}
              onClick={() =>
                dispatch({ type: 'select-preset', preset: p as PresetName })
              }
              className="border px-2 py-1 text-[11px]"
              style={{
                borderColor: 'var(--hg-line-strong)',
                background:
                  state.preset === p ? 'var(--hg-surface-raised)' : undefined,
                fontWeight: state.preset === p ? 600 : 400,
              }}
            >
              {PRESET_LABELS[p] ?? p}
            </button>
          ))}
        </div>

        {/* User presets (list) */}
        {Object.keys(userPresets).length > 0 && (
          <ul className="mb-3 flex flex-col gap-1" aria-label="Your presets">
            {Object.keys(userPresets).map((name) => (
              <li key={name} className="flex items-center gap-2 text-[12px]">
                <button
                  type="button"
                  aria-pressed={state.preset === `user:${name}`}
                  onClick={() =>
                    dispatch({
                      type: 'select-preset',
                      preset: `user:${name}` as PresetName,
                      userPreset: userPresets[name],
                    })
                  }
                  className="flex-1 border px-2 py-1 text-left"
                  style={{
                    borderColor: 'var(--hg-line-strong)',
                    background:
                      state.preset === `user:${name}` ? 'var(--hg-surface-raised)' : undefined,
                  }}
                >
                  {name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteUserPreset(name)}
                  className="border px-1.5 py-1 text-[10.5px]"
                  style={{ borderColor: 'var(--hg-line-strong)' }}
                  aria-label={`Delete preset ${name}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Save current as user preset */}
        <div className="mb-4 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Save current layout as…"
            maxLength={40}
            className="min-w-0 flex-1 border px-2 py-1 text-[12px]"
            style={{
              borderColor: 'var(--hg-line)',
              background: 'var(--hg-surface-sunken)',
              color: 'var(--hg-text)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSaveUserPreset()
              }
            }}
          />
          <button
            type="button"
            disabled={newName.trim() === ''}
            onClick={onSaveUserPreset}
            className="border px-2 py-1 text-[12px] disabled:opacity-40"
            style={{ borderColor: 'var(--hg-line-strong)' }}
          >
            Save
          </button>
        </div>

        {/* Per-panel rows */}
        <ol className="flex flex-col gap-1.5">
          {[
            ...state.main.map((id) => ({ id, col: 'main' as const })),
            ...state.rail.map((id) => ({ id, col: 'rail' as const })),
          ].map(({ id, col }, i, arr) => {
            const isHidden = state.hidden.includes(id)
            const isFolded = state.folded.includes(id)
            const isFirstInCol = arr[i - 1]?.col !== col
            const isLastInCol = arr[i + 1]?.col !== col
            return (
              <li
                key={id}
                className="flex items-center gap-2 text-[12px]"
                data-panel-row={id}
              >
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => dispatch({ type: 'toggle-hidden', id })}
                    aria-label={`Show ${nameFor(id, panelNames)}`}
                  />
                  <span>{nameFor(id, panelNames)}</span>
                </label>
                <select
                  value={col}
                  onChange={(e) =>
                    dispatch({
                      type: 'set-column',
                      id,
                      column: e.target.value as 'main' | 'rail',
                    })
                  }
                  aria-label={`Column for ${nameFor(id, panelNames)}`}
                  className="ml-auto border px-1.5 py-0.5 text-[11px]"
                  style={{ borderColor: 'var(--hg-line)' }}
                >
                  <option value="main">Main</option>
                  <option value="rail">Side</option>
                </select>
                <label className="inline-flex items-center gap-1 text-[11px]">
                  <input
                    type="checkbox"
                    checked={isFolded}
                    onChange={() => dispatch({ type: 'toggle-folded', id })}
                    aria-label={`Fold ${nameFor(id, panelNames)}`}
                  />
                  <span>Folded</span>
                </label>
                <button
                  type="button"
                  disabled={isFirstInCol}
                  onClick={() => dispatch({ type: 'move-within-column', id, delta: -1 })}
                  className="border px-1 py-0.5 text-[11px] disabled:opacity-30"
                  style={{ borderColor: 'var(--hg-line-strong)' }}
                  aria-label={`Move ${nameFor(id, panelNames)} up`}
                >
                  Up
                </button>
                <button
                  type="button"
                  disabled={isLastInCol}
                  onClick={() => dispatch({ type: 'move-within-column', id, delta: 1 })}
                  className="border px-1 py-0.5 text-[11px] disabled:opacity-30"
                  style={{ borderColor: 'var(--hg-line-strong)' }}
                  aria-label={`Move ${nameFor(id, panelNames)} down`}
                >
                  Down
                </button>
              </li>
            )
          })}
        </ol>

        {presetsError && (
          <p
            className="mt-3 text-[11px]"
            role="status"
            style={{ color: 'var(--hg-sev-high, #d9480f)' }}
          >
            Could not read your saved presets: {presetsError}
          </p>
        )}
      </div>
    </dialog>
  )
}

const PRESET_LABELS: Partial<Record<string, string>> = {
  everything: 'Everything',
  contributor: 'Contributor',
  maintainer: 'Maintainer',
  program: 'Program',
  focus: 'Focus',
  custom: 'Custom',
}

function presetLabel(name: PresetName, _userPresets: UserPresets): string {
  if (name.startsWith('user:')) return name.slice('user:'.length)
  return PRESET_LABELS[name] ?? name
}
