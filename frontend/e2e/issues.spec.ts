import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The Issues page.
 *
 * This page is the first converted one with URL STATE — a page number and a
 * search that live in the query string — so it has failure modes the others
 * could not have, and two of them were real while it was being built:
 *
 *   1. The query parameter is `page`, not `pg`. `IssuePg` is the template's
 *      field name; the handler reads `page`. Built with `pg`, Next changed the
 *      URL, refetched, and got page 1 back every time, with "Page 1 of 126"
 *      still on screen and Next still enabled. Nothing looked broken.
 *
 *   2. /issues?page=2&q=flaky returns zero rows while reporting 61 matches on
 *      1 page. The page said "Nothing open matches" — telling the reader their
 *      search failed when it had not — and hid the pager, leaving no way back
 *      but editing the URL.
 *
 * Both are checks that can go red (Rule 3): point them at a corpus with more
 * than one page and they fail on the old code. The first two tests below are
 * exactly those two cases.
 *
 * `/issues` ALSO STILL ANSWERS JSON on the same path, which is where this page
 * gets its data. The last test holds that, because the conversion's whole
 * premise is that the existing contract survived it.
 */

test.describe('issues', () => {
  test('Next actually advances the page', async ({ page }) => {
    await page.goto('/issues', { waitUntil: 'networkidle' })

    const pager = page.getByRole('navigation', { name: 'Issue pages' })
    // A single-page corpus cannot exercise paging at all; say so rather than
    // passing silently, which is how a dead check hides.
    const pagerCount = await pager.count()
    test.skip(pagerCount === 0, 'this corpus fits on one page; nothing to page through')

    /*
      Identify the first row by `repo#number`, NOT by its whole text. The row
      carries a relative age ("51 min ago") that ticks while the test runs, so
      comparing full text fails for reasons that have nothing to do with
      paging — a flaky gate, which is a gate people learn to ignore.
    */
    const firstKey = () => page.locator('ul li').first().locator('.font-mono').first().innerText()
    const firstBefore = await firstKey()
    await expect(pager.getByText(/^Page 1 of/)).toBeVisible()

    await pager.getByRole('button', { name: 'Next' }).click()

    // All three must move together. The `pg` bug moved the URL and left the
    // other two behind, so checking the URL alone would have passed.
    await expect(page).toHaveURL(/[?&]page=2(\b|&)/)
    await expect(pager.getByText(/^Page 2 of/)).toBeVisible()
    expect(await firstKey()).not.toBe(firstBefore)

    // And back, through browser history rather than the button, because the
    // page writes history entries and has to read them back.
    await page.goBack()
    await expect(pager.getByText(/^Page 1 of/)).toBeVisible()
    await expect.poll(firstKey).toBe(firstBefore)
  })

  test('a page past the end says so, instead of claiming nothing matched', async ({ page }) => {
    // Page 9999 is past the end of any corpus this ever runs against.
    await page.goto('/issues?page=9999', { waitUntil: 'networkidle' })

    const total = await page.evaluate(async () => {
      const r = await fetch('/issues?page=9999', { headers: { accept: 'application/json' } })
      return (await r.json()).total as number
    })
    test.skip(total === 0, 'no open issues in this corpus; the past-the-end state cannot arise')

    await expect(page.getByText(/Page 9999 is past the end/)).toBeVisible()
    // The honest message is only half of it: there must be a way back.
    await expect(page.getByRole('button', { name: /first page/i })).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Issue pages' }).getByRole('button', { name: 'Previous' }),
    ).toBeEnabled()
    // And it must NOT say the search found nothing, because it found plenty.
    await expect(page.getByText(/Nothing open matches/)).toHaveCount(0)
  })

  test('a search with no matches is distinct from a page past the end', async ({ page }) => {
    await page.goto('/issues?q=zzzznothingmatchesthis', { waitUntil: 'networkidle' })
    await expect(page.getByText(/Nothing open matches/)).toBeVisible()
    await expect(page.getByText(/past the end/)).toHaveCount(0)
  })

  test('searching moves the URL and resets to page one', async ({ page }) => {
    await page.goto('/issues?page=2', { waitUntil: 'networkidle' })
    await page.getByRole('searchbox', { name: 'Search open issues' }).fill('test')
    await page.getByRole('button', { name: 'Search', exact: true }).click()

    await expect(page).toHaveURL(/[?&]q=test(\b|&)/)
    // Starting a new search on page 2 would drop the reader into the middle of
    // a different result set, or past its end.
    await expect(page).not.toHaveURL(/[?&]page=2(\b|&)/)
  })

  test('the JSON contract on /issues survives the conversion', async ({ request }) => {
    const res = await request.get('/issues', { headers: { accept: 'application/json' } })
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/json')

    const body = await res.json()
    // The exact keys the page parses. A rename here is a silent blank page.
    for (const key of ['issues', 'total', 'page', 'pages', 'query', 'canWatch']) {
      expect(body, `missing key ${key}`).toHaveProperty(key)
    }

    // And the document request must NOT get JSON — that is the whole split.
    const doc = await request.get('/issues', { headers: { accept: 'text/html' } })
    expect(doc.headers()['content-type']).toContain('text/html')
  })

  test('no serious or critical axe violations', async ({ page }) => {
    await page.goto('/issues', { waitUntil: 'networkidle' })
    const results = await new AxeBuilder({ page }).analyze()
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      bad,
      `axe violations:\n${bad.map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`).join('\n')}`,
    ).toHaveLength(0)
  })

  test('no horizontal overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/issues', { waitUntil: 'networkidle' })
    // Issue titles are long and arbitrary; this is the page most likely to
    // push a phone sideways — and the one where a missing min-w-0 would be
    // hidden behind <main>'s overflow-x-hidden rather than showing up on the
    // document. See ./overflow.
    await expectNoHorizontalOverflow(page, 390)
  })
})
