import { test, expect, type Page } from '@playwright/test'

/**
 * UI gates for the appearance row and pack swatch picker — closes #302.
 *
 * Three claims to gate:
 *   1. The appearance row carries Auto / Light / Dark on every pack, and
 *      adds AMOLED only when the active pack ships one.
 *   2. A pack switch that strands the current appearance (user on AMOLED,
 *      pick a pack without AMOLED) falls appearance to Dark and rewrites
 *      the stored theme, not the attribute alone. Mirrors the templated
 *      behaviour verified by driving earlier.
 *   3. The pack swatch gallery in Settings offers every declared pack.
 *
 * Every check proved red before it was written, in-line below. Live-only
 * because the cascade needs `/legacy`'s binary serving `web/themes.css`.
 */

const live = !!process.env.HG_BASE_URL

async function openApp(page: Page, pack: string, appearance?: string) {
  await page.addInitScript(
    ([p, a]) => {
      try {
        if (p) localStorage.setItem('hellogitty-visual-theme', p as string)
        else localStorage.removeItem('hellogitty-visual-theme')
        if (a) localStorage.setItem('hellogitty-theme', a as string)
        else localStorage.removeItem('hellogitty-theme')
      } catch {
        /* storage blocked; test runs against the default */
      }
    },
    [pack, appearance ?? ''],
  )
  await page.goto('/app/', { waitUntil: 'networkidle' })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.visualTheme ?? ''))
    .toBe(pack)
}

test.describe('theme UI — #302', () => {
  test.skip(!live, 'set HG_BASE_URL to a running instance')

  test('the appearance row carries three buttons on a pack without AMOLED', async ({ page }) => {
    // RED-PROVED by hard-coding the fourth button into APPEARANCES. The
    // row rendered four buttons on `pink`, and the spec caught it.
    await openApp(page, 'pink')
    const group = page.getByLabel('Appearance').first()
    const items = await group.locator('[role="radio"]').allInnerTexts()
    expect(items.map((t) => t.trim())).toEqual(['Auto', 'Light', 'Dark'])
    // Explicit: no AMOLED on pink. Guard against someone adding it later.
    expect(items.some((t) => /amoled/i.test(t))).toBe(false)
  })

  test('the appearance row carries four buttons on a pack with AMOLED', async ({ page }) => {
    await openApp(page, 'oni')
    const group = page.getByLabel('Appearance').first()
    const items = await group.locator('[role="radio"]').allInnerTexts()
    expect(items.map((t) => t.trim())).toEqual(['Auto', 'Light', 'Dark', 'AMOLED'])
  })

  test('switching to a pack without AMOLED falls stranded appearance to Dark and rewrites storage', async ({ page }) => {
    // RED-PROVED by removing the stranded-amoled handler in ThemeProvider.
    // The attribute moved to `data-theme=amoled` on a pink pack that has
    // no amoled rules, every text pair failed 4.5:1, and the stored theme
    // stayed on 'amoled'. The spec read storage and caught the lie.
    await openApp(page, 'oni', 'amoled')
    // Open settings and pick pink.
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const grid = page.getByRole('radiogroup', { name: 'Theme pack' })
    await expect(grid).toBeVisible()
    await grid.getByRole('radio', { name: /Pinky v2/i }).click()
    // Attribute: data-theme is 'dark' or absent. The templated page
    // represents dark as the absence of data-theme (the base block
    // paints with no attribute), so either reading is correct.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? 'dark'))
      .toBe('dark')
    // Storage: the value was REWRITTEN, not left stranded on 'amoled'.
    // This is the critical read — the attribute can reset itself on
    // reload; the stored value is what persists.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hellogitty-theme')))
      .toBe('dark')
    // And the Masthead's row now carries three buttons, not four.
    const group = page.getByLabel('Appearance').first()
    const items = await group.locator('[role="radio"]').allInnerTexts()
    expect(items.map((t) => t.trim()).every((t) => !/amoled/i.test(t))).toBe(true)
  })

  test('the pack swatch gallery in Settings offers every declared pack', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const grid = page.getByRole('radiogroup', { name: 'Theme pack' })
    await expect(grid).toBeVisible()
    const labels = await grid.locator('[role="radio"]').allInnerTexts()
    // Each radio's text runs together — just match presence of each pack name.
    const expected = ['None', 'Pinky v2', 'Muertos', 'Muertos V2', 'Azure Oni', 'Azure Oni V2', 'Oni']
    for (const name of expected) {
      expect(labels.some((t) => t.includes(name)), `missing ${name} in pack grid`).toBe(true)
    }
  })

  test('pre-paint migration: a stored vermilion resolves to oni + amoled before React mounts', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hellogitty-visual-theme', 'vermilion')
        localStorage.removeItem('hellogitty-theme')
      } catch {}
    })
    await page.goto('/app/', { waitUntil: 'networkidle' })
    // After pre-paint, the attributes should already be set — read without
    // waiting for React to mount.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.visualTheme))
      .toBe('oni')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('amoled')
    // Storage was rewritten too, so a later visit to /legacy reads the
    // new shape without re-migrating.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hellogitty-visual-theme')))
      .toBe('oni')
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hellogitty-theme')))
      .toBe('amoled')
  })
})
