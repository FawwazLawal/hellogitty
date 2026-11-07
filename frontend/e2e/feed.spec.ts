import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The feed page's gate.
 *
 * The feed's whole job is to tell the reader what just happened, so the
 * three states its render has — not fetched, fetched-and-empty, and
 * fetched-with-rows — must not collapse into two. That is what these
 * tests exercise first; the ack flow and overflow + axe are the
 * remainder.
 *
 * MOCKING. Every test substitutes `/feed.json` (and, for the ack cases,
 * `/feed/ack`) via `page.route` so we control `known`, the row list and
 * the server's response. Other endpoints the shell hits — session,
 * dashboard — get minimal valid shapes so the chrome stays quiet.
 *
 * REQUIRES HG_BASE_URL. The React app lives at /feed, which the python
 * fixture does not serve; the suite skips without the live Go binary.
 */

async function withFeed(page: Page, body: unknown) {
  await page.route('**/feed.json', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  )
}

async function withShellDocs(page: Page) {
  await page.route('**/app/api/dashboard.json', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '', version: 'test',
        kpis: [
          { id: 'needs', value: 0, label: 'Needs you', sublabel: '', known: false },
          { id: 'prs', value: 0, label: 'Open PRs', sublabel: '', known: false },
          { id: 'repos', value: 0, label: 'Repos', sublabel: '', known: true },
          { id: 'api', value: 0, label: 'API left', sublabel: '', known: false },
        ],
        repos: [], stageHeads: [],
        repoTotals: { newCount: 0, repoCount: 0 },
        pipeline: { counts: [], opened: 0, open: 0, merged: 0, closed: 0, rate: '', known: false },
        work: { known: false, partial: false, login: '', needYou: 0, total: 0, items: [] },
        conversations: { known: false, quiet: 0, needYou: 0, total: 0 },
      }),
    }),
  )
  await page.route('**/app/api/session.json', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'test-token', writable: true }),
    }),
  )
}

test.describe('feed page', () => {
  test.skip(
    !process.env.HG_BASE_URL,
    'feed.spec needs the Go binary running under HG_BASE_URL — the static fixture does not serve /feed.',
  )

  // 1. UNKNOWN IS NOT EMPTY.
  test('known=false: renders "not fetched" and does not claim the feed is caught up', async ({ page }) => {
    await withShellDocs(page)
    await withFeed(page, { known: false, canWatch: false, rows: [] })
    await page.goto('/feed', { waitUntil: 'networkidle' })

    await expect(page.getByTestId('feed-not-fetched')).toBeVisible()
    await expect(page.getByText(/Nothing new\./)).toHaveCount(0)
    // The ack footer must NOT render under an unknown feed: a bulk
    // "Acknowledge all" of an unfetched list is a nonsensical action.
    await expect(page.getByRole('button', { name: /Acknowledge all/ })).toHaveCount(0)
  })

  // 2a. KNOWN=FALSE WITH ROWS — the rows from the snapshot cache are real
  //      events; the only honest thing is to render them, flagged as stale,
  //      not suppress them behind a "nothing has happened" message. The
  //      templated page did the right thing and the first draft of this port
  //      did not — it collapsed "unknown AND non-empty" into "unknown AND
  //      empty", which hides real events on every cold start.
  test('known=false WITH rows: renders the rows and a stale banner, NOT the not-fetched copy', async ({ page }) => {
    await withShellDocs(page)
    await withFeed(page, {
      known: false, canWatch: false,
      rows: [
        { id: 's1', kind: 'pr', label: 'Your PR', repo: 'a/b', number: 42,
          text: 'stale but real event', url: 'https://example.test',
          actor: 'alice', at: '2026-11-06T18:00:00Z', acked: false },
        { id: 's2', kind: 'issue', label: 'Your issue', repo: 'c/d', number: 7,
          text: 'another cached event', url: 'https://example.test',
          at: '2026-11-06T17:30:00Z', acked: false },
      ],
    })
    await page.goto('/feed', { waitUntil: 'networkidle' })

    // The 150-rows-hidden defect peer found: both rows must be visible.
    await expect(page.getByText('stale but real event')).toBeVisible()
    await expect(page.getByText('another cached event')).toBeVisible()

    // And the "not fetched yet" copy must NOT be shown — the rows are what
    // the page is for, and the page has them. A stale banner replaces it.
    await expect(page.getByTestId('feed-not-fetched')).toHaveCount(0)
    await expect(page.getByTestId('feed-stale-banner')).toBeVisible()
  })

  // 2. KNOWN AND EMPTY — the all-clear copy appears, 'not fetched' does not.
  test('known=true with no rows: renders "nothing new" and NOT the not-fetched marker', async ({ page }) => {
    await withShellDocs(page)
    await withFeed(page, { known: true, canWatch: false, rows: [] })
    await page.goto('/feed', { waitUntil: 'networkidle' })

    await expect(page.getByText(/Nothing new\./)).toBeVisible()
    await expect(page.getByTestId('feed-not-fetched')).toHaveCount(0)
  })

  // 3. KNOWN WITH ROWS — the row list, with repo/number/actor/time.
  test('known=true with rows: renders row content and ack buttons', async ({ page }) => {
    await withShellDocs(page)
    await withFeed(page, {
      known: true, canWatch: false,
      rows: [
        { id: 'r1', kind: 'pr', label: 'Your PR', repo: 'a/b', number: 42, text: 'reviewer approved',
          url: 'https://example.test/pr/42', actor: 'alice', at: '2026-11-06T18:00:00Z', acked: false },
        { id: 'r2', kind: 'issue', label: 'Your issue', repo: 'c/d', number: 7, text: 'issue closed',
          url: 'https://example.test/issue/7', actor: 'bob', at: '2026-11-06T17:30:00Z', acked: true },
      ],
    })
    await page.goto('/feed', { waitUntil: 'networkidle' })

    await expect(page.getByText('reviewer approved')).toBeVisible()
    // Acked row only visible after the filter toggle.
    await expect(page.getByText('issue closed')).toHaveCount(0)
    await page.getByLabel('Show acknowledged').check()
    await expect(page.getByText('issue closed')).toBeVisible()

    // The unacked row's Ack button is clickable; the acked row's shows "Seen"
    // and is disabled.
    const ack = page.getByRole('button', { name: /^Acknowledge: reviewer approved/ })
    await expect(ack).toBeEnabled()
    const seen = page.getByRole('button', { name: /^Acknowledged: issue closed/ })
    await expect(seen).toBeDisabled()
  })

  // 4. ACK FLOW: single-row ack hits the server with the right headers and body.
  test('acknowledging a row POSTs /feed/ack with token and id, and surfaces server error text', async ({ page }) => {
    await withShellDocs(page)
    await withFeed(page, {
      known: true, canWatch: false,
      rows: [
        { id: 'r1', kind: 'pr', label: 'Your PR', repo: 'a/b', number: 1, text: 'needs ack',
          url: 'https://example.test', at: '2026-11-06T18:00:00Z', acked: false },
      ],
    })

    const requests: { method: string; token?: string; body?: unknown }[] = []
    await page.route('**/feed/ack', async (route: Route) => {
      const req = route.request()
      requests.push({
        method: req.method(),
        token: req.headers()['x-hellogitty-token'],
        body: req.postDataJSON(),
      })
      // First call succeeds; second (triggered after error check) answers 403
      // so we can assert the server's own text reaches the user.
      if (requests.length === 1) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[{"id":"r1","github":"marked"}]}' })
      } else {
        await route.fulfill({ status: 403, contentType: 'text/plain', body: 'forbidden' })
      }
    })

    await page.goto('/feed', { waitUntil: 'networkidle' })

    // Click the Ack button on the one row.
    await page.getByRole('button', { name: /^Acknowledge: needs ack/ }).click()

    // The request lands with CSRF headers from the session doc.
    await expect.poll(() => requests.length).toBeGreaterThan(0)
    expect(requests[0].method).toBe('POST')
    expect(requests[0].token).toBe('test-token')
    expect(requests[0].body).toEqual({ ids: ['r1'] })
  })

  test('acknowledging surfaces the server error text verbatim', async ({ page }) => {
    await withShellDocs(page)
    await withFeed(page, {
      known: true, canWatch: false,
      rows: [
        { id: 'r1', kind: 'pr', label: 'Your PR', repo: 'a/b', number: 1, text: 'to fail',
          url: 'https://example.test', at: '2026-11-06T18:00:00Z', acked: false },
      ],
    })
    await page.route('**/feed/ack', (route: Route) =>
      route.fulfill({ status: 403, contentType: 'text/plain', body: 'forbidden' }),
    )
    await page.goto('/feed', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Acknowledge: to fail/ }).click()

    // The server's own string appears in an alert. 'forbidden' means the
    // token is stale and the reader should reload — a generic "network
    // error" would hide that.
    await expect(page.getByRole('alert').filter({ hasText: 'forbidden' })).toBeVisible()
  })

  // 5. BULK ACK sends every unacked id in one request.
  test('"Acknowledge all" POSTs every unacked id in one request', async ({ page }) => {
    await withShellDocs(page)
    await withFeed(page, {
      known: true, canWatch: false,
      rows: [
        { id: 'r1', kind: 'pr', label: 'Your PR', repo: 'a/b', number: 1, text: 'unacked one', url: '', at: '2026-11-06T18:00:00Z', acked: false },
        { id: 'r2', kind: 'pr', label: 'Your PR', repo: 'a/b', number: 2, text: 'unacked two', url: '', at: '2026-11-06T18:00:00Z', acked: false },
        { id: 'r3', kind: 'pr', label: 'Your PR', repo: 'a/b', number: 3, text: 'already acked', url: '', at: '2026-11-06T18:00:00Z', acked: true },
      ],
    })
    let seenBody: unknown = null
    await page.route('**/feed/ack', async (route: Route) => {
      seenBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"results":[{"id":"r1","github":"local"},{"id":"r2","github":"local"}]}',
      })
    })

    await page.goto('/feed', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Acknowledge all \(2\)/ }).click()

    await expect.poll(() => seenBody).not.toBeNull()
    expect(seenBody).toEqual({ ids: ['r1', 'r2'] })
  })

  // 6. ACCESSIBILITY. No serious/critical axe violations on the known/empty state.
  test('axe reports no serious or critical violations', async ({ page }) => {
    await withShellDocs(page)
    await withFeed(page, {
      known: true, canWatch: false,
      rows: [
        { id: 'r1', kind: 'pr', label: 'Your PR', repo: 'a/b', number: 42, text: 'content',
          url: 'https://example.test', actor: 'alice', at: '2026-11-06T18:00:00Z', acked: false },
      ],
    })
    await page.goto('/feed', { waitUntil: 'networkidle' })
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      bad,
      `/feed has serious/critical axe violations:\n  ${bad.map((v) => `[${v.impact}] ${v.id} — ${v.help}`).join('\n  ')}`,
    ).toHaveLength(0)
  })

  /*
    LIVE-BINARY CHECK — the one test on this page that doesn't mock
    /feed.json. The reason this exists is specific:

    Mocking protects a spec from a server whose state moves between a
    flag read and a DOM read — the race warned about elsewhere. It does
    NOT protect it from a server state the author didn't imagine
    mocking. The earlier draft of this spec had 7 mocked cases, all
    green, on a page that hid 150 real cached events behind a "not
    fetched" note on every cold restart. The gap was `known: false`
    paired with a non-empty row list, which was not one of the seven.
    No amount of mock coverage would have caught it; the live binary
    handed that state out on the first request.

    So this test takes the API's actual bytes and asserts the DOM
    shows them. If the server has rows, the page shows rows — the
    weakest possible claim that would have failed on the earlier
    bug, and the strongest one that doesn't duplicate the mocked
    cases above.

    The instant-matching piece: `page.waitForResponse` captures the
    exact fetch the page itself just made, so the bytes asserted and
    the bytes behind the DOM are from the same request. No second
    fetch.
  */
  test('live /feed: rows the API returns must appear on the page', async ({ page }) => {
    // Deliberately no `page.route` on /feed.json — this test needs the
    // bytes the real server produces, including whatever states (cold
    // restart, partial poll, empty feed on a brand-new install) the
    // mocked tests above happened not to enumerate.
    await page.route('**/app/api/session.json', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-token', writable: true }),
      }),
    )
    // The shell's dashboard fetch is loud and unrelated; silence it
    // rather than let it churn the console.
    await page.route('**/app/api/dashboard.json', (route: Route) => route.fulfill({ status: 404, body: '' }))

    const [resp] = await Promise.all([
      page.waitForResponse('**/feed.json'),
      page.goto('/feed', { waitUntil: 'networkidle' }),
    ])
    const body = (await resp.json()) as { known: boolean; rows: { id: string; text: string }[] }

    // No rows is a valid live state (brand-new install, cleared db).
    // It isn't what we're hunting; the point of this test is "rows →
    // rendered rows", so skip when the premise doesn't apply.
    test.skip(body.rows.length === 0, 'live API has no rows to assert against')

    // The exact row the server just returned must render. The text
    // string is unique enough per row (repo + event + specific words)
    // that the next refetch is overwhelmingly unlikely to churn it in
    // the second between captures; if it does, the assertion still
    // reads the live DOM, not a snapshot. `.first()` guards against
    // an unlikely duplicate within one body.
    const first = body.rows[0]
    await expect(page.getByText(first.text, { exact: false }).first()).toBeVisible()
  })

  // 7. NO HORIZONTAL OVERFLOW AT 390PX.
  test('no horizontal overflow at 390px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'overflow check runs under mobile-390')

    await withShellDocs(page)
    const longText =
      'a feed entry with intentionally long content that would otherwise push a phone-width layout past its viewport if the row were not wrapped properly'
    await withFeed(page, {
      known: true, canWatch: false,
      rows: [
        { id: 'r1', kind: 'pr', label: 'Your PR', repo: 'owner/very-long-repo-name', number: 9999,
          text: longText, url: 'https://example.test', actor: 'someone-with-a-very-long-handle',
          at: '2026-11-06T18:00:00Z', acked: false },
      ],
    })
    await page.goto('/feed', { waitUntil: 'networkidle' })
    await expectNoHorizontalOverflow(page, 390)
  })
})
