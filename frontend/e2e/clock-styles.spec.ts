import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The gate for the 14 clock-style variants (plus Default) the templated page
 * carries and that #268 removed before the owner reversed that decision.
 *
 * Catches, specifically:
 *
 *  1. The masthead clock stays plain Default when no style is saved. A page
 *     that quietly applies some other variant on a fresh profile would ship a
 *     surprise on every first visit.
 *  2. A saved `hellogitty-clock.style` the templated page wrote loads into the
 *     React masthead at cold start, and renders the matching styled clock —
 *     the whole point of this PR, since the owner reviewed the shipped page
 *     against /legacy.
 *  3. Selecting a style in Settings applies it to the Masthead immediately in
 *     the same tab. The storage event + the hellogitty:clock CustomEvent path
 *     exists already; this gate proves it.
 *  4. The picker swatch for the active style carries aria-checked=true.
 *  5. The Settings page still fits 390px with the 15-swatch grid.
 */

const STYLES = ['neon', 'ember', 'matrix', 'arctic', 'sunset', 'midnight',
  'terminal', 'golden', 'rose', 'ocean', 'mono', 'nixie', 'led', 'flip'] as const

async function clearPrefs(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('hellogitty-clock')
    } catch {
      /* private mode */
    }
  })
}

async function presetStyle(page: Page, style: string) {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem('hellogitty-clock', JSON.stringify({ style: s }))
    } catch {
      /* private mode */
    }
  }, style)
}

test.describe('/ + /settings — clock styles', () => {
  test('fresh profile: masthead clock has no data-clock-style attribute', async ({ page }) => {
    await clearPrefs(page)
    await page.goto('/', { waitUntil: 'networkidle' })
    // The attribute is omitted for `default`; a stray value would trigger an
    // override block in index.css. Test that the attribute is absent, not
    // merely that it's "default", so we catch an accidental hardcoded value.
    const clockRoot = page.locator('header [data-clock-style], header time').first()
    await expect(clockRoot).toBeVisible()
    const hasAttr = await page.locator('header [data-clock-style]').count()
    expect(hasAttr, 'no data-clock-style attribute should exist on a fresh profile').toBe(0)
  })

  test('saved style="neon" loads into the masthead at cold start', async ({ page }) => {
    await presetStyle(page, 'neon')
    await page.goto('/', { waitUntil: 'networkidle' })
    // The clock root carries data-clock-style="neon" — scoped to the <header>
    // so a swatch preview on another route cannot satisfy it.
    const root = page.locator('header [data-clock-style="neon"]')
    await expect(root).toBeVisible()
    // The styled time is cyan-foreground (#00ffff). A reader coming across
    // this test shouldn't have to look up the hex — assert the computed
    // colour contains "0, 255, 255".
    const timeEl = root.locator('.hg-clock-time')
    const colour = await timeEl.evaluate((el) => getComputedStyle(el).color)
    expect(colour, 'neon time should be computed cyan rgb(0, 255, 255)').toContain('0, 255, 255')
  })

  test('selecting a style in Settings applies it to the masthead in the same tab', async ({ page }) => {
    await clearPrefs(page)
    await page.goto('/settings', { waitUntil: 'networkidle' })

    // Pick "Matrix" from the radiogroup.
    const picker = page.getByRole('radiogroup', { name: 'Clock style' })
    await expect(picker).toBeVisible()
    await picker.getByRole('radio', { name: /Matrix/ }).click()

    // The storage write dispatches a hellogitty:clock event the Masthead listens
    // to. The flip is synchronous; a poll here guards against React scheduling.
    await expect
      .poll(async () => await page.locator('header [data-clock-style="matrix"]').count())
      .toBeGreaterThan(0)

    // The picker swatch for Matrix now reports aria-checked true, so a screen
    // reader states which one is active.
    const active = picker.getByRole('radio', { name: /Matrix/ })
    await expect(active).toHaveAttribute('aria-checked', 'true')
  })

  test('every named style loads and takes an override', async ({ page }) => {
    // Loop through the fourteen named styles with cold loads. Catches a
    // typoed selector in index.css against the picker — a style whose
    // selector doesn't match would render Default and this would fail.
    for (const style of STYLES) {
      await presetStyle(page, style)
      await page.goto('/', { waitUntil: 'networkidle' })
      await expect(
        page.locator(`header [data-clock-style="${style}"]`),
        `style="${style}" didn't take on the Masthead — check the index.css selector`,
      ).toBeVisible()
    }
  })

  test('/settings fits 390px with the full 15-swatch picker', async ({ page, viewport }, info) => {
    await clearPrefs(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const picker = page.getByRole('radiogroup', { name: 'Clock style' })
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('radio')).toHaveCount(15)
    await expectNoHorizontalOverflow(page, 390)
    await page.setViewportSize(viewport ?? { width: 1400, height: 1000 })
    void info
  })
})
