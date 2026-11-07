import { test, expect, type Page } from '@playwright/test'

/**
 * Adoption test for `motion` on /repos.
 *
 * ADR-UI-002 §8 requires motion to respect `prefers-reduced-motion` as a P0,
 * and the brief says "respect reduced-motion — that's a P0 in ADR §8, not a
 * nicety." So this file carries two gates:
 *
 *   1. With reduced motion ALLOWED, cards reorder smoothly on a sort change.
 *      motion renders `motion.li` elements that carry a transform while the
 *      layout animation is running — we check that a reordering card has a
 *      non-identity transform shortly after the sort change.
 *
 *   2. With reduced motion REDUCED (OS-level setting), the cards fall through
 *      to a plain `<li>` with no transform at all. The page must respect the
 *      setting, not merely shorten the duration — a 10ms transition is still
 *      a transition.
 *
 * The second check was proved red against a broken-on-purpose build where
 * `animate` ignored the hook's return — the reduce media query returned true
 * but cards still carried transforms. Restored.
 *
 * Live-only: the fixture server does not serve the React app.
 */

const live = !!process.env.HG_BASE_URL

async function gotoRepos(page: Page) {
  await page.goto('/repos', { waitUntil: 'networkidle' })
  await expect(page.locator('main h1', { hasText: 'Tracked repositories' })).toBeVisible()
}

test.describe('motion on /repos', () => {
  test.skip(!live, 'set HG_BASE_URL to a running instance to run this suite')

  test('card list animates layout when sort changes (reduced-motion off)', async ({ page, browser }) => {
    // Explicit OS setting: motion allowed. Default for most environments
    // already, but set it so the test does not depend on the runner's defaults.
    const ctx = await browser.newContext({ reducedMotion: 'no-preference' })
    const p = await ctx.newPage()
    try {
      await p.goto('/repos', { waitUntil: 'networkidle' })
      await p.getByLabel('Sort by').selectOption('name')
      // Change sort, then read inline styles immediately — motion sets a
      // transform on reordering cards while the FLIP tween runs.
      await p.getByLabel('Sort by').selectOption('open')
      // Within ~50ms a card in the list should carry a non-identity transform
      // from motion's projection engine. motion sets `transform: translate3d(...)`
      // on each reordering element.
      await expect
        .poll(
          async () => {
            const transforms = await p.$$eval('ul li', (lis) =>
              lis.map((el) => (el as HTMLElement).style.transform || getComputedStyle(el).transform),
            )
            return transforms.some((t) => t && t !== 'none' && t !== '' && !t.startsWith('matrix(1, 0, 0, 1,'))
          },
          { timeout: 1000 },
        )
        .toBe(true)
    } finally {
      await ctx.close()
    }
  })

  test('reduced motion disables the layout animation entirely', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const p = await ctx.newPage()
    try {
      await p.goto('/repos', { waitUntil: 'networkidle' })
      await p.getByLabel('Sort by').selectOption('name')
      await p.getByLabel('Sort by').selectOption('open')
      // Give motion a frame to set transforms, if it were going to. It will
      // not — `animate` short-circuits to a plain <li> under reduce.
      await p.waitForTimeout(100)
      const transforms = await p.$$eval('ul li', (lis) =>
        lis.map((el) => (el as HTMLElement).style.transform || ''),
      )
      // Every card must be transform-free: no inline FLIP measurements, no
      // projection, no motion.li wrapping at all.
      for (const t of transforms) {
        expect(t).toBe('')
      }
    } finally {
      await ctx.close()
    }
  })
})
