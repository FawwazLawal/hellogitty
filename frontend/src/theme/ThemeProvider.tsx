import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * The theme engine, with the owner's model surfaced to the UI.
 *
 * Two axes, kept orthogonal, matching the templated page exactly:
 *
 *   appearance  auto | light | dark | amoled        (hellogitty-theme)
 *   pack        '' | pink | muertos | muertos-v2
 *               | azure-oni | azure-oni-v2 | oni    (hellogitty-visual-theme)
 *
 * AMOLED is pack-scoped: it only appears when the active pack ships one.
 * Five of six packs do (every pack except `pink`). The base (no-pack)
 * default has no amoled either — the templated app never declared one.
 *
 * STRANDED APPEARANCE. When a pack switch strands the current appearance
 * (user is on `amoled`, switches to `pink`), appearance falls to `dark`
 * and both storage keys are rewritten. Verified against the templated
 * page by driving: `oni + amoled → pink` leaves the stored theme as
 * `dark`, not stranded on `amoled`.
 *
 * MIGRATION. Users with a pre-2b React identity (`vermilion | azure | bone`)
 * in `hellogitty-visual-theme` are mapped idempotently to the new
 * (pack, appearance) pair on both the pre-paint script in index.html and
 * here as a defence in depth. `vermilion → oni + amoled`,
 * `azure → oni + dark`, `bone → oni + light`. Running twice is a no-op.
 *
 * ATTRIBUTE NAMES. React writes `data-visual-theme` + `data-theme` on
 * `<html>` — the exact attribute names the shared cascade (and the
 * templated pre-paint) key on. Base tokens come from the cascade; chrome
 * tokens (plate / rivet / scrim) are declared in `index.css` scoped to
 * the packs that ship chrome.
 */

export type Pack = '' | 'pink' | 'muertos' | 'muertos-v2' | 'azure-oni' | 'azure-oni-v2' | 'oni'
export type Appearance = 'auto' | 'light' | 'dark' | 'amoled'
export type ResolvedAppearance = 'light' | 'dark' | 'amoled'

/** Which packs ship each appearance. Base (no pack) has light + dark only. */
const PACK_AMOLED: Record<Exclude<Pack, ''>, boolean> = {
  'pink': false,
  'muertos': true,
  'muertos-v2': true,
  'azure-oni': true,
  'azure-oni-v2': true,
  'oni': true,
}

/*
 * Pack metadata for the picker. Taken from the templated `VISUAL_THEMES`
 * array at `web/settings.html` so the swatch grid on both surfaces shows
 * the same shape — label, description, badge, preview swatch colours.
 * Keep in order; the picker renders in declaration order.
 */
export interface PackInfo {
  id: Pack
  label: string
  description: string
  badge?: { text: string; bg: string; ink: string }
  swatch: { bg: string; dot: string; bar1: string; bar2: string; bar3: string; name: string; desc: string }
}

export const PACKS: PackInfo[] = [
  {
    id: 'pink',
    label: 'Pinky v2',
    description: 'Hot pink collaboration theme',
    badge: { text: 'Limited', bg: '#ff69b4', ink: '#ffffff' },
    swatch: { bg: '#21101a', dot: '#ff69b4', bar1: '#ff69b4', bar2: '#55304a', bar3: '#b88aa4', name: '#f5e0ec', desc: '#b88aa4' },
  },
  {
    id: 'muertos',
    label: 'Muertos',
    description: 'Halloween / Dia de los Muertos, with a true-black mode',
    badge: { text: 'Seasonal', bg: '#b98cf0', ink: '#15111d' },
    swatch: { bg: '#120f18', dot: '#f0a93b', bar1: '#b98cf0', bar2: '#3d3350', bar3: '#a098ae', name: '#ece6f2', desc: '#a098ae' },
  },
  {
    id: 'muertos-v2',
    label: 'Muertos V2',
    description: 'La Noche Viva — a living ofrenda in violet, marigold and jade',
    badge: { text: 'Seasonal', bg: '#a99dff', ink: '#1f1530' },
    swatch: { bg: '#261a34', dot: '#ffc050', bar1: '#a99dff', bar2: '#4a365a', bar3: '#d8c5d8', name: '#fff5e7', desc: '#d8c5d8' },
  },
  {
    id: 'azure-oni',
    label: 'Azure Oni',
    description: 'Ao-Oni — lacquered cobalt over obsidian, with textured surfaces and a true-black blue mode',
    badge: { text: 'Textured', bg: '#7cb7ff', ink: '#0a0f1c' },
    swatch: { bg: '#151c2e', dot: '#ff2d3d', bar1: '#7cb7ff', bar2: '#34445e', bar3: '#b5c2d8', name: '#f5f7ff', desc: '#b5c2d8' },
  },
  {
    id: 'azure-oni-v2',
    label: 'Azure Oni V2',
    description: 'Six generated materials — obsidian, lacquer, ember, armor seam, rim light and brushed alloy',
    badge: { text: 'Textured', bg: '#005bff', ink: '#f5f7ff' },
    swatch: { bg: '#151c2e', dot: '#ff2d3d', bar1: '#005bff', bar2: '#1628a0', bar3: '#b5c2d8', name: '#f5f7ff', desc: '#b5c2d8' },
  },
  {
    id: 'oni',
    label: 'Oni',
    description: 'One identity in three appearances — azure night, bone paper, vermilion on true black',
    badge: { text: 'Illustrated', bg: '#e85663', ink: '#060d19' },
    swatch: { bg: '#10192e', dot: '#e85663', bar1: '#58a8e0', bar2: '#2a4162', bar3: '#a9bdd8', name: '#eaf1fb', desc: '#a9bdd8' },
  },
]

const PACK_IDS = new Set<Pack>(['', 'pink', 'muertos', 'muertos-v2', 'azure-oni', 'azure-oni-v2', 'oni'])

const APPEARANCE_KEY = 'hellogitty-theme'
const VISUAL_KEY = 'hellogitty-visual-theme'

/** How to read the pre-2b identity-name values if they're still in storage. */
const IDENTITY_TO_PAIR: Record<string, { pack: Pack; appearance: Appearance }> = {
  vermilion: { pack: 'oni', appearance: 'amoled' },
  azure: { pack: 'oni', appearance: 'dark' },
  bone: { pack: 'oni', appearance: 'light' },
}

interface ThemeState {
  pack: Pack
  appearance: Appearance
  resolvedScheme: ResolvedAppearance
  /** Whether the current pack carries an AMOLED block. The appearance row hides the fourth button when false. */
  packHasAmoled: boolean
  setPack: (p: Pack) => void
  setAppearance: (a: Appearance) => void
  packs: PackInfo[]
}

const ThemeContext = createContext<ThemeState | null>(null)

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
    /* blocked storage: the page still works, it just doesn't remember */
  }
}

function prefersLight(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches === true
}

function packHasAmoled(pack: Pack): boolean {
  if (!pack) return false
  return PACK_AMOLED[pack]
}

/**
 * One-shot migration of the three pre-2b identity names into pack+appearance.
 * Idempotent: a second call with a value that isn't `vermilion | azure | bone`
 * is a no-op. The pre-paint script in `index.html` runs the same migration
 * before first paint; this is a defence in depth for a page that bypasses it.
 */
function migrateStoredIdentity(): void {
  const stored = readStored(VISUAL_KEY)
  if (stored && stored in IDENTITY_TO_PAIR) {
    const pair = IDENTITY_TO_PAIR[stored]
    writeStored(VISUAL_KEY, pair.pack)
    writeStored(APPEARANCE_KEY, pair.appearance)
  }
}

function readState(): { pack: Pack; appearance: Appearance } {
  const storedPack = readStored(VISUAL_KEY) ?? ''
  const storedApp = readStored(APPEARANCE_KEY)
  const pack: Pack = PACK_IDS.has(storedPack as Pack) ? (storedPack as Pack) : ''
  let appearance: Appearance = 'auto'
  if (storedApp === 'light' || storedApp === 'dark' || storedApp === 'amoled') {
    appearance = storedApp
  }
  // Stranded amoled under a pack with no amoled: fall to dark and rewrite.
  if (appearance === 'amoled' && !packHasAmoled(pack)) {
    appearance = 'dark'
    writeStored(APPEARANCE_KEY, 'dark')
  }
  return { pack, appearance }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Migration runs synchronously before the first state read. The pre-paint
  // script in index.html usually gets there first; this catches the case
  // where it didn't, and keeps the two code paths consistent.
  const [initial] = useState(() => {
    migrateStoredIdentity()
    return readState()
  })

  const [pack, setPackState] = useState<Pack>(initial.pack)
  const [appearance, setAppearanceState] = useState<Appearance>(initial.appearance)
  const [systemLight, setSystemLight] = useState(prefersLight)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e: MediaQueryListEvent) => setSystemLight(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedScheme: ResolvedAppearance =
    appearance === 'auto' ? (systemLight ? 'light' : 'dark') : appearance

  const setPack = useCallback((p: Pack) => {
    setPackState(p)
    writeStored(VISUAL_KEY, p || null)
    // Stranded amoled → dark fallback, mirroring the templated behaviour
    // verified by driving `oni + amoled → pink`: the template rewrites the
    // stored theme to `dark`, not stranded on `amoled`.
    setAppearanceState((current) => {
      if (current === 'amoled' && !packHasAmoled(p)) {
        writeStored(APPEARANCE_KEY, 'dark')
        return 'dark'
      }
      return current
    })
  }, [])

  const setAppearance = useCallback((a: Appearance) => {
    setAppearanceState(a)
    // `auto` is the absence of a stored value, matching the templated side.
    writeStored(APPEARANCE_KEY, a === 'auto' ? null : a)
  }, [])

  /*
   * Write the attributes the cascade reads. `data-visual-theme` carries
   * the pack id; `data-theme` carries the resolved appearance. `auto` is
   * the absence of the attribute, matching the templated page's convention
   * exactly. No inline-style loop — that would beat the cascade.
   */
  useEffect(() => {
    const root = document.documentElement
    if (pack) root.setAttribute('data-visual-theme', pack)
    else root.removeAttribute('data-visual-theme')

    if (resolvedScheme === 'light') root.setAttribute('data-theme', 'light')
    else if (resolvedScheme === 'amoled') root.setAttribute('data-theme', 'amoled')
    else root.removeAttribute('data-theme')

    root.style.colorScheme = resolvedScheme === 'light' ? 'light' : 'dark'
  }, [pack, appearance, resolvedScheme])

  const value = useMemo<ThemeState>(
    () => ({
      pack,
      appearance,
      resolvedScheme,
      packHasAmoled: packHasAmoled(pack),
      setPack,
      setAppearance,
      packs: PACKS,
    }),
    [pack, appearance, resolvedScheme, setPack, setAppearance],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

/*
 * Which packs ship the chrome tokens React draws plates and rivets from.
 * The chrome was invented for the Oni direction; `azure-oni-v2` carries the
 * same materials in a slightly different composition. The other four packs
 * don't model chrome at all. Ornament components read this to decide
 * whether to render — on a pack without chrome, `--hg-plate` etc. are
 * unset, and rendering with the token fallbacks would paint the wrong
 * thing worse than painting nothing.
 */
const CHROME_PACKS = new Set<Pack>(['oni', 'azure-oni-v2'])

export function useChrome(): boolean {
  const { pack } = useTheme()
  return CHROME_PACKS.has(pack)
}
