/**
 * The single source of truth for the visual system.
 *
 * ADR-UI-002 §5 asks for "separate semantic tokens for backgrounds, surfaces,
 * text, borders, focus, statuses, spacing, radii, elevation, density and
 * motion; export typed tokens/variables as a single source of truth." This is
 * that file. Every colour below is either sampled from the founder's reference
 * renders or measured against the surface it sits on — `tokens.contrast.test.ts`
 * recomputes every text pair and fails if one drops below its floor.
 *
 * WHY NOT REUSE THE CSS PACK VALUES WHOLESALE. The Go template already carries
 * an "Oni" pack whose three appearances were measured against these same
 * renders, and the azure and bone sets here descend from that work. Vermilion
 * does not: that pack was built for a true-black AMOLED canvas, where the
 * panels go to #000. Sampling the render shows its panels are a warm near-black
 * with a red cast (#151016 on the conversation panel, #0f0b0f on the rails),
 * which is a different object. Taking the AMOLED values would have been
 * inheriting a decision made for a different constraint.
 *
 * IDENTITY IS NOT APPEARANCE. ADR §5: "Theme identity and OS appearance
 * preference must be modeled independently." An identity here is a complete
 * palette, not a light/dark pair — Bone is a light identity and Vermilion a
 * dark one, and neither is the other inverted. `ThemeProvider` keeps the two
 * controls orthogonal and resolves `appearance: "auto"` against the OS.
 */

export type Identity = 'vermilion' | 'azure' | 'bone'

/** How an identity reads to the browser, for form controls and scrollbars. */
export type ColorScheme = 'dark' | 'light'

export interface ColorTokens {
  /** The page itself. Scenic art is painted onto this, never under data. */
  canvas: string
  /** Panels and cards: the surfaces content sits on. */
  surface: string
  /** Rail panels and tiles, a step back from `surface`. */
  surfaceSunken: string
  /** Hover and raised states, a step forward from `surface`. */
  surfaceRaised: string
  /** Hairlines and inactive container boundaries. Decorative: no floor. */
  line: string
  /** Boundaries that must be seen. Held to 3:1 against `canvas`. */
  lineStrong: string
  /** Body text. Held to 4.5:1 on canvas, surface and both variants. */
  text: string
  /** Secondary text. Same floor as `text`; it is still text. */
  textMuted: string
  /** The identity mark. Held to 4.5:1 — it carries numerals and labels. */
  accent: string
  /** A darker accent that can carry `accentInk` on top of it. */
  accentFill: string
  /** Ink for `accentFill`. */
  accentInk: string
  /** Status inks, each held to 4.5:1 on `surface`. */
  success: string
  warning: string
  danger: string
  /** The focus ring. Held to 3:1 on every surface it can land on (SC 1.4.11). */
  focus: string

  /**
   * The veil behind a modal. A full rgba(), because it is translucent by
   * definition and the alpha is part of the decision.
   *
   * Not `black/60`. On the two dark identities that is indistinguishable from
   * a tint of their own canvas, but on Bone it turns porcelain paper into a
   * dead grey (#5a5d62) that belongs to no palette in this product. Each
   * identity veils toward its own deepest ink instead.
   */
  scrim: string

  /*
   * Metal. These four drive the armour plates, straps and rivets in
   * `chrome/Ornament.tsx`.
   *
   * They are deliberately NOT derived from the surface tokens. The chrome in
   * the reference renders is a material — it catches light, has a lit edge and
   * a shadowed under-edge — and a plate tinted from `surfaceRaised` reads as a
   * lighter rectangle instead. It is also purely decorative and carries no
   * text, so SC 1.4.11 does not bind it and it is free to sit close to the
   * panel it is mounted on.
   */
  plate: string
  plateHi: string
  plateLo: string
  plateEdge: string
  rivet: string
}

export interface IdentityDefinition {
  id: Identity
  /** What the founder sees in the theme picker. */
  label: string
  /** One line, for the picker. */
  description: string
  scheme: ColorScheme
  colors: ColorTokens
}

/**
 * Vermilion Dark — the first implementation benchmark (ADR §12, question 4).
 *
 * Sampled from `01-VERMILION-DARK.png`: the accent reads #ff3e3d in the KPI
 * numerals, which is within a hair of the ADR's proposed #F22D3D and of the
 * value the CSS pack arrived at independently. Panels sample #151016 and the
 * rails #0f0b0f.
 *
 * ADR §5 is explicit that success must not be recoloured to red here. It stays
 * green, so "passing" and "urgent" never share a hue in the identity whose
 * whole palette is red.
 */
const VERMILION: IdentityDefinition = {
  id: 'vermilion',
  label: 'Vermilion',
  description: 'Obsidian planes, oxblood panels, a red moon behind the torii',
  scheme: 'dark',
  colors: {
    canvas: '#0a070c',
    surface: '#151016',
    surfaceSunken: '#0f0b0f',
    surfaceRaised: '#1d1620',
    line: '#3a2730',
    lineStrong: '#7d5560',
    text: '#ffffff',
    textMuted: '#cbb2b9',
    accent: '#ff3e3d',
    accentFill: '#b81d24',
    accentInk: '#ffffff',
    success: '#6ee7a0',
    warning: '#ffc266',
    danger: '#ff8a93',
    focus: '#ff6f7c',
    scrim: 'rgba(6, 3, 7, 0.72)',
    plate: '#413039',
    plateHi: '#8f717e',
    plateLo: '#1a1219',
    plateEdge: '#a77483',
    rivet: '#f0c489',
  },
}

/**
 * Azure Dark — midnight indigo, cobalt chrome, a crimson horizon.
 *
 * Sampled from `03-AZURE-DARK.png` (canvas #060d19, panel #10192e, header band
 * #0e1e35, cobalt #267fb5). The cobalt the render uses is an ornament colour:
 * measured as text on this panel it reaches only about 4:1, so `accent` is the
 * brightened #58a8e0 that clears the text floor, and the sampled cobalt lives
 * on as `accentFill` beneath white ink.
 */
const AZURE: IdentityDefinition = {
  id: 'azure',
  label: 'Azure',
  description: 'Midnight indigo, cobalt chrome, a crimson horizon line',
  scheme: 'dark',
  colors: {
    canvas: '#060d19',
    surface: '#10192e',
    surfaceSunken: '#0c1931',
    surfaceRaised: '#17243f',
    line: '#2a4162',
    lineStrong: '#5a7ba8',
    text: '#eaf1fb',
    textMuted: '#a9bdd8',
    accent: '#58a8e0',
    accentFill: '#1d5f94',
    accentInk: '#ffffff',
    // Greener than the #5fd3a6 the CSS pack used. That value is a teal at hue
    // 157 and this identity's accent is a sky blue at 205 — 48 degrees apart,
    // close enough that "passing" and "selected" read as the same colour on a
    // small chip. #62da8a is the smallest move that clears 60 degrees of
    // separation while staying in the cool half of the wheel.
    success: '#62da8a',
    warning: '#ffbf5c',
    danger: '#ff8f99',
    focus: '#7cc4f0',
    scrim: 'rgba(3, 7, 14, 0.72)',
    plate: '#2c4066',
    plateHi: '#7596c4',
    plateLo: '#121c30',
    plateEdge: '#8fb4dd',
    rivet: '#e8c07f',
  },
}

/**
 * Bone Light — porcelain paper, ink navy, crisp cobalt outlines.
 *
 * ADR §5: "should not be the dark theme with brightness inverted." It is not —
 * it was drawn from `02-BONE-LIGHT.png`, where the paper samples #f9f8fd in the
 * gutter and #ffffff in a panel body. An earlier brief of mine put the canvas
 * at #c7d6f7; that came from a different image and was wrong. The blue you read
 * in the render is sky and wave *ink on paper*, not the paper itself.
 */
const BONE: IdentityDefinition = {
  id: 'bone',
  label: 'Bone',
  description: 'Porcelain paper, ink navy, sakura and a cobalt outline',
  scheme: 'light',
  colors: {
    canvas: '#e2e9f6',
    surface: '#ffffff',
    surfaceSunken: '#eef2fb',
    surfaceRaised: '#f7f9ff',
    line: '#c3d2ea',
    lineStrong: '#516390',
    text: '#0a0f1c',
    textMuted: '#3a4868',
    accent: '#0d3a9b',
    accentFill: '#0d3a9b',
    accentInk: '#ffffff',
    success: '#05704c',
    warning: '#7a4500',
    danger: '#a81f35',
    focus: '#0d3a9b',
    scrim: 'rgba(10, 15, 28, 0.38)',
    plate: '#aebfdd',
    plateHi: '#ffffff',
    plateLo: '#8fa0c4',
    plateEdge: '#4a5c87',
    rivet: '#a06f28',
  },
}

export const IDENTITIES: Record<Identity, IdentityDefinition> = {
  vermilion: VERMILION,
  azure: AZURE,
  bone: BONE,
}

export const IDENTITY_ORDER: Identity[] = ['vermilion', 'azure', 'bone']

/**
 * Scale tokens, shared by every identity.
 *
 * These do not vary by palette: an identity changes what the product is made
 * of, not how densely it is packed. Keeping them here rather than in Tailwind
 * config means one place to read, and the same place the colours live.
 */
export const SCALE = {
  /** 4px base. The render's rhythm is an 8px grid with 4px for inner padding. */
  space: { px: '1px', 0.5: '2px', 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px', 10: '40px', 12: '48px' },
  radius: { none: '0', sm: '4px', md: '8px', lg: '12px', chamfer: '10px' },
  /** Elevation is a border plus a shadow; on dark identities the border does most of it. */
  elevation: {
    flat: 'none',
    panel: '0 1px 0 rgba(0,0,0,0.25)',
    raised: '0 4px 14px rgba(0,0,0,0.35)',
  },
  /** Density: the dashboard is information-dense by design. */
  density: { rowHeight: '38px', tileHeight: '92px', headerHeight: '128px', navHeight: '40px' },
  /**
   * Motion. ADR §5: "purposeful state feedback only ... with reduced-motion
   * alternatives." Every duration here is under the 200ms where a transition
   * stops reading as feedback and starts reading as animation.
   */
  motion: {
    instant: '0ms',
    fast: '120ms',
    base: '160ms',
    ease: 'cubic-bezier(0.2, 0, 0, 1)',
  },
} as const

/** The CSS custom property name for a colour token. */
export function cssVar(token: keyof ColorTokens): string {
  return `--hg-${token.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`
}

/** Every colour token of an identity, as the CSS custom properties to set. */
export function cssVarsFor(identity: Identity): Record<string, string> {
  const out: Record<string, string> = {}
  const { colors } = IDENTITIES[identity]
  for (const key of Object.keys(colors) as (keyof ColorTokens)[]) {
    out[cssVar(key)] = colors[key]
  }
  return out
}
