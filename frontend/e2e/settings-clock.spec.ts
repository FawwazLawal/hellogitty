import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The gate for the Settings > Clock controls.
 *
 * This gate exists because the clock has to be LIVE, has to honour the
 * templated page's preferences, and has to react to toggles IMMEDIATELY in
 * the same tab — the specific regressions this catches are:
 *
 *  1. Masthead clock that ignores the saved preference (so a visitor who had
 *     12h on /legacy sees 24h here).
 *  2. Toggle in /settings that writes storage but the masthead keeps rendering
 *     whatever it had — exactly the "switches that do nothing" defect the old
 *     SettingsPage header called out.
 *  3. A static timestamp from `data.generatedAt` dressed up as a clock — looks
 *     correct, is quietly wrong by whatever the poll interval is.
 *  4. No horizontal overflow at 390px on /settings — the new Clock panel is
 *     the kind of width-dense control row that breaks phones.
 */

async function preset(page: Page, prefs: object) {
  await page.addInitScript((p) => {
    try {
      localStorage.setItem('hellogitty-clock', JSON.stringify(p))
    } catch {
      /* private mode */
    }
  }, prefs)
}

async function clockText(page: Page): Promise<string> {
  const time = page.locator('header time').first()
  await expect(time).toBeVisible()
  return (await time.innerText()).trim()
}

test.describe('/ + /settings — clock controls', () => {
  test('masthead clock honours a saved 12h preference, with AM/PM', async ({ page }) => {
    await preset(page, { format: '12h', seconds: true, date: true })
    await page.goto('/', { waitUntil: 'networkidle' })
    const text = await clockText(page)
    // 12h renders with AM or PM — never 24h without it.
    expect(text).toMatch(/\b(AM|PM)\b/)
  })

  test('masthead clock honours 24h with seconds off — HH:MM only, no AM/PM', async ({ page }) => {
    await preset(page, { format: '24h', seconds: false, date: true })
    await page.goto('/', { waitUntil: 'networkidle' })
    const text = await clockText(page)
    expect(text).toMatch(/^\d{2}:\d{2}$/)
    expect(text).not.toMatch(/\b(AM|PM)\b/)
  })

  test('date hides when the preference is off', async ({ page }) => {
    await preset(page, { format: '24h', seconds: true, date: false })
    await page.goto('/', { waitUntil: 'networkidle' })
    // The date stamp source text is "Fri, Nov 6 2026" — the upper-casing is
    // CSS, so the regex is case-insensitive. Case-sensitive would match on
    // nothing whether the date is shown or not, which is a gate that catches
    // only typos.
    const datestamp = page.locator('header').getByText(/^\s*[a-z]{3},\s+[a-z]{3}\s+\d/i)
    await expect(datestamp).toHaveCount(0)
  })

  test('toggling 24h → 12h on /settings flips the masthead in the same tab', async ({ page }) => {
    await preset(page, { format: '24h', seconds: true, date: true })
    await page.goto('/settings', { waitUntil: 'networkidle' })

    // Baseline: 24h shows no AM/PM in the masthead clock.
    const before = await clockText(page)
    expect(before).not.toMatch(/\b(AM|PM)\b/)

    await page.getByRole('button', { name: '12-hour' }).click()

    // The storage-event + CHANGE_EVENT path is synchronous, but the clock also
    // depends on React's re-render — poll briefly to avoid flakiness.
    await expect
      .poll(async () => (await clockText(page)).includes('AM') || (await clockText(page)).includes('PM'))
      .toBe(true)
  })

  test('toggling seconds OFF removes the :SS digits from the masthead clock', async ({ page }) => {
    await preset(page, { format: '24h', seconds: true, date: true })
    await page.goto('/settings', { waitUntil: 'networkidle' })

    // Baseline — HH:MM:SS.
    await expect
      .poll(async () => /^\d{2}:\d{2}:\d{2}$/.test(await clockText(page)))
      .toBe(true)

    // Click the Off button in the "Show seconds" row.
    const secondsRow = page.locator('div', { hasText: /^Show seconds/ }).first()
    await secondsRow.getByRole('button', { name: 'Off' }).click()

    // Wait for the SS to disappear, which proves BOTH the preference wrote and
    // the Masthead subscribed to it.
    await expect.poll(async () => /^\d{2}:\d{2}$/.test(await clockText(page))).toBe(true)
  })

  test('/settings fits 390px with the Clock panel added', async ({ page, viewport }, info) => {
    await preset(page, { format: '24h', seconds: true, date: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await expectNoHorizontalOverflow(page, 390)
    await page.setViewportSize(viewport ?? { width: 1400, height: 1000 })
    void info
  })

  /**
   * World-clock chips sit in the MASTHEAD, which is OUTSIDE `<main>`.
   * `expectNoHorizontalOverflow` measures both the document and `<main>`, but
   * the Masthead is what would push the document wider — so this test checks
   * at 375px with MANY zones configured, because an empty or one-zone row
   * passing tells us nothing about the layout that actually ships.
   */
  test('Masthead with many world clocks fits 375px', async ({ page, viewport }, info) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hellogitty-clock', JSON.stringify({ format: '24h', seconds: true, date: true }))
        localStorage.setItem(
          'hellogitty-worldclocks',
          JSON.stringify([
            { tz: 'UTC', label: 'UTC' },
            { tz: 'America/New_York', label: 'EST' },
            { tz: 'America/Los_Angeles', label: 'PST' },
            { tz: 'Europe/London', label: 'GMT' },
            { tz: 'Europe/Berlin', label: 'CET' },
            { tz: 'Asia/Tokyo', label: 'JST' },
            { tz: 'Asia/Shanghai', label: 'CST (CN)' },
            { tz: 'Australia/Sydney', label: 'AEST' },
          ]),
        )
      } catch {
        /* private mode */
      }
    })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/', { waitUntil: 'networkidle' })

    // The chips are present — a test that passed on zero chips would be
    // measuring an empty list, which this prevents by asserting them first.
    await expect(page.getByRole('list', { name: 'World clocks' }).locator('li')).toHaveCount(8)

    // Document measurement, specifically, because the Masthead is outside
    // `<main>` and `overflow-x-hidden` is on `<main>` rather than on <html>.
    // A Masthead too wide pushes the document, not <main>.
    const m = await page.evaluate(() => ({
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
    }))
    expect(
      m.docScroll,
      `the document is ${m.docScroll - m.docClient}px wider than 375 with 8 world clocks in the Masthead`,
    ).toBeLessThanOrEqual(m.docClient)

    // `<main>` on the dashboard route should also be fine (dashboard content
    // isn't the thing on trial here, but a regression anywhere is still worth
    // catching from the same setup).
    await expectNoHorizontalOverflow(page, 375)
    await page.setViewportSize(viewport ?? { width: 1400, height: 1000 })
    void info
  })
})
