import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * The tracked-repositories page.
 *
 * The headline check here is the unpolled repository. `store.HealthLabel`
 * returns UNKNOWN for a repository that has never polled successfully, and in
 * that state its open / good-first / unassigned counts are all zero because
 * nobody has looked. The templated page printed those zeros, which says "this
 * repository needs nothing from you" about the one repository where that is
 * unknowable — normal-looking, and backwards.
 *
 * That check is first, and it was confirmed red against the printed zeros.
 */

type ApiRepo = {
  owner: string
  name: string
  polled: boolean
  health: string
  ageKnown: boolean
  open: number
}

async function repos(page: import('@playwright/test').Page): Promise<ApiRepo[]> {
  return page.evaluate(async () => {
    const r = await fetch('/app/api/dashboard.json', { headers: { accept: 'application/json' } })
    return (await r.json()).repos as ApiRepo[]
  })
}

/** The card for one repository, found by its owner/name heading. */
function card(page: import('@playwright/test').Page, owner: string, name: string) {
  return page.locator('li').filter({ has: page.getByRole('link', { name: `${owner}/${name}`, exact: true }) })
}

test.describe('tracked repositories', () => {
  test('an unpolled repository shows no counts, not zeros', async ({ page }) => {
    await page.goto('/repos', { waitUntil: 'networkidle' })
    const all = await repos(page)

    const unpolled = all.find((r) => !r.polled)
    test.skip(!unpolled, 'every tracked repository has polled; this state cannot arise here')

    const c = card(page, unpolled!.owner, unpolled!.name)
    await expect(c).toHaveCount(1)

    // The three stat cells must read as absent, not as zero.
    const stats = c.locator('a[target="_blank"]').filter({ hasText: /Open|Good first|Unassigned/ })
    await expect(stats).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await expect(stats.nth(i)).toContainText('—')
      await expect(stats.nth(i)).not.toContainText(/\b0\b/)
    }

    // And the card says why.
    await expect(c).toContainText('not checked')

    // A POLLED repository with a genuine zero must still show the zero —
    // otherwise this "fix" would just hide real counts.
    const polledZero = all.find((r) => r.polled && r.open === 0)
    if (polledZero) {
      const pc = card(page, polledZero.owner, polledZero.name)
      await expect(pc.locator('a').filter({ hasText: 'Open' })).toContainText('0')
    }
  })

  test('an unknown commit age is not rendered as a fresh commit', async ({ page }) => {
    await page.goto('/repos', { waitUntil: 'networkidle' })
    const all = await repos(page)
    const unknownAge = all.find((r) => !r.ageKnown)
    test.skip(!unknownAge, 'every tracked repository has a known commit age here')

    const c = card(page, unknownAge!.owner, unknownAge!.name)
    // "0d since commit" would read as committed today. The tag must be absent.
    await expect(c).not.toContainText('0d since commit')
    await expect(c).not.toContainText(/\bd since commit\b/)
  })

  test('sorting by most recent commit puts unknown ages last', async ({ page }) => {
    await page.goto('/repos', { waitUntil: 'networkidle' })
    const all = await repos(page)
    test.skip(
      !all.some((r) => !r.ageKnown) || !all.some((r) => r.ageKnown),
      'need both known and unknown ages to tell the orders apart',
    )

    await page.getByLabel('Sort by').selectOption('commit')
    const names = await page.locator('li a[href^="http"]').first().innerText()
    // The first card must be a repository whose age we actually know.
    const firstKnown = all.find((r) => r.ageKnown)
    expect(names).not.toBe('')
    // Ascending age with unknowns substituted as 0 would float every
    // never-checked repository to the top, as though just committed to.
    const unknownOwners = all.filter((r) => !r.ageKnown).map((r) => `${r.owner}/${r.name}`)
    const firstCardText = await page.locator('ul li').first().innerText()
    for (const u of unknownOwners) {
      expect(firstCardText, `${u} sorted to the top despite an unknown age`).not.toContain(u)
    }
    expect(firstKnown).toBeTruthy()
  })

  test('the count reads "n of m" so a filter is visible', async ({ page }) => {
    await page.goto('/repos', { waitUntil: 'networkidle' })
    const all = await repos(page)
    await expect(page.getByText(`${all.length} of ${all.length}`)).toBeVisible()

    // Narrow it, and the two numbers must part company.
    await page.getByLabel('Search tracked repositories').fill('zzzznomatch')
    await expect(page.getByText(`0 of ${all.length}`)).toBeVisible()
    await expect(page.getByText('No tracked repository matches those filters.')).toBeVisible()
  })

  test('the health filter narrows the list', async ({ page }) => {
    await page.goto('/repos', { waitUntil: 'networkidle' })
    const all = await repos(page)
    const active = all.filter((r) => r.health === 'ACTIVE').length
    test.skip(active === 0 || active === all.length, 'need a mixed health spread to tell filtering apart')

    await page.getByLabel('Filter by health').selectOption('ACTIVE')
    await expect(page.getByText(`${active} of ${all.length}`)).toBeVisible()
  })

  test('no serious or critical axe violations', async ({ page }) => {
    await page.goto('/repos', { waitUntil: 'networkidle' })
    const results = await new AxeBuilder({ page }).analyze()
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      bad,
      `axe violations:\n${bad.map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`).join('\n')}`,
    ).toHaveLength(0)
  })

  test('no horizontal overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/repos', { waitUntil: 'networkidle' })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `page scrolls ${overflow}px sideways at 390px`).toBeLessThanOrEqual(0)
  })
})
