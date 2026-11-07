import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * The /your-repos page, the React conversion.
 *
 * WHY LIVE-ONLY. This file never ran against the fixture server, because the
 * page only exists when a Go binary with the React bundle is serving
 * `/your-repos` behind `ReactIsDefault`. Set `HG_BASE_URL` to a running
 * instance (not :7340, not :7361 — see ADR-UI-002 §7) and run this suite.
 * Without it the describe block skips, instead of failing on a shape the
 * fixture never carried.
 *
 * WHAT THIS GATE EXISTS TO CATCH. The failure mode this page can produce is
 * subtle: a tile that reads "0 Open PRs" while nobody has looked at the
 * pipeline yet. Everything else about the page could look correct and that
 * one lie — "there is nothing waiting for you" about data that is unknown —
 * would ship. Every check below was proved red against a broken-on-purpose
 * build before it was declared green:
 *
 *   [RED → GREEN] unknownIsNotZero
 *     Broken: `known` prop stripped from `<Tile>` so it always rendered the
 *     value. Spec saw "0" in the Open PRs tile, failed as expected.
 *     Fixed: `known` back; spec sees "—" when `pipelineKnown` is false.
 *
 *   [RED → GREEN] zeroIsStillZero
 *     Broken: tile forced to "—" unconditionally. Spec saw "—" where the
 *     server reports `workKnown: true, reposNew: 0`, failed. This is the
 *     counterpart test to the one above: unknown must render "—" AND a
 *     real zero must render "0". A test that only checks one half passes
 *     when the UI never shows anything.
 *     Fixed: condition restored; "0" renders when known and reposNew is 0.
 *
 *   [RED → GREEN] navLandsHere
 *     Broken: commented out the "Your repositories" tab in NAV_TABS. Spec
 *     could not find the active nav anchor. Restored.
 *
 *   [RED → GREEN] noHorizontalOverflowAt390
 *     Broken: added `min-w-[600px]` to the overview grid. `<main>` has
 *     `overflow-x-hidden` which hid the inner overflow from
 *     `documentElement.scrollWidth`, so the first version of this test passed
 *     anyway — a check that cannot go red is not a check. The test now
 *     measures `<main>.scrollWidth` too, and in that form it failed as
 *     expected; the `min-w` was then removed.
 *
 *   [RED → GREEN] axeClean
 *     Broken: added a 32×32 `<img>` with no alt attribute. Axe reported
 *     image-alt as a critical violation. Removed.
 *
 *   [RED → GREEN] noConsoleErrorsOnLoad
 *     Broken: added a top-level `console.error('deliberate-red-marker')`
 *     to the module. Spec captured it and failed. Removed.
 */

const live = !!process.env.HG_BASE_URL

async function gotoYourRepos(page: Page) {
  await page.goto('/your-repos', { waitUntil: 'networkidle' })
  // The page's own h1 lives inside <main>; a top-of-page h1 is the masthead.
  await expect(page.locator('main h1', { hasText: 'Your repositories' })).toBeVisible()
}

test.describe('the /your-repos page', () => {
  test.skip(!live, 'set HG_BASE_URL to a running instance to run this suite')

  test('an unknown pipeline figure renders as em-dash, not 0', async ({ page }) => {
    // Intercept the API with pipelineKnown=false to simulate a cold start.
    // Even on a long-running instance we cannot rely on this state naturally —
    // the gate is about the UI's rendering of the bit, so we set the bit.
    await page.route('**/app/api/your-repos.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pipelineKnown: false,
          workKnown: false,
          partial: false,
          login: 'FawwazLawal',
          open: 0,
          merged: 0,
          reposNew: 0,
          you: [],
          done: [],
          repoOther: [],
        }),
      }),
    )
    await gotoYourRepos(page)
    const main = page.locator('main')
    // The Open PRs and Merged tiles both unknown — each must render "—",
    // and neither may render "0" (the whole point of this gate).
    for (const label of ['Open PRs', 'Merged']) {
      const tile = main.locator(`:text("${label}")`).locator('..')
      await expect(tile).toContainText('—')
      // The value area is the direct-child mono-tabular div after the label.
      const valueText = await tile.locator('div.font-mono').first().innerText()
      expect(valueText.trim()).toBe('—')
    }
  })

  test('a known zero still renders as 0, not em-dash', async ({ page }) => {
    await page.route('**/app/api/your-repos.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pipelineKnown: true,
          workKnown: true,
          partial: false,
          login: 'FawwazLawal',
          open: 0,
          merged: 0,
          reposNew: 0,
          you: [],
          done: [],
          repoOther: [],
        }),
      }),
    )
    await gotoYourRepos(page)
    for (const label of ['Open PRs', 'Merged', 'Unread']) {
      const tile = page.locator('main').locator(`:text("${label}")`).locator('..')
      const valueText = await tile.locator('div.font-mono').first().innerText()
      expect(valueText.trim()).toBe('0')
    }
  })

  test('the nav lands here with aria-current="page"', async ({ page }) => {
    await gotoYourRepos(page)
    const active = page.locator('nav[aria-label="Primary"] a[aria-current="page"]')
    await expect(active).toHaveText(/Your repositories/)
    await expect(active).toHaveAttribute('href', '/your-repos')
  })

  test('no horizontal overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoYourRepos(page)
    // `overflow-x-hidden` on <main> hides inner overflow visually but does not
    // repair it, so measuring documentElement.scrollWidth alone passes even
    // when an inner element busts its container. Check <main>'s own scrollWidth
    // too, so a child that goes wider is caught even when the clip hides it.
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement
      return {
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth,
        mainScrollW: main?.scrollWidth ?? 0,
        mainClientW: main?.clientWidth ?? 0,
      }
    })
    expect(overflow.docScrollW).toBeLessThanOrEqual(overflow.docClientW)
    expect(overflow.mainScrollW).toBeLessThanOrEqual(overflow.mainClientW)
  })

  test('axe reports no serious or critical violations', async ({ page }) => {
    await gotoYourRepos(page)
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious, serious.map((v) => `${v.id}: ${v.description}`).join('\n')).toEqual([])
  })

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(e.message))
    await gotoYourRepos(page)
    expect(errors).toEqual([])
  })
})
