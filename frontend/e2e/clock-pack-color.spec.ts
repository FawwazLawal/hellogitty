import { test, expect, type Page } from '@playwright/test'

/**
 * The gate for #307: packs state a clock-colour token, React reads it,
 * the per-style layer overrides it.
 *
 * WHY THIS IS A TOKEN SUITE, not a selector suite. The templated side's
 * pack-level clock rules key on `.hclock-time` (a class the templated
 * markup renders and React does not). Sharing the pack cascade via
 * `@import '../../web/themes.css'` therefore brought the colour in but
 * never matched the selector. The alternative selector — a React-side
 * `[data-visual-theme="oni"] .hg-clock-time { color: … }` rule — would be
 * specificity (0,2,0), identical to the per-style selectors, and the
 * cascade winner would depend on which stylesheet the browser applied
 * last (Go-served `web/themes.css` vs Vite-bundled `src/index.css`).
 * That is a load-order race nothing in either file controls, latent until
 * an unrelated asset-ordering change flips it. The fix is a token:
 * pack states `--hg-clock-color`, base `.hg-clock-time` reads it, per-style
 * rules override `color` at higher specificity than the base.
 *
 * Covers:
 *  1. Oni + no style + dark      → clock reads `--pack-crimson` (dark hex).
 *  2. Oni + no style + light     → clock reads the lighter oni-paper crimson.
 *  3. Oni + style=neon           → clock reads neon cyan — style over pack.
 *  4. No pack + no style         → clock falls back to `--hg-text`.
 *  5. A second pack that states NO clock colour renders plain text ink —
 *     the token must not leak across packs.
 */

const APPEARANCE_KEY = 'hellogitty-theme'
const VISUAL_KEY = 'hellogitty-visual-theme'
const CLOCK_KEY = 'hellogitty-clock'

async function setPrefs(page: Page, opts: { pack?: string; appearance?: string; style?: string }) {
  await page.addInitScript(({ pack, appearance, style, APPEARANCE_KEY, VISUAL_KEY, CLOCK_KEY }) => {
    try {
      if (pack) localStorage.setItem(VISUAL_KEY, pack)
      else localStorage.removeItem(VISUAL_KEY)
      if (appearance) localStorage.setItem(APPEARANCE_KEY, appearance)
      else localStorage.removeItem(APPEARANCE_KEY)
      if (style) localStorage.setItem(CLOCK_KEY, JSON.stringify({ style }))
      else localStorage.removeItem(CLOCK_KEY)
    } catch {
      /* private mode */
    }
  }, { pack: opts.pack ?? null, appearance: opts.appearance ?? null, style: opts.style ?? null, APPEARANCE_KEY, VISUAL_KEY, CLOCK_KEY })
}

async function clockComputedColor(page: Page): Promise<string> {
  return page.locator('header .hg-clock-time').first().evaluate((el) => getComputedStyle(el).color)
}

test.describe('/ — clock colour × pack × style', () => {
  test('Oni dark: clock paints `--pack-crimson` (255, 61, 76)', async ({ page }) => {
    // Appearance=dark explicitly: unset appearance falls through to auto,
    // which Playwright resolves to whatever `prefers-color-scheme` the test
    // browser was launched with (light by default), and we'd be measuring the
    // light hex instead of the dark one. The appearance axis is a separate
    // test; here we're asserting the dark-oni token value.
    await setPrefs(page, { pack: 'oni', appearance: 'dark' })
    await page.goto('/', { waitUntil: 'networkidle' })
    const colour = await clockComputedColor(page)
    expect(colour, 'Oni dark should paint the clock crimson via --hg-clock-color token').toContain('255, 61, 76')
  })

  test('Oni light: clock paints the paper crimson (168, 31, 53)', async ({ page }) => {
    await setPrefs(page, { pack: 'oni', appearance: 'light' })
    await page.goto('/', { waitUntil: 'networkidle' })
    const colour = await clockComputedColor(page)
    expect(colour, 'Oni light should paint the clock in the darker paper-safe crimson').toContain('168, 31, 53')
  })

  test('Oni amoled: clock stays crimson across all three appearances', async ({ page }) => {
    // Templated oni carries the same clock treatment in all three appearances —
    // one of the written-up design decisions on that pack. Amoled must not
    // regress to --text just because the attribute set changed.
    await setPrefs(page, { pack: 'oni', appearance: 'amoled' })
    await page.goto('/', { waitUntil: 'networkidle' })
    const colour = await clockComputedColor(page)
    expect(colour, 'Oni amoled should carry the identity crimson, same as dark').toContain('255, 61, 76')
  })

  test('Oni + style=neon: style wins over pack', async ({ page }) => {
    // The whole point of the token approach is that packs and styles stop
    // competing in the cascade: a pack sets the token, a chosen style
    // overrides `color` directly at higher specificity than the base rule.
    // If this test regresses to crimson, the per-style specificity has
    // collapsed to the base — the race is back.
    await setPrefs(page, { pack: 'oni', style: 'neon' })
    await page.goto('/', { waitUntil: 'networkidle' })
    const colour = await clockComputedColor(page)
    expect(colour, 'style=neon must beat the pack-stated clock colour (style > pack)').toContain('0, 255, 255')
  })

  test('No pack: clock falls back to `--hg-text` text ink', async ({ page }) => {
    await setPrefs(page, {})
    await page.goto('/', { waitUntil: 'networkidle' })
    const colour = await clockComputedColor(page)
    // Default dark `--hg-text` resolves via the bridge to themes.css base --text.
    // Not asserting an exact hex here because the base dark `--text` is a
    // shared-cascade declaration that may be retuned on its own; what matters
    // is that we're reading a real text-ink value, not the empty-string flash
    // an unset `var()` would produce.
    expect(colour).toMatch(/^rgb(a)?\(/)
    expect(colour, 'with no pack the clock must not land on crimson — token must be unset').not.toContain('255, 61, 76')
  })

  test('A pack that states no clock colour renders plain text ink', async ({ page }) => {
    // Pink has no clock treatment in the templated page and therefore sets
    // no --hg-clock-color. The clock must inherit --hg-text; a leak of the
    // Oni token across packs would show up here.
    await setPrefs(page, { pack: 'pink' })
    await page.goto('/', { waitUntil: 'networkidle' })
    const colour = await clockComputedColor(page)
    expect(colour).toMatch(/^rgb(a)?\(/)
    expect(colour, 'pink states no clock colour; must not inherit Oni crimson').not.toContain('255, 61, 76')
  })
})
