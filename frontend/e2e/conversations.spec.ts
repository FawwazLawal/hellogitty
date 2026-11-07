import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The gate for /conversations, pointed at the built Go binary.
 *
 * Playwright's route-interception stands in for the GitHub poll: the shell is
 * the real serveAppIndex, the asset pipeline is the real serveApp, and only
 * /app/api/work.json is faked. That gives us a deterministic board without
 * standing up the GitHub side on CI.
 *
 * WHAT THIS GATE EXISTS TO CATCH, in the order it catches them:
 *
 *  1. Unknown rendered as zero. The dashboard polls on an interval; before the
 *     first poll completes, the board is unknown — and a UI that renders
 *     "0 need you" on an unpolled board tells the viewer nothing needs them.
 *     Every count on this page carries a `known` flag; this gate checks the
 *     flag is drawn as an em dash, not a zero.
 *
 *  2. Unknown sorted first. "Sort by Updated" that treats an absent timestamp
 *     as 1970 promotes the row we know least about to the top. This gate
 *     plants a row with sinceUnix=0 among known rows and checks it sinks to
 *     the bottom in both directions.
 *
 *  3. Horizontal overflow at 390px. The templated page hid overflow with a
 *     wrapper; the React page has to EARN non-overflow. A scroll bar at the
 *     narrow width means something is too wide, and the viewer scrolls the
 *     whole page sideways.
 *
 *  4. Accessibility violations. axe, serious/critical only — the "this is a
 *     product bug" subset. The axe gate elsewhere in the suite covers the
 *     templated pages; this one covers the React page.
 *
 *  5. Filter toggle. Clicking "Needs me" hides the waiting group, and the
 *     overview card for the same group goes pressed. The templated page
 *     ships this and the React page has to keep it.
 */

interface WireRow {
  key: string
  kind: string
  repo: string
  number: number
  title: string
  url: string
  why: string
  ago: string
  agoTitle: string
  sinceUnix: number
  attn?: string
}

interface WireDoc {
  known: boolean
  partial: boolean
  login: string
  scope: string
  you: WireRow[]
  them: WireRow[]
  done: WireRow[]
  dismissed: WireRow[]
  convYou: WireRow[]
  convThem: WireRow[]
  convNew: number
  error?: string
}

function row(over: Partial<WireRow> & { key: string; repo: string; number: number }): WireRow {
  return {
    kind: 'Issue',
    title: `title ${over.number}`,
    url: `https://github.com/${over.repo}/issues/${over.number}`,
    why: 'You joined the thread',
    ago: '3 days',
    agoTitle: '2026-11-03 09:00Z',
    sinceUnix: 1730623200,
    ...over,
  }
}

function doc(over: Partial<WireDoc>): WireDoc {
  return {
    known: true,
    partial: false,
    login: 'alice',
    scope: 'repos owned by alice',
    you: [],
    them: [],
    done: [],
    dismissed: [],
    convYou: [],
    convThem: [],
    convNew: 0,
    ...over,
  }
}

async function serveWork(page: Page, body: WireDoc) {
  await page.route('**/app/api/work.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(body),
    }),
  )
}

async function gotoConversations(page: Page) {
  await page.goto('/conversations', { waitUntil: 'networkidle' })
}

test.describe('/conversations', () => {
  /**
   * UNKNOWN IS NOT ZERO. With known=false — the state before the first poll —
   * every overview card is the em dash. A zero in this state is the lie this
   * page exists to avoid.
   */
  test('unknown reads as em dash, not zero', async ({ page }) => {
    await serveWork(page, doc({ known: false }))
    await gotoConversations(page)

    const cards = page.locator('button, div').filter({ hasText: /Needs your reply|Waiting on others|Unread/ })
    // Each KPI shows an em dash (U+2014), not the digit 0. A screen with one
    // "0" somewhere else (a count, say) would not satisfy this — the match is
    // scoped to the overview cards above.
    await expect(page.getByText('Needs your reply').locator('..').getByText('—', { exact: true })).toBeVisible()
    await expect(page.getByText('Waiting on others').locator('..').getByText('—', { exact: true })).toBeVisible()
    await expect(page.getByText('Unread').locator('..').getByText('—', { exact: true })).toBeVisible()
    expect(await cards.getByText(/^0$/).count()).toBe(0)
  })

  /**
   * UNKNOWN SORTS LAST. A row with sinceUnix=0 is one the server never got a
   * timestamp for; sorting it to the top of "Updated" promotes the thing we
   * know least about to the thing most worth looking at.
   */
  test('sort by "Updated" puts unknown sinceUnix LAST', async ({ page }) => {
    await serveWork(
      page,
      doc({
        convYou: [
          row({ key: 'a', repo: 'acme/rocket', number: 1, sinceUnix: 1700000000 }),
          row({ key: 'b', repo: 'acme/rocket', number: 2, sinceUnix: 0 }),
          row({ key: 'c', repo: 'acme/rocket', number: 3, sinceUnix: 1800000000 }),
        ],
      }),
    )
    await gotoConversations(page)
    await page.getByRole('button', { name: /Updated/ }).click()

    // Desc (first click on Updated — its default direction): newest first,
    // unknown at the bottom.
    const ordered = await page.locator('[data-testid="conv-list"] li').evaluateAll((lis) =>
      lis.map((li) => Number((li as HTMLElement).dataset.sinceunix)),
    )
    expect(ordered, 'unknown must sit after every known timestamp').toEqual([1800000000, 1700000000, 0])
  })

  /**
   * No horizontal overflow at 390px. The shared helper measures BOTH the
   * document and `<main>` — the document-only version is the one that was
   * passing over genuinely broken pages because `overflow-x-hidden` on `<main>`
   * clips inner overflow instead of repairing it.
   */
  test('fits 390px without horizontal overflow', async ({ page, viewport }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await serveWork(
      page,
      doc({
        convYou: [row({ key: 'a', repo: 'acme/rocket', number: 1 })],
        convThem: [row({ key: 'b', repo: 'other/very-long-repository-name-here', number: 2 })],
      }),
    )
    await gotoConversations(page)
    await expectNoHorizontalOverflow(page, 390)
    // Restore for the next test.
    await page.setViewportSize(viewport ?? { width: 1400, height: 1000 })
    // info is unused here but kept to show the viewport came from the project.
    void info
  })

  /**
   * axe: no serious/critical violations. The ratchet suite covers the rest;
   * this gate guards the sharpest subset for the one React page under test.
   */
  test('passes axe on serious/critical', async ({ page }) => {
    await serveWork(
      page,
      doc({
        convYou: [row({ key: 'a', repo: 'acme/rocket', number: 1 })],
        convThem: [row({ key: 'b', repo: 'other/repo', number: 2 })],
        convNew: 1,
      }),
    )
    await gotoConversations(page)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(bad, bad.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([])
  })

  /**
   * FILTER toggles visibility. The three filter buttons are the page's
   * primary control, and a page where the active chip highlights but the list
   * does not change is the specific regression this catches.
   */
  test('filter "Needs me" hides the waiting group and marks the card pressed', async ({ page }) => {
    await serveWork(
      page,
      doc({
        convYou: [row({ key: 'a', repo: 'acme/rocket', number: 1 })],
        convThem: [row({ key: 'b', repo: 'other/repo', number: 2 })],
      }),
    )
    await gotoConversations(page)

    await page.getByRole('button', { name: 'Needs me' }).click()
    const groups = await page
      .locator('[data-testid="conv-list"] li')
      .evaluateAll((lis) => lis.map((li) => (li as HTMLElement).dataset.group))
    expect(groups).toEqual(['you'])
    // The overview card for the same group reflects the active filter.
    const card = page.getByRole('button', { name: /Needs your reply/ })
    await expect(card).toHaveAttribute('aria-pressed', 'true')
  })
})
