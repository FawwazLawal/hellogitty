import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The gate for the six-pane sidebar on `/settings`.
 *
 * Catches, specifically:
 *
 *  1. All six panes are navigable from the sidebar and only the active one is
 *     rendered. Rendering the inactive ones and hiding them with CSS would
 *     keep their data-queries subscribed; worse, Playwright's text locators
 *     would double-match a heading that is in the DOM twice.
 *
 *  2. Clicking a sidebar item writes `pane-<slug>` into `hg-settings-pane` —
 *     the exact string the templated page uses. The key is pinned here as a
 *     literal, not imported from the component, so a rename of the storage
 *     key that breaks cross-tab sync with /legacy must fail this test. The
 *     /issues `prs`-vs-`pr` rename passed its tests the same way, and the
 *     lesson is to not do that again.
 *
 *  3. A cold load of `/settings#server` activates the Server pane. The hash
 *     wins over the saved value — a shared deep link must take the viewer
 *     where it points, not where they were last.
 *
 *  4. With a saved pane and NO hash, the saved value wins on cold load. This
 *     is the complement to (3); test both paths, not one.
 *
 *  5. An unknown saved value falls through to the default rather than
 *     leaving the right column empty. A pane id from an older build (or a
 *     tampered localStorage) must not strand the user on a blank page.
 *
 *  6. 390px fits with the sidebar stacked above the pane and no horizontal
 *     overflow.
 */

const SETTINGS_PANE_KEY = 'hg-settings-pane'

async function clearPane(page: Page) {
  await page.addInitScript((key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* private mode */
    }
  }, SETTINGS_PANE_KEY)
}

async function presetPane(page: Page, paneId: string) {
  await page.addInitScript(({ key, id }) => {
    try {
      localStorage.setItem(key, id)
    } catch {
      /* private mode */
    }
  }, { key: SETTINGS_PANE_KEY, id: paneId })
}

test.describe('/settings — six-pane sidebar', () => {
  test('fresh profile lands on Appearance and sidebar lists all six', async ({ page }) => {
    await clearPane(page)
    await page.goto('/settings', { waitUntil: 'networkidle' })

    const nav = page.getByRole('navigation', { name: 'Settings sections' })
    await expect(nav).toBeVisible()

    // All six labels, in order.
    const labels = ['Appearance', 'Clock', 'Repositories', 'Polling & API', 'Server', 'About']
    for (const label of labels) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible()
    }

    // Appearance is active (aria-current="page").
    await expect(nav.getByRole('link', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page')

    // The right column shows Appearance only — no other pane headings are rendered.
    await expect(page.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Server' })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'About' })).toHaveCount(0)
  })

  test('clicking a sidebar item writes `pane-<slug>` into `hg-settings-pane`', async ({ page }) => {
    await clearPane(page)
    await page.goto('/settings', { waitUntil: 'networkidle' })

    await page.getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Server' })
      .click()

    // DOM flipped.
    await expect(page.getByRole('heading', { level: 2, name: 'Server' })).toBeVisible()

    // Storage. Literal key, literal value — no indirection.
    const saved = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_PANE_KEY)
    expect(saved).toBe('pane-server')

    // URL hash follows.
    expect(await page.evaluate(() => location.hash)).toBe('#server')
  })

  test('cold load with `#server` wins over a saved `pane-clock`', async ({ page }) => {
    await presetPane(page, 'pane-clock')
    await page.goto('/settings#server', { waitUntil: 'networkidle' })

    // Server, not Clock — the hash wins.
    await expect(page.getByRole('heading', { level: 2, name: 'Server' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Clock' })).toHaveCount(0)

    // The visited pane gets written back, so a subsequent reload WITHOUT a
    // hash lands on Server too (per the templated handler).
    const saved = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_PANE_KEY)
    expect(saved).toBe('pane-server')
  })

  test('cold load with no hash and a saved pane lands on the saved pane', async ({ page }) => {
    await presetPane(page, 'pane-about')
    await page.goto('/settings', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { level: 2, name: 'About' })).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Settings sections' })
    await expect(nav.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
  })

  test('an unknown saved pane falls through to Appearance, not a blank page', async ({ page }) => {
    // A pane id from an earlier build or a tampered localStorage must not
    // leave the right column empty.
    await presetPane(page, 'pane-deprecated-styles')
    await page.goto('/settings', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible()
    // The bad value was replaced with a valid one on first write.
    const saved = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_PANE_KEY)
    expect(saved).toBe('pane-appearance')
  })

  test('About pane shows version and GitHub API quota', async ({ page }) => {
    await clearPane(page)
    await page.goto('/settings#about', { waitUntil: 'networkidle' })

    const heading = page.getByRole('heading', { level: 2, name: 'About' })
    await expect(heading).toBeVisible()

    // Version row and GitHub API row both exist — the whole point of the
    // About pane being here is that a reader does not have to go hunting.
    await expect(page.getByText('Version', { exact: true })).toBeVisible()
    await expect(page.getByText('GitHub API', { exact: true })).toBeVisible()
    await expect(page.getByText('API resets', { exact: true })).toBeVisible()
  })

  test('restart notes appear on the Polling and Server panes', async ({ page }) => {
    await page.goto('/settings#polling', { waitUntil: 'networkidle' })
    await expect(page.getByText(/requires a restart to change/i)).toBeVisible()

    await page.goto('/settings#server', { waitUntil: 'networkidle' })
    await expect(page.getByText(/require a restart to take effect/i)).toBeVisible()
  })

  test('/settings fits 390px with the sidebar', async ({ page, viewport }) => {
    await clearPane(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/settings', { waitUntil: 'networkidle' })

    const nav = page.getByRole('navigation', { name: 'Settings sections' })
    await expect(nav).toBeVisible()
    // All six links still reachable.
    await expect(nav.getByRole('link')).toHaveCount(6)

    await expectNoHorizontalOverflow(page, 390)
    await page.setViewportSize(viewport ?? { width: 1400, height: 1000 })
  })
})
