import { test, expect, type Page } from '@playwright/test'

/**
 * Adoption test for the ToggleGroup primitive (Radix + cva).
 *
 * WHAT THIS GATES. The hand-rolled `<button aria-pressed>` + `role="group"`
 * segmented controls that shipped before this file worked with Tab and
 * Space/Enter, but not with the arrow keys. The WAI-ARIA radiogroup pattern
 * calls for a roving tabindex (one Tab into the group, arrows within it), and
 * keyboard users of the Masthead were paying three Tab presses per group
 * instead of one. Radix ToggleGroup implements the roving-tabindex itself;
 * this spec checks it actually does.
 *
 * Both checks were proved red before green (notes in the commit).
 */

const live = !!process.env.HG_BASE_URL

async function gotoDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'HelloGitty', exact: true })).toBeVisible()
}

test.describe('ToggleGroup — Masthead', () => {
  test.skip(!live, 'set HG_BASE_URL to a running instance to run this suite')

  test('arrow-key navigation moves focus within a group', async ({ page }) => {
    await gotoDashboard(page)
    // Radix single-select renders the group as role="radiogroup". The test
    // lands on the group by its aria-label — role-hunting for "group" catches
    // the surrounding `<div role="group">` wrappers too.
    const group = page.getByLabel('Appearance').first()
    const current = group.locator('[data-state="on"]').first()
    const startLabel = (await current.textContent())?.trim()
    await current.focus()
    await page.keyboard.press('ArrowRight')
    // DO NOT REPLACE THIS POLL WITH A STRAIGHT page.evaluate. Radix's
    // rovingFocus handler runs on keydown, so there is a tiny window after
    // `keyboard.press('ArrowRight')` returns where focus has not moved yet.
    // A single-read made this test flake roughly 1 in 3 runs — reading
    // state that is still settling always does. `expect.poll` keeps asking
    // until focus has actually moved (or the timeout trips, which is the
    // genuine failure case). The read below then captures the settled value
    // for the inside-the-group assertion that follows.
    await expect
      .poll(async () =>
        (await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')) ?? '',
      )
      .not.toBe(startLabel)
    const focusedLabel =
      (await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')) ?? ''
    // The focused element after ArrowRight must be inside the group AND
    // must not be the same element we started on. The hand-rolled
    // `<button aria-pressed>` version kept focus on the original button
    // under ArrowRight and failed this. Radix moves focus; the test passes.
    const items = (await group.locator('button').allInnerTexts()).map((t) => t.trim())
    expect(items).toContain(focusedLabel)
    expect(focusedLabel).not.toBe(startLabel)
  })

  test('activating an item changes the selected option', async ({ page }) => {
    await gotoDashboard(page)
    const group = page.getByLabel('Appearance').first()
    const current = group.locator('[data-state="on"]').first()
    const startLabel = (await current.textContent())?.trim()
    // Click an item that is NOT currently on. Radix ToggleGroup type="single"
    // flips the data-state to that item. If the primitive were broken (no
    // value prop, or the group mis-wired), the on-state would not move, and
    // this spec would fail.
    const notCurrent = group.locator('button[data-state="off"]').first()
    await notCurrent.click()
    await expect
      .poll(async () => (await group.locator('[data-state="on"]').first().textContent())?.trim())
      .not.toBe(startLabel)
  })
})
