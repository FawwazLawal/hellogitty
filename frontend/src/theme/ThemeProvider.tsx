import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { IDENTITIES, IDENTITY_ORDER, type Identity } from './tokens'

/**
 * The theme engine, now reading from the shared pack cascade.
 *
 * ADR-UI-002 §5 kept its two-axis model, but the facts changed underneath:
 *
 *   - The pack values no longer live in this file. They live in
 *     `web/themes.css`, which the Go-rendered pages and the Vite bundle
 *     both include. React stops authoring colour; it only picks which
 *     pack and appearance the cascade should resolve to.
 *   - The identity names (`vermilion | azure | bone`) that shipped as
 *     three parallel palettes are the three appearances of the Oni pack
 *     — `light = Bone, dark = Azure, amoled = Vermilion`, per the owner.
 *     They drifted from the pack values (templated oni-amoled renders
 *     `--text: #f7eef0`; React's vermilion was `#ffffff`). This engine
 *     stops owning those values so the drift becomes unrepresentable.
 *
 * STORAGE KEYS stay the same, so `/legacy` and `/` keep using the same
 * contract — this was the one piece the two sides already shared.
 *
 *   hellogitty-theme         "" | "light" | "dark" | "amoled"  (appearance)
 *   hellogitty-visual-theme  "" | "pink" | "muertos" | ...     (pack id)
 *
 * MIGRATION. Users with a React-written `vermilion | azure | bone` in
 * `hellogitty-visual-theme` are migrated on load, idempotently: the pack
 * becomes `oni`, the appearance becomes the matching one, and both keys
 * are rewritten. A later visit to `/legacy` then reads a value the
 * templated pre-paint recognises.
 *
 * ATTRIBUTE NAMES. React used to write `data-identity` + `data-appearance`,
 * which no CSS anywhere actually read. It now writes `data-visual-theme` +
 * `data-theme`, matching the templated side — the cascade in themes.css
 * keys on exactly those names.
 *
 * NO MORE INLINE PAINTING. The old `root.style.setProperty(name, value)`
 * loop beat every `:root[data-*]` rule because inline styles outweigh
 * specificity. Removing it was non-negotiable — a bridge that resolves
 * through a cascade it can't win against is inert.
 */

export type Appearance = 'auto' | 'light' | 'dark' | 'amoled'

const APPEARANCE_KEY = 'hellogitty-theme'
const VISUAL_KEY = 'hellogitty-visual-theme'

/*
 * The translation from React's three-identity UI (which 2b keeps unchanged)
 * to the pack + appearance pair the cascade reads. 2c will replace the
 * identity UI with a four-option appearance row and a separate pack picker;
 * this map is where the current three-button model sits until then.
 */
const IDENTITY_TO_PAIR: Record<Identity, { pack: string; appearance: Appearance }> = {
  vermilion: { pack: 'oni', appearance: 'amoled' },
  azure: { pack: 'oni', appearance: 'dark' },
  bone: { pack: 'oni', appearance: 'light' },
}

interface ThemeState {
  identity: Identity
  appearance: Appearance
  /** The appearance the browser is currently painting as, OS resolved. */
  resolvedScheme: 'light' | 'dark' | 'amoled'
  setIdentity: (id: Identity) => void
  setAppearance: (a: Appearance) => void
  identities: typeof IDENTITIES
  order: Identity[]
}

const ThemeContext = createContext<ThemeState | null>(null)

/** localStorage can throw (private mode, blocked site data). Never let it break a render. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* a viewer who blocks storage still gets a working page, just not a remembered one */
  }
}

function prefersLight(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches === true
}

function isIdentity(v: string | null): v is Identity {
  return v !== null && (IDENTITY_ORDER as string[]).includes(v)
}

/**
 * Migrate a pre-2b `hellogitty-visual-theme` value to the new pack+appearance
 * shape. Idempotent: a second call with the already-migrated value is a no-op.
 * Only fires on the three React-authored identity names; any legitimate pack
 * id (`oni`, `pink`, `muertos`…) passes through untouched.
 */
function migrateStoredIdentity(): void {
  const stored = readStored(VISUAL_KEY)
  if (!isIdentity(stored)) return
  const pair = IDENTITY_TO_PAIR[stored]
  writeStored(VISUAL_KEY, pair.pack)
  // Only overwrite the appearance key if the identity migration implies one
  // the user didn't set themselves. We're migrating a React identity which
  // implicitly carried its own appearance, so the write is honest.
  writeStored(APPEARANCE_KEY, pair.appearance)
}

/** Read the current state. The migration has already run. */
function readState(): { identity: Identity; appearance: Appearance } {
  const storedPack = readStored(VISUAL_KEY)
  const storedApp = readStored(APPEARANCE_KEY)
  const appearance: Appearance =
    storedApp === 'light' || storedApp === 'dark' || storedApp === 'amoled' ? storedApp : 'auto'
  // Derive the three-identity view for the UI: this is a temporary read of
  // (pack + appearance) back into an Identity for the Masthead's buttons.
  // When pack is `oni`, the active identity is the matching appearance's
  // identity; for any other pack we have no identity to show as "on" and
  // the Masthead's roving-tabindex picker simply shows no active button.
  let identity: Identity = 'vermilion'
  if (storedPack === 'oni' && appearance !== 'auto') {
    identity =
      appearance === 'amoled' ? 'vermilion' : appearance === 'dark' ? 'azure' : 'bone'
  } else if (storedPack !== 'oni' && storedPack) {
    // Non-oni pack: fall back to showing the appearance-matching identity
    // for the picker, but nothing selected. 2c's pack picker fixes this.
    identity = prefersLight() ? 'bone' : 'vermilion'
  }
  return { identity, appearance }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Run the migration BEFORE reading initial state, so the first render
  // already reflects the migrated values.
  const [initial] = useState(() => {
    migrateStoredIdentity()
    return readState()
  })

  const [identity, setIdentityState] = useState<Identity>(initial.identity)
  const [appearance, setAppearanceState] = useState<Appearance>(initial.appearance)
  const [systemLight, setSystemLight] = useState(prefersLight)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e: MediaQueryListEvent) => setSystemLight(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedScheme: 'light' | 'dark' | 'amoled' =
    appearance === 'auto' ? (systemLight ? 'light' : 'dark') : appearance

  const setIdentity = useCallback((id: Identity) => {
    setIdentityState(id)
    // 2b's three-button Masthead sets Oni + the identity's matching
    // appearance; 2c replaces this with pack and appearance as independent
    // controls.
    const pair = IDENTITY_TO_PAIR[id]
    writeStored(VISUAL_KEY, pair.pack)
    writeStored(APPEARANCE_KEY, pair.appearance)
    setAppearanceState(pair.appearance)
  }, [])

  const setAppearance = useCallback((a: Appearance) => {
    setAppearanceState(a)
    // "auto" is the absence of a stored value, matching the Go app exactly.
    writeStored(APPEARANCE_KEY, a === 'auto' ? null : a)
  }, [])

  /*
   * Write the attributes the cascade reads. No inline-style setProperty
   * loop — that beat the shared cascade on every read; the bridge in
   * index.css is the sole adapter now. `data-visual-theme` carries the
   * pack id; `data-theme` carries the resolved appearance. `color-scheme`
   * follows the resolved appearance so form controls and scrollbars
   * match; amoled resolves as dark for that purpose.
   */
  useEffect(() => {
    const root = document.documentElement
    const pack = (readStored(VISUAL_KEY) ?? 'oni') || 'oni'
    if (pack) root.setAttribute('data-visual-theme', pack)
    else root.removeAttribute('data-visual-theme')

    if (resolvedScheme === 'light') root.setAttribute('data-theme', 'light')
    else if (resolvedScheme === 'amoled') root.setAttribute('data-theme', 'amoled')
    else root.removeAttribute('data-theme')

    root.style.colorScheme = resolvedScheme === 'light' ? 'light' : 'dark'
  }, [identity, appearance, resolvedScheme])

  const value = useMemo<ThemeState>(
    () => ({
      identity,
      appearance,
      resolvedScheme,
      setIdentity,
      setAppearance,
      identities: IDENTITIES,
      order: IDENTITY_ORDER,
    }),
    [identity, appearance, resolvedScheme, setIdentity, setAppearance],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
