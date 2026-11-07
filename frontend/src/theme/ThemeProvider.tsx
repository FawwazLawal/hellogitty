import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { IDENTITIES, IDENTITY_ORDER, cssVarsFor, type Identity } from './tokens'

/**
 * The theme engine.
 *
 * ADR-UI-002 §5: "Theme **identity** and OS **appearance** preference must be
 * modeled independently where appropriate; faithfully preserve the app's
 * existing appearance selection behavior. Give founder-visible labels, logical
 * fallbacks and persistence. Theme switching must not reset user data, focus or
 * panel layouts."
 *
 * Two controls, kept orthogonal:
 *
 *   identity    vermilion | azure | bone     — which world the product is in
 *   appearance  auto | light | dark          — what the OS or the user asked for
 *
 * They are not the same axis and collapsing them is the mistake worth avoiding.
 * Bone is a light identity and Vermilion a dark one, so "appearance" cannot
 * simply pick a palette. What it does instead is pick the *default* identity
 * when the founder has not chosen one, and set `color-scheme` so form controls
 * and scrollbars match. An explicitly chosen identity always wins over the OS.
 *
 * PRESERVING THE EXISTING BEHAVIOUR. The Go app stores its appearance under
 * `hellogitty-theme` and its pack under `hellogitty-visual-theme`, and its
 * pre-paint script treats a *missing* appearance key as "auto". The same keys
 * and the same semantics are used here, so a founder who has already picked a
 * theme in the live app finds it picked here too, and a later migration does
 * not strand their choice.
 *
 * NOT RESETTING ANYTHING. Changing identity sets CSS custom properties on the
 * root element. It does not remount, so React state, scroll position, focus and
 * any panel layout survive the switch by construction rather than by care.
 */

export type Appearance = 'auto' | 'light' | 'dark'

const APPEARANCE_KEY = 'hellogitty-theme'
const IDENTITY_KEY = 'hellogitty-visual-theme'

interface ThemeState {
  identity: Identity
  appearance: Appearance
  /** What `appearance` actually resolves to right now, OS included. */
  resolvedScheme: 'light' | 'dark'
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(() => {
    const stored = readStored(APPEARANCE_KEY)
    // A missing key means auto, which is how the Go app's pre-paint reads it.
    return stored === 'light' || stored === 'dark' ? stored : 'auto'
  })

  const [identity, setIdentityState] = useState<Identity>(() => {
    const stored = readStored(IDENTITY_KEY)
    if (isIdentity(stored)) return stored
    // No chosen identity: fall back along the appearance axis. This is the only
    // place the two axes touch, and only ever as a default.
    return prefersLight() ? 'bone' : 'vermilion'
  })

  const [systemLight, setSystemLight] = useState(prefersLight)

  // Follow the OS while the founder is on "auto", and stop following the moment
  // they are not. A listener that keeps firing after an explicit choice is how
  // a theme picker ends up feeling haunted.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e: MediaQueryListEvent) => setSystemLight(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedScheme: 'light' | 'dark' =
    appearance === 'auto' ? (systemLight ? 'light' : 'dark') : appearance

  const setIdentity = useCallback((id: Identity) => {
    setIdentityState(id)
    writeStored(IDENTITY_KEY, id)
  }, [])

  const setAppearance = useCallback((a: Appearance) => {
    setAppearanceState(a)
    // "auto" is the absence of a stored value, matching the Go app exactly.
    writeStored(APPEARANCE_KEY, a === 'auto' ? null : a)
  }, [])

  // Paint the tokens onto the root. Custom properties rather than a class swap,
  // so nothing unmounts and every consumer updates in one style recalculation.
  useEffect(() => {
    const root = document.documentElement
    const vars = cssVarsFor(identity)
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
    root.dataset.identity = identity
    root.dataset.appearance = appearance
    root.style.colorScheme = IDENTITIES[identity].scheme
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name)
    }
  }, [identity, appearance])

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
