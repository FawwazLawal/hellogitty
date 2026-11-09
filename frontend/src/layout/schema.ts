/**
 * Panel-layout storage schema.
 *
 * Three localStorage keys, same ones the templated page writes (see
 * web/index.html:5193, :5367, :5375; `PRESETS` at :5211, `copy` at :5224,
 * `stateEq` at :5379):
 *
 *   hellogitty-layout           the active layout state
 *   hellogitty-layout-custom    the user's "custom" layout — any edit lands here
 *   hellogitty-layout-presets   { name: LayoutState } of USER-named presets
 *
 * None of the templated writes carries a version. Those values exist on
 * every install that has used the layout dialog on /legacy, including
 * NAMED presets the user created. We cannot throw them away.
 *
 * So: absence IS a version — version 0, the templated shape, which this
 * module knows exactly. Reads migrate 0 → 1 in memory; writes always
 * stamp version 1. A HIGHER version than this module recognises is a
 * newer build having written, and we refuse to overwrite it: silently
 * keep what is there and render the config/default layout, so a user
 * downgrading does not lose their settings.
 *
 * This is the "absent is not invalid" rule, a sibling of "unknown is
 * not zero" — the two make the same promise about honest signal, pointed
 * at opposite ends of the pipe.
 */

/** The panel ids this engine knows about today. Drawn from the templated
 *  PRESETS table at web/index.html:5657 so a layout written on /legacy
 *  round-trips without any id being dropped by normalize(). */
export const KNOWN_PANELS = [
  'your-work',
  'conversations',
  'your-repos',
  'tracked',
  'feed',
  'watched',
  'issues',
  'security',
  'pipeline',
  'checks',
] as const
export type PanelId = (typeof KNOWN_PANELS)[number]

/** The six built-in presets' ids. `custom` is the user's own layout; a
 *  name prefixed `user:` is a user-named preset stored in -presets. */
export const BUILTIN_PRESETS = [
  'everything',
  'contributor',
  'maintainer',
  'program',
  'focus',
  'custom',
] as const
export type BuiltinPreset = (typeof BUILTIN_PRESETS)[number]
export type PresetName = BuiltinPreset | `user:${string}`

/** The layout state as every writer and reader on this schema uses it. */
export interface LayoutState {
  preset: PresetName
  /** When the active preset is "custom", `base` remembers the preset it
   *  was last reset from — the Reset button offers "Reset to <base>". */
  base?: PresetName
  /** Panel ids in the main column, top to bottom. */
  main: PanelId[]
  /** Panel ids in the side rail. */
  rail: PanelId[]
  /** Panel ids currently hidden, from either column. Hidden panels keep
   *  their slot in main/rail so unhiding does not reset the order. */
  hidden: PanelId[]
  /** Panel ids currently folded (collapsed to their header). */
  folded: PanelId[]
  /** Per-panel resized height, in CSS pixels. Missing ids use the
   *  panel's own default height. */
  sizes: Partial<Record<PanelId, number>>
}

/** The schema version this module writes. v0 is "the templated shape"
 *  (no envelope); v1 is this shape wrapped in a `{version, state}`
 *  envelope. The number is written only on writes from this module. */
export const SCHEMA_VERSION = 1

/** Keys this engine owns in localStorage. Strings deliberately — they
 *  are an interoperability contract with the templated page. */
export const STORAGE_KEYS = {
  layout: 'hellogitty-layout',
  custom: 'hellogitty-layout-custom',
  presets: 'hellogitty-layout-presets',
} as const

/** Outcome of a read. Three states — the caller distinguishes them so
 *  the UI never conflates "this is your first visit" with "we cannot
 *  reach your storage". */
export type ReadOutcome<T> =
  | { kind: 'ok'; value: T; migratedFrom: number }
  | { kind: 'empty' }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'future'; detail: string }

/** The five built-in presets, ported verbatim from web/index.html:5211
 *  `PRESETS`. Data, not code — the dialog renders these as the preset
 *  buttons and the config-default resolver picks one by name. Sizes are
 *  the templated defaults: TODAY's defaults. When a preset's default
 *  for a panel changes, STORED_SIZE_MIGRATIONS below must gain an
 *  entry mapping the OLD default to the new one; the comment at
 *  :5300 says so and this comment mirrors that obligation. */
export const PRESETS: Record<Exclude<BuiltinPreset, 'custom'>, LayoutState> = {
  everything: {
    preset: 'everything',
    main: ['your-work', 'conversations', 'your-repos', 'tracked'],
    rail: ['feed', 'watched', 'issues', 'security', 'pipeline', 'checks'],
    hidden: [],
    folded: [],
    sizes: { 'your-work': 720, conversations: 280, 'your-repos': 280, tracked: 320, feed: 300, watched: 260, issues: 260, security: 260, pipeline: 280, checks: 260 },
  },
  contributor: {
    preset: 'contributor',
    main: ['your-work', 'conversations', 'tracked', 'your-repos'],
    rail: ['feed', 'watched', 'issues', 'security', 'pipeline', 'checks'],
    hidden: ['your-repos', 'pipeline', 'checks'],
    folded: ['tracked'],
    sizes: { 'your-work': 680, conversations: 260, feed: 280, watched: 240, issues: 240, security: 240 },
  },
  maintainer: {
    preset: 'maintainer',
    main: ['your-repos', 'your-work', 'conversations', 'tracked'],
    rail: ['feed', 'watched', 'issues', 'security', 'pipeline', 'checks'],
    hidden: [],
    folded: ['conversations'],
    sizes: { 'your-repos': 340, 'your-work': 600, tracked: 300, feed: 280, watched: 240, issues: 260, security: 240, pipeline: 260, checks: 240 },
  },
  program: {
    preset: 'program',
    main: ['tracked', 'your-work', 'conversations', 'your-repos'],
    rail: ['pipeline', 'feed', 'watched', 'issues', 'security', 'checks'],
    hidden: ['your-repos'],
    folded: ['your-work', 'conversations'],
    sizes: { tracked: 400, pipeline: 320, feed: 260, watched: 220, issues: 240, security: 220, checks: 220 },
  },
  focus: {
    preset: 'focus',
    main: ['your-work', 'conversations', 'your-repos', 'tracked'],
    rail: ['feed', 'watched', 'issues', 'security', 'pipeline', 'checks'],
    hidden: ['feed', 'conversations', 'your-repos', 'tracked', 'watched', 'issues', 'security', 'pipeline', 'checks'],
    folded: [],
    sizes: {},
  },
}

/** A copy of a preset, tagged with the given preset name, so edits
 *  never mutate the template. Mirrors `copy(p, preset)` at :5224. */
function copyPreset(src: LayoutState, name: PresetName): LayoutState {
  return {
    preset: name,
    main: [...src.main],
    rail: [...src.rail],
    hidden: [...src.hidden],
    folded: [...src.folded],
    sizes: { ...src.sizes },
  }
}

/** The default layout — the `everything` preset. Mirrors the final
 *  fallback at web/index.html:5324 `copy(PRESETS.everything, "everything")`
 *  — the state's `preset` field is the NAME "everything", not an ad-hoc
 *  value, so the dialog shows it as selected. */
export function defaultLayout(): LayoutState {
  return copyPreset(PRESETS.everything, 'everything')
}

/**
 * Stored-size migration table.
 *
 * Mirrors `STORED_SIZE_MIGRATIONS` at web/index.html:5302. When a preset
 * default for a panel moves, its OLD exact value sits in many users'
 * storage as an untouched old default — those values are preferences
 * we inferred, not ones the user set, and we lift them to today's
 * default so the panel renders at the current preset size. A user who
 * DRAGGED the panel is detectable because their value does not match
 * any mapped-from entry; those values pass through untouched.
 *
 * Example: `your-work: 360` was yesterday's default; `your-work: 412`
 * is a drag and stays.
 *
 * STANDING OBLIGATION: when any preset above gets a new default size
 * for a panel, add an entry here mapping the OLD default to the new
 * one. Omitting it leaves half the install base rendering at the old
 * size with nothing explaining the difference from `/legacy`.
 */
export const STORED_SIZE_MIGRATIONS: Partial<Record<PanelId, Record<number, number>>> = {
  'your-work': { 360: 720, 340: 680, 300: 600 },
}

export function migrateStoredSizes(state: LayoutState): LayoutState {
  const sizes = { ...state.sizes }
  for (const [id, map] of Object.entries(STORED_SIZE_MIGRATIONS)) {
    const cur = sizes[id as PanelId]
    if (cur !== undefined && map![cur] !== undefined) {
      sizes[id as PanelId] = map![cur]
    }
  }
  return { ...state, sizes }
}

/**
 * Turn a parsed value into a validated LayoutState. Unknown panel ids
 * drop out; missing columns fall back to the default order for the
 * ids that ARE present, matching the templated `normalize()` so a
 * layout written on /legacy with a since-renamed panel does not strand
 * the other panels.
 */
export function normalize(raw: unknown): LayoutState {
  const d = defaultLayout()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>

  const asArray = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []
  const asPanels = (xs: string[]): PanelId[] =>
    xs.filter((s): s is PanelId => (KNOWN_PANELS as readonly string[]).includes(s))

  const main = asPanels(asArray(r.main))
  const rail = asPanels(asArray(r.rail))
  const hidden = asPanels(asArray(r.hidden))
  const folded = asPanels(asArray(r.folded))

  // Any known panel not placed in either column goes to its column
  // default — same rule as the templated normalize(), so a newly added
  // panel appears in a reasonable place rather than disappearing.
  const placed = new Set<PanelId>([...main, ...rail])
  for (const id of d.main) if (!placed.has(id)) {
    main.push(id); placed.add(id)
  }
  for (const id of d.rail) if (!placed.has(id)) {
    rail.push(id); placed.add(id)
  }

  const sizes: Partial<Record<PanelId, number>> = {}
  if (r.sizes && typeof r.sizes === 'object') {
    for (const [k, v] of Object.entries(r.sizes as Record<string, unknown>)) {
      if ((KNOWN_PANELS as readonly string[]).includes(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) {
        sizes[k as PanelId] = Math.round(v)
      }
    }
  }

  let preset = r.preset as PresetName | undefined
  const validPreset =
    preset !== undefined &&
    ((BUILTIN_PRESETS as readonly string[]).includes(preset as string) ||
      (typeof preset === 'string' && preset.startsWith('user:')))
  if (!validPreset) preset = 'custom'

  const state: LayoutState = {
    preset: preset as PresetName,
    main,
    rail,
    hidden,
    folded,
    sizes,
  }
  if (typeof r.base === 'string') state.base = r.base as PresetName
  return state
}

/**
 * Read a value written by this module OR by the templated page.
 *
 * A v0 (templated) read has no envelope: the value IS the layout. A v1
 * read is `{version: 1, state: LayoutState}`. A value with a version >
 * SCHEMA_VERSION came from a newer build; we leave it in place and
 * report `future` so the caller can render a default without
 * overwriting what is there.
 *
 * Both `getItem` AND the JSON parse can throw. `getItem` throws when
 * storage is disabled (incognito tabs with site data blocked, enterprise
 * policies), which is distinct from the value being null: null is
 * "nothing saved here, this is a first visit", throw is "we cannot
 * reach storage at all". The caller surfaces the second case as a
 * visible state and keeps the first silent.
 */
export function readLayout(storage: Storage = localStorage, key: string = STORAGE_KEYS.layout): ReadOutcome<LayoutState> {
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch (e) {
    return { kind: 'unreachable', detail: e instanceof Error ? e.message : String(e) }
  }
  if (raw === null) return { kind: 'empty' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'empty' }
  }

  // A v1+ envelope: {version, state}. Any value here with `version` is
  // one we wrote; a plain object with no `version` is v0 (templated).
  if (parsed && typeof parsed === 'object' && 'version' in (parsed as object)) {
    const v = (parsed as { version: unknown }).version
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v > SCHEMA_VERSION) {
        return {
          kind: 'future',
          detail: `saved layout is version ${v}; this build understands up to ${SCHEMA_VERSION}`,
        }
      }
      const state = (parsed as { state?: unknown }).state
      return { kind: 'ok', value: normalize(state), migratedFrom: v }
    }
  }

  // No envelope: v0 is the raw templated shape. This is the install
  // base; migrating these forward is the whole point of the rule.
  // migrateStoredSizes runs BEFORE normalize because that is the order
  // the templated page uses — size lifts have to see the raw stored
  // pixel values before normalize's rounding obscures them.
  return { kind: 'ok', value: normalize(migrateStoredSizes(normalize(parsed))), migratedFrom: 0 }
}

/** Write a layout at SCHEMA_VERSION. Caller checks the return — a
 *  thrown setItem is "storage is full or blocked" and surfaces to the
 *  user; swallowing it leaves the saved state silently out of sync
 *  with the screen. */
export function writeLayout(state: LayoutState, storage: Storage = localStorage, key: string = STORAGE_KEYS.layout): { ok: true } | { ok: false; detail: string } {
  try {
    storage.setItem(key, JSON.stringify({ version: SCHEMA_VERSION, state }))
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Choose the layout to render.
 *
 * Precedence, in order: a saved value (migrated from v0 if needed) →
 * the server-configured default from `config.layoutDefault` (absent
 * from `SettingsAPI.Config.LayoutDefault` when the operator did not
 * set one) → the built-in "everything" preset.
 *
 * This is the one that would silently drop the operator's configured
 * starting layout if it forgot to consult `layoutDefault`, same shape
 * as "a feature that used to work stopped and nothing said so".
 */
export function resolveLayout(args: {
  saved: ReadOutcome<LayoutState>
  configDefault: string | null | undefined
}): { state: LayoutState; source: 'saved' | 'config' | 'default'; warning?: string } {
  if (args.saved.kind === 'ok') {
    return { state: args.saved.value, source: 'saved' }
  }
  if (args.saved.kind === 'future') {
    // Do not clobber. Fall through to config/default but tell the caller.
    const warning = args.saved.detail
    return { ...resolveFromConfigOrDefault(args.configDefault), warning }
  }
  if (args.saved.kind === 'unreachable') {
    const warning = args.saved.detail
    return { ...resolveFromConfigOrDefault(args.configDefault), warning }
  }
  return resolveFromConfigOrDefault(args.configDefault)
}

/**
 * Resolve a `configDefault` from the settings document into a layout.
 *
 * `config.layoutDefault` is a free-form JSON string set in
 * `hellogitty.json`. The templated page (web/index.html:5318) accepts
 * it in three shapes, each a separate branch:
 *
 *   1. `{ preset: "contributor" }`     → render that built-in preset
 *   2. `{ main: [...], rail: [...] }`  → render a custom layout from
 *                                        those arrays (hidden/folded
 *                                        allowed, sizes empty)
 *   3. anything else                   → fall through to "everything"
 *
 * The final fallback returns the NAMED `everything` preset, not an
 * ad-hoc default — the state's `preset` field holds the string
 * "everything", which is what the dialog reads to show it as selected.
 */
function resolveFromConfigOrDefault(configDefault: string | null | undefined): { state: LayoutState; source: 'saved' | 'config' | 'default' } {
  if (configDefault && configDefault.trim() !== '' && configDefault !== 'null') {
    try {
      const parsed = JSON.parse(configDefault) as Record<string, unknown>
      // Branch 1: named built-in preset.
      if (typeof parsed.preset === 'string' && parsed.preset in PRESETS) {
        return {
          state: copyPreset(PRESETS[parsed.preset as Exclude<BuiltinPreset, 'custom'>], parsed.preset as PresetName),
          source: 'config',
        }
      }
      // Branch 2: explicit columns → custom layout.
      if (Array.isArray(parsed.main) || Array.isArray(parsed.rail)) {
        return {
          state: normalize({
            preset: 'custom',
            main: parsed.main ?? [],
            rail: parsed.rail ?? [],
            hidden: parsed.hidden ?? [],
            folded: parsed.folded ?? [],
            sizes: {},
          }),
          source: 'config',
        }
      }
      // Fall through — the operator wrote a config that didn't match
      // either shape. Silent fall-through matches the templated
      // behaviour; the settings page is where upstream config errors
      // get surfaced.
    } catch {
      // Malformed JSON; same silent fall-through.
    }
  }
  return { state: defaultLayout(), source: 'default' }
}

/**
 * Popup-mode detection.
 *
 * The browser extension opens the dashboard with `?ext=popup`. In that
 * mode the templated page (web/index.html:5312) forces `focus`, reads
 * no storage and writes none. The second half matters as much as the
 * first — a popup session writing to the shared `hellogitty-layout` key
 * would overwrite the main dashboard's saved layout, which is the
 * category of defect we spent this morning naming.
 *
 * Callers pass the location.search string; schema.ts is pure and takes
 * no DOM/window dependency.
 */
export function isExtPopup(search: string): boolean {
  return /[?&]ext=popup\b/.test(search)
}

/** The layout to use when `isExtPopup(search)` is true. Returns a
 *  fresh `focus` preset; writes are the caller's responsibility to
 *  suppress. */
export function popupLayout(): LayoutState {
  return copyPreset(PRESETS.focus, 'focus')
}
