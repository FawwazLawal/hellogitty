import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The gate for the two new read-only panels on /settings: the Maintain list
 * and the Pipeline-targets count.
 *
 * Both are gated on CONFIGURATION rather than data — maintain gates on list
 * length, pipeline-targets gates on the server's `hasPipeline` flag. That is
 * the "unknown is not zero" rule applied to configuration: a dashboard with
 * no `maintain:` key in its config file is a different thing from one with
 * `maintain: []`, and a dashboard with no `pipeline_command` is a different
 * thing from one with a pipeline that reports zero targets. The React page
 * must not render a "0 targets" line for a user who never set up a pipeline.
 */

interface WireDoc {
  version: string
  config: {
    listen: string
    database: string
    snapshot: string
    reposFile: string
    inbox: string
    layoutDefault: string
    maintain: string[]
  }
  polling: { intervalMinutes: number; lastPollUtc: string; nextPollUtc: string; known: boolean }
  api: { known: boolean; used: number; limit: number; percent: number; resetUtc: string }
  repos: { tracked: string[]; count: number; removed: string[]; inPipeline: number }
  hasPipeline: boolean
}

function doc(over: Partial<WireDoc>): WireDoc {
  return {
    version: 'test',
    config: {
      listen: 'localhost:7365',
      database: 'hellogitty.db',
      snapshot: 'snapshot.json',
      reposFile: '',
      inbox: '',
      layoutDefault: '',
      maintain: [],
    },
    polling: { intervalMinutes: 60, lastPollUtc: '2026-11-07 00:00:00Z', nextPollUtc: '2026-11-07 01:00:00Z', known: true },
    api: { known: true, used: 100, limit: 5000, percent: 2, resetUtc: '2026-11-07 00:30:00Z' },
    repos: { tracked: [], count: 0, removed: [], inPipeline: 0 },
    hasPipeline: false,
    ...over,
  }
}

async function serveSettings(page: Page, body: WireDoc) {
  await page.route('**/app/api/settings.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(body),
    }),
  )
}

// Session must respond so useSession doesn't error; mirrors the shape of
// /app/api/session.json from the Go side.
async function serveSession(page: Page) {
  await page.route('**/app/api/session.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ token: 'test', writable: true }),
    }),
  )
}

test.describe('/settings — maintain list + pipeline targets', () => {
  test('Maintain list renders every entry when configured', async ({ page }) => {
    await serveSession(page)
    await serveSettings(page, doc({ config: { ...doc({}).config, maintain: ['acmeorg', 'other-org/some-repo'] } }))
    await page.goto('/settings', { waitUntil: 'networkidle' })

    // The section carries its own heading with "config file" badge.
    const heading = page.getByText(/Maintain list/i)
    await expect(heading).toBeVisible()
    await expect(page.getByText('config file')).toBeVisible()

    // Each entry renders once, in order.
    await expect(page.getByText('acmeorg', { exact: true })).toBeVisible()
    await expect(page.getByText('other-org/some-repo', { exact: true })).toBeVisible()
  })

  test('Maintain list is HIDDEN when the config has no maintain entries', async ({ page }) => {
    await serveSession(page)
    await serveSettings(page, doc({ config: { ...doc({}).config, maintain: [] } }))
    await page.goto('/settings', { waitUntil: 'networkidle' })

    await expect(page.getByText(/Maintain list/i)).toHaveCount(0)
    await expect(page.getByText('config file')).toHaveCount(0)
  })

  test('Pipeline targets row shows when hasPipeline is true, hides otherwise', async ({ page }) => {
    await serveSession(page)

    // CONFIGURED: row renders with the count.
    await serveSettings(page, doc({ hasPipeline: true, repos: { tracked: [], count: 0, removed: [], inPipeline: 7 } }))
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const row = page.getByText('Pipeline targets')
    await expect(row).toBeVisible()
    // The value renders on the same row as the label — assert both in one
    // locator to avoid matching the number "7" somewhere else on the page.
    const serverPanel = page.locator('section').filter({ has: page.getByText('Pipeline targets') }).first()
    await expect(serverPanel).toContainText(/Pipeline targets[\s\S]*7/)
  })

  test('Pipeline targets row is HIDDEN when hasPipeline is false — no "0 targets" for a user without a pipeline', async ({ page }) => {
    await serveSession(page)
    await serveSettings(page, doc({ hasPipeline: false, repos: { tracked: [], count: 0, removed: [], inPipeline: 0 } }))
    await page.goto('/settings', { waitUntil: 'networkidle' })

    await expect(page.getByText('Pipeline targets')).toHaveCount(0)
  })

  test('/settings still fits 390px with both new sections present', async ({ page, viewport }, info) => {
    await serveSession(page)
    await serveSettings(
      page,
      doc({
        config: { ...doc({}).config, maintain: ['acmeorg', 'other-org/some-repo', 'third-entry/here'] },
        hasPipeline: true,
        repos: { tracked: [], count: 0, removed: [], inPipeline: 42 },
      }),
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await expectNoHorizontalOverflow(page, 390)
    await page.setViewportSize(viewport ?? { width: 1400, height: 1000 })
    void info
  })
})
