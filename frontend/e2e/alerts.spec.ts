import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * The alert pages' gate.
 *
 * This suite is driven against the live Go binary — set HG_BASE_URL to its
 * address (the project's playwright.config already honours that env var).
 * Without it the static Python fixture is served, which does not carry the
 * React app and cannot answer /app/api/alerts.json, so every assertion below
 * would be a false alarm; the suite skips itself instead.
 *
 * WHAT IT COVERS. Three things, in order of why the port exists:
 *
 *   1. UNKNOWN IS NOT ZERO. Each subsystem (work, watch, pipeline, poll,
 *      API) gates its page's body. For each one, a fixture with `known:
 *      false` must render the "not fetched" note and must NOT render the
 *      page's empty-state text — the all-clear is the lie the templated
 *      pages told, and the test asserts the React port does not.
 *
 *   2. NESTED SHAPES RENDER. Your-move's three sub-lists, unresolved-
 *      threads' threads-under-PRs, and stage-failed's phase pills — each
 *      page's nesting is why ten pages weren't collapsible to one list
 *      component, and each must render its children.
 *
 *   3. HYGIENE. Axe reports zero serious/critical violations on every
 *      page under the fixture, and no page produces horizontal overflow
 *      at 390px (the mobile viewport the config declares).
 *
 * MOCKING. Every test substitutes /app/api/alerts.json via `page.route` so
 * we control `known`, `partial` and the item arrays. The Go binary serves
 * everything else (the shell HTML, the asset bundle, the nav); the test
 * supplies the alert document.
 *
 * NO BEST-PRACTICE AXE. Same reasoning as e2e/axe.spec.ts: we are gating
 * on WCAG, not on axe-core's opinions.
 */

const ALL_PATHS = [
  '/alerts/your-move',
  '/alerts/watched-claimed',
  '/alerts/watched-closed',
  '/alerts/check-failed',
  '/alerts/repo-dormant',
  '/alerts/repo-slow',
  '/alerts/unresolved-threads',
  '/alerts/data-stale',
  '/alerts/repo-flagged',
  '/alerts/stage-failed',
  '/alerts/api-low',
] as const

/**
 * The base of a fixture: every known flag false, every list empty. Tests
 * flip the sections they exercise. This exists so a test is five lines
 * about what's different rather than fifty about what the whole document
 * looks like.
 */
function emptyDoc() {
  return {
    generatedAt: '',
    labels: { flagged: 'Flagged', failed: 'Stage failed' },
    totals: { repoCount: 0, targetCount: 0 },
    work: { known: false, partial: false, yourMove: 0, you: [], inYou: [], convYou: [] },
    watch: { known: false, total: 0, claimed: [], closed: [] },
    checks: { known: false, failed: [] },
    health: { known: false, items: [] },
    threads: { known: false, items: [] },
    pipeline: { known: false, flagged: [], failed: [] },
    poll: { known: false, lastUtc: '', nextUtc: '', intervalSeconds: 0, failedRepos: [] },
    api: { known: false, used: 0, limit: 0, percent: 0, resetUtc: '' },
  }
}

/**
 * Mock the alerts endpoint with `body` for the duration of this test.
 * Every real test here passes through this; a page loading before the
 * mock registers would see the live document.
 */
async function withAlertsDoc(page: Page, body: unknown) {
  await page.route('**/app/api/alerts.json', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  )
}

/**
 * Also intercept /app/api/dashboard.json so the shell (masthead KPI rail)
 * does not race the alerts endpoint and fail the suite for an unrelated
 * reason. A minimal valid dashboard document keeps the chrome quiet.
 */
async function withShellDocs(page: Page) {
  await page.route('**/app/api/dashboard.json', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '',
        version: 'test',
        kpis: [
          { id: 'needs', value: 0, label: 'Needs you', sublabel: '', known: false },
          { id: 'prs', value: 0, label: 'Open PRs', sublabel: '', known: false },
          { id: 'repos', value: 0, label: 'Repos', sublabel: '', known: true },
          { id: 'api', value: 0, label: 'API left', sublabel: '', known: false },
        ],
        repos: [],
        stageHeads: [],
        repoTotals: { newCount: 0, repoCount: 0 },
        pipeline: { counts: [], opened: 0, open: 0, merged: 0, closed: 0, rate: '', known: false },
        work: { known: false, partial: false, login: '', needYou: 0, total: 0, items: [] },
        conversations: { known: false, quiet: 0, needYou: 0, total: 0 },
        partial: true,
      }),
    }),
  )
  await page.route('**/app/api/session.json', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: '', writable: false }),
    }),
  )
}

test.describe('alert pages', () => {
  test.skip(
    !process.env.HG_BASE_URL,
    'alerts.spec needs the Go binary running under HG_BASE_URL — the static fixture does not serve /app/ or /alerts/*.',
  )
  // Alerts aren't viewport-specific in content; run under the 1400 project
  // for the per-page sweep and a 390 project for the overflow check.
  test.describe.configure({ mode: 'serial' })

  /*
    1. UNKNOWN IS NOT ZERO.

    One test per subsystem. Each asserts (a) the shell renders the shared
    not-fetched marker, (b) the empty-state copy from that page does NOT
    appear — because an "all clear" rendered from `known: false` is the
    specific lie this port exists to prevent.
  */

  const unknownCases: { path: string; forbidden: RegExp; describe: string }[] = [
    {
      path: '/alerts/your-move',
      forbidden: /No open items of yours need a move right now\./,
      describe: 'work.known=false must not claim "nothing needs you"',
    },
    {
      path: '/alerts/watched-claimed',
      forbidden: /No watched issues have been claimed\./,
      describe: 'watch.known=false must not claim "no claimed issues"',
    },
    {
      path: '/alerts/watched-closed',
      forbidden: /No watched issues have been closed\./,
      describe: 'watch.known=false must not claim "no closed issues"',
    },
    {
      path: '/alerts/check-failed',
      forbidden: /All checks passed\./,
      describe: 'checks.known=false must not claim "all checks passed"',
    },
    {
      path: '/alerts/repo-dormant',
      forbidden: /No repositories are in this state\./,
      describe: 'health.known=false must not claim "no dormant repos"',
    },
    {
      path: '/alerts/repo-slow',
      forbidden: /No repositories are in this state\./,
      describe: 'health.known=false must not claim "no slow repos"',
    },
    {
      path: '/alerts/unresolved-threads',
      forbidden: /No unresolved review threads on your open pull requests\./,
      describe: 'threads.known=false must not claim "no unresolved threads"',
    },
    {
      path: '/alerts/repo-flagged',
      forbidden: /No pipeline repositories are flagged\./,
      describe: 'pipeline.known=false must not claim "nothing flagged"',
    },
    {
      path: '/alerts/stage-failed',
      forbidden: /No pipeline stages are failing\./,
      describe: 'pipeline.known=false must not claim "no stage failures"',
    },
    {
      path: '/alerts/api-low',
      forbidden: /% used/,
      describe: 'api.known=false must not render a meter percentage',
    },
  ]

  for (const c of unknownCases) {
    test(`unknown-is-not-zero: ${c.path} — ${c.describe}`, async ({ page }) => {
      await withShellDocs(page)
      await withAlertsDoc(page, emptyDoc())
      await page.goto(c.path, { waitUntil: 'networkidle' })

      // Shared marker the shell renders — brittle intentionally. If the
      // shell ever stops planting this, the test fails and tells us.
      await expect(page.getByTestId('alert-not-fetched')).toBeVisible()

      // The specific empty-state text from this page must NOT appear.
      await expect(page.getByText(c.forbidden)).toHaveCount(0)

      // At least one stat tile must read '—' rather than a numeral, since
      // the subsystem is unknown. (Totals-tracked is allowed to carry a real
      // value even on cold boot.) The shell lives inside <main>, which
      // excludes any decorative em-dash in the masthead or nav.
      await expect(page.locator('main >> text="—"').first()).toBeVisible()
    })
  }

  /*
    2. NESTED SHAPES. Each of the three nested pages must render its
    children — the reason these are not collapsible to flat lists.
  */

  test('your-move renders all three sub-lists when known', async ({ page }) => {
    await withShellDocs(page)
    const doc = emptyDoc()
    doc.work = {
      known: true,
      partial: false,
      yourMove: 3,
      you: [{ kind: 'PR', repo: 'a/b', number: 1, title: 'you-item', url: '', notes: [] }],
      inYou: [{ kind: 'Issue', repo: 'c/d', number: 2, title: 'in-you-item', url: '', notes: [] }],
      convYou: [{ kind: 'Issue', repo: 'e/f', number: 3, title: 'conv-you-item', url: '', notes: [] }],
    }
    await withAlertsDoc(page, doc)
    await page.goto('/alerts/your-move', { waitUntil: 'networkidle' })

    await expect(page.getByText('you-item', { exact: true })).toBeVisible()
    await expect(page.getByText('in-you-item', { exact: true })).toBeVisible()
    await expect(page.getByText('conv-you-item', { exact: true })).toBeVisible()
    await expect(page.getByText(/Your pull requests and issues \(1\)/)).toBeVisible()
    await expect(page.getByText(/Incoming — in others' repositories \(1\)/)).toBeVisible()
    await expect(page.getByText(/Conversations waiting on you \(1\)/)).toBeVisible()
  })

  test('unresolved-threads renders threads nested under each PR', async ({ page }) => {
    await withShellDocs(page)
    const doc = emptyDoc()
    doc.threads = {
      known: true,
      items: [
        {
          repo: 'a/b', number: 42, title: 'the PR', url: 'https://example.test',
          threads: [
            { path: 'src/foo.ts', author: 'alice', bot: false, at: '2026-11-06T00:00:00Z', outdated: false, body: 'first thread' },
            { path: 'src/bar.ts', author: 'bob', bot: true, at: '2026-11-06T01:00:00Z', outdated: true, body: 'second thread outdated' },
          ],
        },
      ],
    }
    await withAlertsDoc(page, doc)
    await page.goto('/alerts/unresolved-threads', { waitUntil: 'networkidle' })

    await expect(page.getByText('the PR')).toBeVisible()
    await expect(page.getByText('first thread')).toBeVisible()
    await expect(page.getByText('second thread outdated')).toBeVisible()
    await expect(page.getByText('outdated (code changed)')).toBeVisible()
    await expect(page.getByText('@bob (bot)')).toBeVisible()
  })

  test('stage-failed renders a phase strip per repository', async ({ page }) => {
    await withShellDocs(page)
    const doc = emptyDoc()
    doc.pipeline = {
      known: true,
      flagged: [],
      failed: [
        {
          owner: 'a', name: 'b', url: 'https://example.test', label: 'broken',
          phases: [
            { name: 'build', abbr: 'BLD', state: 'ok' },
            { name: 'test', abbr: 'TST', state: 'failed' },
            { name: 'deploy', abbr: 'DEP', state: 'pending' },
          ],
        },
      ],
    }
    await withAlertsDoc(page, doc)
    await page.goto('/alerts/stage-failed', { waitUntil: 'networkidle' })

    await expect(page.getByText('a/b')).toBeVisible()
    await expect(page.getByTitle('build: ok')).toBeVisible()
    await expect(page.getByTitle('test: failed')).toBeVisible()
    await expect(page.getByTitle('deploy: pending')).toBeVisible()
  })

  /*
    3. HYGIENE.
  */

  test('axe sweep over every alert page reports no serious or critical violations', async ({ page }) => {
    await withShellDocs(page)
    const doc = emptyDoc()
    // Known so the pages render their actual list markup; empty lists so
    // the axe run touches both the shell and the empty-state copy.
    doc.work = {
      known: true, partial: false, yourMove: 0,
      you: [], inYou: [], convYou: [],
    }
    doc.watch = { known: true, total: 0, claimed: [], closed: [] }
    doc.checks = { known: true, failed: [] }
    doc.health = { known: true, items: [] }
    doc.threads = { known: true, items: [] }
    doc.pipeline = { known: true, flagged: [], failed: [] }
    doc.poll = { known: true, lastUtc: '2026-11-06T00:00:00Z', nextUtc: '2026-11-06T01:00:00Z', intervalSeconds: 3600, failedRepos: [] }
    doc.api = { known: true, used: 100, limit: 5000, percent: 2, resetUtc: '2026-11-06T01:00:00Z' }
    await withAlertsDoc(page, doc)

    for (const path of ALL_PATHS) {
      await page.goto(path, { waitUntil: 'networkidle' })
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(
        bad,
        `${path} has serious/critical axe violations:\n  ${bad.map((v) => `[${v.impact}] ${v.id} — ${v.help}`).join('\n  ')}`,
      ).toHaveLength(0)
    }
  })

  test('no horizontal overflow at 390px on any alert page', async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'overflow check runs under the mobile-390 project')
    // The test runner guarantees the viewport; this guard is paranoia.
    void browserName

    await withShellDocs(page)
    const doc = emptyDoc()
    // Known with a long-title item on every list, to catch a wrapper that
    // relied on content being short.
    const longTitle = 'a title that is intentionally far too long to fit comfortably inside a narrow phone viewport without being wrapped or truncated'
    doc.work = {
      known: true, partial: false, yourMove: 1,
      you: [{ kind: 'PR', repo: 'owner/long-repo-name', number: 9999, title: longTitle, url: '', notes: [] }],
      inYou: [], convYou: [],
    }
    doc.watch = {
      known: true, total: 1, closed: [], claimed: [
        { repo: 'owner/long-repo-name', number: 9999, title: longTitle, url: '', status: 'CLAIMED' },
      ],
    }
    doc.checks = {
      known: true, failed: [{ name: 'owner/very-long-repository-name-that-will-not-wrap', error: 'network error, timed out after 30 seconds' }],
    }
    doc.health = {
      known: true, items: [
        { owner: 'owner', name: 'long-repo', url: '', health: 'DORMANT', polled: true, open: 9999, gfi: 99, ageKnown: true, ageDays: 999 },
      ],
    }
    doc.threads = {
      known: true, items: [
        {
          repo: 'owner/x', number: 1, title: longTitle, url: '',
          threads: [{ path: 'src/some/deep/nested/path/to/a/file.ts', author: 'a', bot: false, at: '2026-11-06T00:00:00Z', outdated: false, body: longTitle }],
        },
      ],
    }
    doc.pipeline = {
      known: true,
      flagged: [{ owner: 'owner', name: 'long-repo', url: '', stage: 'review', label: 'FLAGGED' }],
      failed: [{ owner: 'owner', name: 'long-repo', url: '', label: 'FAILED', phases: [
        { name: 'build', abbr: 'BLD', state: 'ok' }, { name: 'test', abbr: 'TST', state: 'failed' },
      ] }],
    }
    doc.poll = { known: true, lastUtc: '2026-11-06T00:00:00Z', nextUtc: '2026-11-06T01:00:00Z', intervalSeconds: 3600, failedRepos: [] }
    doc.api = { known: true, used: 4900, limit: 5000, percent: 98, resetUtc: '2026-11-06T01:00:00Z' }
    await withAlertsDoc(page, doc)

    for (const path of ALL_PATHS) {
      await page.goto(path, { waitUntil: 'networkidle' })
      const overflowed = await page.evaluate(() => {
        const w = document.documentElement.clientWidth
        return document.documentElement.scrollWidth > w + 1
      })
      expect(overflowed, `${path} overflows horizontally at 390px`).toBe(false)
    }
  })

  /*
    4. KNOWN WITH A WARNING. The partial-work banner — asserted separately
    because a partial state is different from unknown (we have some data,
    but not all), and a page that drops the warning is a page that
    silently acts on half a picture.
  */
  test('your-move: partial banner appears on partial work', async ({ page }) => {
    await withShellDocs(page)
    const doc = emptyDoc()
    doc.work = {
      known: true, partial: true, yourMove: 0,
      you: [], inYou: [], convYou: [],
    }
    await withAlertsDoc(page, doc)
    await page.goto('/alerts/your-move', { waitUntil: 'networkidle' })
    await expect(page.getByRole('status').filter({ hasText: /incomplete — the last refresh did not finish/ })).toBeVisible()
  })
})
