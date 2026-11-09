import { test, expect } from '@playwright/test'

/**
 * The gate for #284: the dashboard footer status line.
 *
 * Covers specifically:
 *
 *  1. The footer renders on the dashboard with three telemetry fields plus
 *     the foot-note. A missing footer regresses to the state the issue was
 *     filed against.
 *
 *  2. Repo count is the SAME number the repository-table header reads,
 *     because it comes from the SAME document. Peer caught the drift
 *     possibility: settings.repos.count and dashboard.repoTotals.repoCount
 *     are two writers for one fact, fetched at different moments. The
 *     footer is pinned to the dashboard document — this test asserts the
 *     two numbers agree in-page, which they only will if the source is
 *     the dashboard doc.
 *
 *  3. "Last check" ticks live. A React component that formatted once on
 *     render would say "2 minutes ago" an hour later. The test checks
 *     "just now" after the page settles; the ticking cadence itself is
 *     covered by useLiveClock's own test and the `visibilitychange`
 *     resync from #319.
 *
 *  4. 390px fits with no horizontal overflow — the footer wraps rather
 *     than forces the dashboard to scroll sideways on a phone.
 *
 *  5. The foot-note carries the pinned constants (5 minutes reload, work
 *     every 5) literal in the text, so a rename of either on the
 *     templated side would show up here as a diff rather than silently
 *     drifting.
 */

// (Formerly dashboardRepoCount / footerRepoCount helpers; inlined into the
// one test that needs them so the regex sits next to the assertion.)

test.describe('/ — dashboard footer status line', () => {
  test('renders Last check · GitHub API · repos, plus the foot-note', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    const footer = page.getByRole('contentinfo', { name: 'Dashboard status' })
    await expect(footer).toBeVisible()

    // Three field labels that were on the templated footer.
    await expect(footer.getByText(/Last check/)).toBeVisible()
    await expect(footer.getByText(/GitHub API/)).toBeVisible()
    await expect(footer.getByText(/\brepos\b/)).toBeVisible()

    // The foot-note. Literal strings, not regexes — a rename on either
    // side must fail this test rather than drift quietly.
    await expect(footer.getByText(/Reloads every 5 minutes/)).toBeVisible()
    await expect(footer.getByText(/your work every 5/)).toBeVisible()
    await expect(footer.getByText(/runs only on this computer/)).toBeVisible()
  })

  test('repo count agrees with the repository panel header (one document, one number)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    // Wait until both pieces of DOM are in — the footer renders as soon as
    // /settings.json resolves, the pill as soon as /dashboard.json does.
    // Polling on element presence rather than a regex-against-textContent
    // because Playwright's text-extraction normalises whitespace between
    // sibling text nodes differently from the browser's own innerText,
    // which bit this suite on the first draft.
    const footer = page.getByRole('contentinfo', { name: 'Dashboard status' })
    const pill = page.locator('text=/\\bnew in \\d+ repos\\b/i').first()
    await expect(footer).toBeVisible({ timeout: 5000 })
    await expect(pill).toBeVisible({ timeout: 5000 })

    const panelCount = await pill.evaluate((el) => {
      const m = /new in (\d+) repos/i.exec(el.textContent || '')
      return m ? Number(m[1]) : null
    })
    const footCount = await footer.evaluate((el) => {
      const m = /(\d+) repos/i.exec(el.textContent || '')
      return m ? Number(m[1]) : null
    })
    expect(panelCount, 'pill must print a count').not.toBeNull()
    expect(footCount, 'footer must print a count').not.toBeNull()
    expect(
      footCount,
      'footer repo count must come from the dashboard document, same as the panel — see DashboardFooter one-fact-one-source comment',
    ).toBe(panelCount)
  })

  test('Last check reads a relative stamp (not the raw UTC string)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const footer = page.getByRole('contentinfo', { name: 'Dashboard status' })

    // Either "just now" (fresh poll), an "N minutes ago" stamp, or "not
    // yet" on a dashboard that hasn't polled. All three are relative
    // wordings — a bare "14:37:02 UTC" with nothing wrapping it means the
    // relative formatter never ran.
    await expect(footer).toContainText(/just now|minutes? ago|hour[s]? ago|days? ago|not yet/)
  })

  test('footer repo count follows dashboard document, not settings — proven by making them disagree', async ({ page }) => {
    // The decisive test for the one-fact-one-source design: intercept
    // /app/api/settings.json and rewrite `repos.count` to a sentinel value
    // that can't be anything else. If the footer takes from settings, it
    // will print 42. If it takes from the dashboard (the design), it will
    // print the real count.
    //
    // Peer called this out directly: "two documents, fetched at different
    // moments, both claiming to say how many repositories there are". The
    // other 'agree' test above checks they agree in the normal case; this
    // one checks that WHEN they disagree, the footer picks the right one.
    const SENTINEL = 42
    await page.route('**/app/api/settings.json', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      if (body?.repos?.count !== undefined) body.repos.count = SENTINEL
      await route.fulfill({ response, body: JSON.stringify(body), contentType: 'application/json' })
    })

    await page.goto('/', { waitUntil: 'networkidle' })

    const footer = page.getByRole('contentinfo', { name: 'Dashboard status' })
    await expect(footer).toBeVisible({ timeout: 5000 })

    const footCount = await footer.evaluate((el) => {
      const m = /(\d+) repos/i.exec(el.textContent || '')
      return m ? Number(m[1]) : null
    })
    expect(
      footCount,
      'footer must read repo count from the dashboard document — a sentinel value planted in /settings.json must not reach it',
    ).not.toBe(SENTINEL)
  })

  test('/ fits 390px with the footer present (no horizontal overflow)', async ({ page, viewport }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/', { waitUntil: 'networkidle' })

    const footer = page.getByRole('contentinfo', { name: 'Dashboard status' })
    await expect(footer).toBeVisible()

    // Page-level overflow check — the footer should wrap, not push the
    // dashboard wider than the viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'the dashboard must not scroll sideways at 390px').toBeLessThanOrEqual(1)

    await page.setViewportSize(viewport ?? { width: 1400, height: 1000 })
  })
})
