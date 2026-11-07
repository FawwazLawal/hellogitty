import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The gate for the Stages panel on /pipeline.
 *
 * Playwright route-interception stands in for the GitHub poll: the shell is
 * the real serveAppIndex, the asset pipeline is the real serveApp, only
 * /app/api/pipeline.json is faked. That isolates the Stages logic from board
 * data that moves between test runs.
 *
 * Catches, specifically:
 *
 *  1. Stages panel missing entirely — the templated page's `{{if .HasPipeline}}`
 *     is trivial to lose in a React port, and losing it is this PR's whole gap.
 *  2. Panel rendering for a dashboard that has NO pipeline configured — the
 *     reverse mistake, where `hasPipeline=false` still shows a "0 stages"
 *     header above an empty grid.
 *  3. 375px overflow — `<main>` has `overflow-x-hidden`, so a 2000px-wide
 *     stages row would silently clip. `expectNoHorizontalOverflow` measures
 *     both the document and `<main>`, which is the gate that catches that.
 */

interface WireDoc {
  lifetime: { opened: number; merged: number; closed: number; rate: string }
  openNow: { open: number; pending: number; approved: number; draft: number }
  known: boolean
  pullRequests: unknown[]
  repos: string[]
  hasPipeline: boolean
  stages: { abbr: string; name: string; count: number }[]
}

function doc(over: Partial<WireDoc>): WireDoc {
  return {
    lifetime: { opened: 0, merged: 0, closed: 0, rate: '' },
    openNow: { open: 0, pending: 0, approved: 0, draft: 0 },
    known: true,
    pullRequests: [],
    repos: [],
    hasPipeline: false,
    stages: [],
    ...over,
  }
}

async function servePipeline(page: Page, body: WireDoc) {
  await page.route('**/app/api/pipeline.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(body),
    }),
  )
}

const FIXTURE_STAGES = [
  { abbr: 'REC', name: 'recon', count: 3 },
  { abbr: 'GAT', name: 'gate', count: 2 },
  { abbr: 'SEL', name: 'select', count: 0 },
  { abbr: 'BLD', name: 'build', count: 5 },
  { abbr: 'REV', name: 'review', count: 1 },
  { abbr: 'PR', name: 'pr', count: 0 },
  { abbr: 'RES', name: 'respond', count: 4 },
]

test.describe('/pipeline — per-stage board', () => {
  test('Stages panel renders when hasPipeline is true, in pipeline order', async ({ page }) => {
    await servePipeline(page, doc({ hasPipeline: true, stages: FIXTURE_STAGES }))
    await page.goto('/pipeline', { waitUntil: 'networkidle' })

    const stagesPanel = page.locator('section').filter({ hasText: /Stages/ }).first()
    await expect(stagesPanel).toBeVisible()
    const cards = stagesPanel.locator('ul > li')
    await expect(cards).toHaveCount(7)
    // Order matters — alphabetical would sort to build/gate/pr/… which is not
    // the pipeline's own order.
    const names = await cards.evaluateAll((lis) => lis.map((li) => (li as HTMLElement).innerText.toLowerCase()))
    expect(names.some((n) => n.includes('recon'))).toBe(true)
    expect(names[0]).toContain('recon')
    expect(names[names.length - 1]).toContain('respond')
  })

  test('Stages panel is HIDDEN when hasPipeline is false — no empty 0-stages header', async ({ page }) => {
    await servePipeline(page, doc({ hasPipeline: false, stages: [] }))
    await page.goto('/pipeline', { waitUntil: 'networkidle' })

    // Scope strictly to the PR Pipeline page body so other "Stages" text on the
    // nav / masthead (if any) can't satisfy it.
    const stagesPanel = page.locator('main section').filter({ hasText: /^Stages/ })
    await expect(stagesPanel).toHaveCount(0)
  })

  test('zero-count stage dims, never hides — an empty stage is information', async ({ page }) => {
    await servePipeline(page, doc({ hasPipeline: true, stages: FIXTURE_STAGES }))
    await page.goto('/pipeline', { waitUntil: 'networkidle' })

    const stagesPanel = page.locator('section').filter({ hasText: /Stages/ }).first()
    // 7 cards, including the two with count=0.
    await expect(stagesPanel.locator('ul > li')).toHaveCount(7)
    // The zero cards render the digit 0 — never an em dash and never an empty
    // slot. The templated page uses `.zero` styling and we follow the rule.
    // A card's text concatenates count + name, so "select" (count 0) reads as
    // "0select". Pull the text, find the card whose NAME is select, assert 0.
    const cards = await stagesPanel.locator('ul > li').allInnerTexts()
    const selectCard = cards.find((t) => /select/i.test(t))
    expect(selectCard, 'no card named "select" in the rendered Stages panel').toBeDefined()
    expect(selectCard).toContain('0')
    expect(selectCard).not.toContain('—')
  })

  test('/pipeline with 15 stages fits 375px (document + <main>)', async ({ page, viewport }, info) => {
    const manyStages = Array.from({ length: 15 }, (_, i) => ({
      abbr: `S${i + 1}`,
      name: `stage-${i + 1}`,
      count: i,
    }))
    await servePipeline(page, doc({ hasPipeline: true, stages: manyStages }))
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/pipeline', { waitUntil: 'networkidle' })
    await expectNoHorizontalOverflow(page, 375)
    await page.setViewportSize(viewport ?? { width: 1400, height: 1000 })
    void info
  })
})
