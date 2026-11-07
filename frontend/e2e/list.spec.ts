import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The /list page, the last templated page converted.
 *
 * WHAT THIS GATES. `/list` has URL state (`?prs=<kind>` or `?stage=<name>`),
 * jump-link counts that reach for `pipeline.known` to tell unknown from
 * zero, and a direct link relationship with two other pages — the owner's
 * `/your-repos` overview tiles point at `/list?prs=open` and
 * `/list?prs=merged`. A regression here is a regression in the seam between
 * those pages.
 *
 * Every check below was proved red against a broken-on-purpose build before
 * being declared green:
 *
 *   [RED → GREEN] unknownIsNotZero — forced `pipelineKnown` to true in
 *     `JumpLink` so unknown counts rendered as 0; the spec caught the real
 *     zero where the em-dash should have been.
 *   [RED → GREEN] theYourReposSeam — the two tiles' hrefs are checked
 *     against the exact query strings the server reads. Broke the href on
 *     `YourReposPage.tsx` to `?prs=opened` by mistake; test failed because
 *     the destination's active jump link no longer matched.
 *   [RED → GREEN] prsIsNotPr — renamed the `prs` param to `pr` in
 *     `readMode()`; the server still reads `?prs=...`, so a link to the
 *     page landed with no filter and the active jump link was unset.
 *   [RED → GREEN] backButtonWalks — removed the `popstate` listener;
 *     clicking back after a jump link left the URL at ?prs=merged but the
 *     view at open.
 *   [RED → GREEN] noHorizontalOverflow390 — added `min-w-[600px]` to the
 *     PR table row; `<main>.scrollWidth` burst to 601px at 390.
 *   [RED → GREEN] axeClean — added a 32×32 `<img>` with no alt; axe
 *     reported image-alt critical.
 *
 * Live-only: the fixture server does not serve the React app.
 */

const live = !!process.env.HG_BASE_URL

async function gotoList(page: Page, query: string = '?prs=merged') {
  await page.goto(`/list${query}`, { waitUntil: 'networkidle' })
  // Wait for the lazy ListPage chunk to arrive. The Suspense fallback
  // renders a `<main data-loading="true">`; the real content clears it.
  await expect(page.locator('main:not([data-loading])')).toBeVisible()
}

test.describe('/list', () => {
  test.skip(!live, 'set HG_BASE_URL to a running instance to run this suite')

  test('jump-link counts render em-dash, not 0, when the pipeline is unknown', async ({ page }) => {
    // Intercept the dashboard document to force `pipeline.known = false`
    // and the counts to `0`. On a cold start this is the real state, but
    // we set it explicitly so the test cannot depend on the server's clock.
    await page.route('**/app/api/dashboard.json', async (route) => {
      const upstream = await route.fetch()
      const json = await upstream.json()
      json.pipeline.known = false
      json.pipeline.opened = 0
      json.pipeline.open = 0
      json.pipeline.merged = 0
      json.pipeline.closed = 0
      if (Array.isArray(json.pipeline.counts))
        json.pipeline.counts = json.pipeline.counts.map((c: { count: number }) => ({ ...c, count: 0 }))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
    })
    await gotoList(page, '?prs=merged')
    const nav = page.getByRole('navigation', { name: 'Other lists' })
    await expect(nav).toBeVisible()
    // Every jump link must carry an em-dash count, none of them a "0".
    const hits = await nav.locator('a').all()
    expect(hits.length).toBeGreaterThan(0)
    for (const a of hits) {
      const text = (await a.textContent()) ?? ''
      expect(text).toContain('—')
      expect(text.match(/\b0\b/)).toBeNull()
    }
  })

  test('the /your-repos seam: both tiles link to /list query strings this page actually reads', async ({ page }) => {
    // Visit /your-repos first and read the hrefs its two overview tiles
    // point at. Then visit each in turn and verify the active jump link
    // matches. A silent breakage of this seam is the defect this test
    // exists to catch — the owner clicks a tile and lands on a page that
    // 404s or shows nothing.
    await page.goto('/your-repos', { waitUntil: 'networkidle' })
    await expect(page.locator('main:not([data-loading])')).toBeVisible()
    // The tiles render as anchors when their count is a real figure the
    // server has reported; on a cold start they render as plain divs and
    // the hrefs are not there to read. Use the raw selector so the test
    // does not depend on the pipeline being polled yet.
    const hrefs = await page.$$eval('main a[href^="/list?"]', (links) =>
      links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
    )
    if (hrefs.length === 0) {
      test.skip(true, 'pipeline is unpolled so /your-repos renders the tiles as non-links; seam check is unreachable on this instance')
    }
    for (const href of hrefs) {
      await page.goto(href, { waitUntil: 'networkidle' })
      await expect(page.locator('main:not([data-loading])')).toBeVisible()
      const currentLinks = await page
        .getByRole('navigation', { name: 'Other lists' })
        .locator('a[aria-current="page"]')
        .count()
      expect(currentLinks, `no active jump link on ${href}`).toBeGreaterThan(0)
    }
  })

  test('the query param is `prs`, not `pr`', async ({ page }) => {
    // The server reads `r.URL.Query().Get("prs")`. If this page guessed
    // `pr`, the Merged tile from /your-repos would land with no filter
    // and the active jump link would be unset. Check against the real
    // param the server understands.
    await gotoList(page, '?prs=merged')
    await expect(
      page.getByRole('navigation', { name: 'Other lists' }).locator('a[aria-current="page"]'),
    ).toContainText(/merged/i)
  })

  test('the back button walks between jump-link selections', async ({ page }) => {
    await gotoList(page, '?prs=open')
    // Jump to Merged via the in-app link.
    await page
      .getByRole('navigation', { name: 'Other lists' })
      .getByRole('link', { name: /^Merged/i })
      .click()
    await expect
      .poll(() => (typeof window !== 'undefined' ? '' : '') || page.url())
      .toContain('?prs=merged')
    await page.goBack()
    await expect.poll(() => page.url()).toContain('?prs=open')
    // And the active jump link should reflect the back-step.
    await expect(
      page.getByRole('navigation', { name: 'Other lists' }).locator('a[aria-current="page"]'),
    ).toContainText(/^Open/i)
  })

  test('no horizontal overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoList(page, '?prs=merged')
    await expectNoHorizontalOverflow(page, 390)
  })

  test('axe reports no serious or critical violations', async ({ page }) => {
    await gotoList(page, '?prs=merged')
    const results = await new AxeBuilder({ page }).analyze()
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(bad, bad.map((v) => `${v.id}: ${v.description}`).join('\n')).toEqual([])
  })

  test('live data: a /list?prs=merged visit matches the pipeline document row-for-row', async ({ page }) => {
    // The brief: "at least one check that reads the live API rather than a
    // mock — the mocks only cover states you thought of". This hits the
    // real binary and compares the list page's row count against the
    // pipeline document's own filter, which is what the server would
    // produce if it rendered /list itself.
    await gotoList(page, '?prs=merged')
    const expected = await page.evaluate(async () => {
      const r = await fetch('/app/api/pipeline.json', { headers: { accept: 'application/json' } })
      const j = (await r.json()) as { pullRequests: { state: string }[]; known: boolean }
      return { known: j.known, merged: j.pullRequests.filter((p) => p.state === 'Merged').length }
    })
    if (!expected.known) test.skip(true, 'pipeline not polled on this instance')
    const rows = await page.locator('main ul > li').count()
    expect(rows, `list page rendered ${rows} merged rows; the pipeline document has ${expected.merged}`).toBe(
      expected.merged,
    )
  })
})
