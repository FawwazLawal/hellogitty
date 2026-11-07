import { describe, expect, it } from 'vitest'
import { IDENTITY_ORDER, IDENTITIES, type ColorTokens } from './tokens'

/**
 * Every text pair in every identity, recomputed from the tokens themselves.
 *
 * The Go side already learned this lesson the expensive way: comments in the
 * stylesheet asserted contrast ratios the colours did not have, and one false
 * figure in a file of measurements makes the rest unciteable. Prose cannot be
 * checked. This computes instead.
 *
 * It is also the thing that makes a palette change safe. Any of these tokens
 * can be nudged for art-direction reasons, and if the nudge pushes a pair under
 * its floor the suite says so with the number, before it reaches a screenshot.
 */

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Calibration: a known WCAG pair, so a broken formula cannot pass silently. */
describe('the contrast formula itself', () => {
  it('reproduces a known pair', () => {
    // #767676 on white is the canonical "just passes AA" grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })
})

/** Foreground tokens that carry text, and so take the 4.5:1 floor. */
const TEXT_INKS: (keyof ColorTokens)[] = ['text', 'textMuted', 'accent', 'success', 'warning', 'danger']

/** Surfaces that text can land on. */
const TEXT_SURFACES: (keyof ColorTokens)[] = ['canvas', 'surface', 'surfaceSunken', 'surfaceRaised']

describe.each(IDENTITY_ORDER)('identity: %s', (id) => {
  const { colors, label } = IDENTITIES[id]

  it.each(TEXT_INKS)(`%s clears 4.5:1 on every surface`, (ink) => {
    for (const surface of TEXT_SURFACES) {
      const ratio = contrastRatio(colors[ink], colors[surface])
      expect(
        ratio,
        `${label}: --${ink} ${colors[ink]} on --${surface} ${colors[surface]} is ${ratio.toFixed(2)}:1, below the 4.5:1 floor for text`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('accentInk is readable on accentFill', () => {
    const ratio = contrastRatio(colors.accentInk, colors.accentFill)
    expect(
      ratio,
      `${label}: --accentInk ${colors.accentInk} on --accentFill ${colors.accentFill} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * SC 1.4.11, non-text contrast. The focus ring is held to 3:1 on every
   * surface it can land on, because the Go side shipped a focus indicator at
   * 2.08:1 for exactly as long as nobody computed it.
   */
  it('the focus ring clears 3:1 on every surface', () => {
    for (const surface of TEXT_SURFACES) {
      const ratio = contrastRatio(colors.focus, colors[surface])
      expect(
        ratio,
        `${label}: --focus ${colors.focus} on --${surface} ${colors[surface]} is ${ratio.toFixed(2)}:1, below the 3:1 WCAG 1.4.11 floor — a keyboard user cannot see where focus is`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('lineStrong clears 3:1 on the canvas', () => {
    const ratio = contrastRatio(colors.lineStrong, colors.canvas)
    expect(
      ratio,
      `${label}: --lineStrong ${colors.lineStrong} on --canvas ${colors.canvas} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(3)
  })

  /**
   * ADR §5, Vermilion: "Do not recolor semantic success indicators to red."
   * Checked as a measurement rather than trusted as a rule: success must stay
   * far enough from the accent in hue that the two cannot be confused.
   */
  it('success is not the accent hue', () => {
    const hue = (hex: string) => {
      const h = hex.replace('#', '')
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max === min) return 0
      const d = max - min
      const deg = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      return ((deg * 60) % 360 + 360) % 360
    }
    const separation = Math.abs(hue(colors.success) - hue(colors.accent))
    const circular = Math.min(separation, 360 - separation)
    expect(
      circular,
      `${label}: --success ${colors.success} and --accent ${colors.accent} are ${circular.toFixed(0)}° apart; status and identity would read as the same colour`,
    ).toBeGreaterThan(60)
  })
})
