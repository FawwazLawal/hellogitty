import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The performance budget, as a measured baseline rather than an invented one.
 *
 * ADR-UI-002 §8: "Performance budgets are provisional and must be measured on
 * documented hardware/browsers ... Establish concrete budgets at Gate A based
 * on an actual baseline; avoid invented benchmark success."
 *
 * Gate A passed without one, so §8's targets had nothing to measure against.
 * This sets the baseline from what the build actually produces today and
 * fails if it grows materially — which is the only version of a budget that
 * does any work. A number picked from the air either never fires or fires
 * constantly.
 *
 * BASELINE, measured 2026-11-07 on the committed build:
 *
 *   JavaScript   393 KB raw   118 KB gzip
 *   CSS           24 KB raw     6 KB gzip
 *   document     470 B         292 B gzip
 *   app shell total          124 KB gzip
 *   art, all three identities 153 KB raw, served per identity, never all at once
 *
 * The ceilings below sit ~25% above that. Growth inside the headroom is
 * normal; crossing it should be a decision rather than a surprise, and the
 * failure message says which file moved.
 */

/**
 * RE-BASELINED 2026-11-07, after a regression this gate could not see.
 *
 * `motion` landed for one card-reorder animation on /repos and added 44 KB
 * gzip — measured by building the commit before and the commit after. It was
 * imported at the top level, so it rode in the shared chunk and every reader
 * of every page paid for it. The bundle went 137 KB -> 181 KB -> 197 KB
 * through a 150 KB ceiling, and nothing fired, because this suite is
 * Playwright and CI does not run Playwright.
 *
 * Two things changed in response. /repos and /alerts/* are now loaded on
 * demand, so the animation's cost falls on the page that uses it. And this
 * budget now distinguishes two numbers that the old single `js` total
 * conflated:
 *
 *   entryJs  what a reader downloads to see a page. The number §8 is about.
 *            Still 150 KB — NOT raised. Currently 147.4 KB.
 *
 *   totalJs  every chunk on disk, including ones most readers never fetch.
 *            Worth bounding so splitting cannot become a way to hide weight,
 *            but it is not a first-load cost and a single ceiling over both
 *            punishes the split that fixed the problem.
 *
 * Splitting a chunk moves weight out of entryJs and leaves totalJs alone, so
 * the pair cannot be gamed in either direction: you cannot shrink the entry
 * by hiding code in a lazy chunk without totalJs noticing, and you cannot
 * blow the entry up without entryJs noticing.
 */
const BUDGET_GZIP = {
  entryJs: 150 * 1024,
  totalJs: 230 * 1024,
  css: 12 * 1024,
  shell: 165 * 1024,
}

/** Where Vite writes, which is the directory Go embeds. */
// ESM: no __dirname. Resolve from import.meta.url so the path holds
// wherever the runner is invoked from.
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', '..', 'web', 'app')

function gzipSize(path: string): number {
  return gzipSync(readFileSync(path), { level: 6 }).length
}

/**
 * Every script the browser fetches before first paint, in the order the
 * document lists them: the entry `<script type="module" src="...">` and
 * every `<link rel="modulepreload" href="...">`. A lazy route chunk
 * is reached through a dynamic import and is NOT in `index.html`, so it
 * is not counted — that is the whole point of the lazy-loading work.
 *
 * An earlier form of this test read only the first `assets/*.js` match
 * and silently measured one chunk of three once Vite split the shared
 * mass. The CI step (#332) and this spec disagreed with the browser by
 * tens of KB; both are now summing the same set.
 */
function readFirstPaintChunks(html: string): string[] {
  const chunks: string[] = []
  const seen = new Set<string>()
  const re = new RegExp(
    [
      String.raw`<script[^>]*\bsrc=["']\/app\/(assets\/[^"']+?\.js)["']`,
      String.raw`<link[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']\/app\/(assets\/[^"']+?\.js)["']`,
      String.raw`<link[^>]*\bhref=["']\/app\/(assets\/[^"']+?\.js)["'][^>]*\brel=["']modulepreload["']`,
    ].join('|'),
    'g',
  )
  for (const m of html.matchAll(re)) {
    const path = m.slice(1).find(Boolean)
    if (path && !seen.has(path)) {
      seen.add(path)
      chunks.push(path)
    }
  }
  return chunks
}

test.describe('transfer budget', () => {
  test('the app shell stays within its measured baseline', () => {
    const assets = join(DIST, 'assets')
    let totalJs = 0
    let css = 0
    const detail: string[] = []

    const html = readFileSync(join(DIST, 'index.html'), 'utf8')
    const firstPaint = readFirstPaintChunks(html)
    expect(
      firstPaint.length,
      'no first-paint scripts found in index.html; this check would measure nothing',
    ).toBeGreaterThan(0)
    const firstPaintSet = new Set(firstPaint)

    let entryJs = 0
    for (const name of readdirSync(assets)) {
      const p = join(assets, name)
      if (!statSync(p).isFile()) continue
      const g = gzipSize(p)
      const marker = firstPaintSet.has(`assets/${name}`) ? '  <- first-paint' : ''
      detail.push(`${name} ${(g / 1024).toFixed(1)} KB gzip${marker}`)
      if (name.endsWith('.js')) {
        totalJs += g
        if (firstPaintSet.has(`assets/${name}`)) entryJs += g
      } else if (name.endsWith('.css')) css += g
    }
    expect(entryJs, 'no first-paint chunks were found on disk').toBeGreaterThan(0)

    const doc = gzipSize(join(DIST, 'index.html'))
    const shell = entryJs + css + doc

    expect(entryJs, `first-load JavaScript is ${(entryJs / 1024).toFixed(1)} KB gzip, over the ${BUDGET_GZIP.entryJs / 1024} KB first-load budget.\n  ${detail.join('\n  ')}`).toBeLessThanOrEqual(BUDGET_GZIP.entryJs)
    expect(totalJs, `all JavaScript is ${(totalJs / 1024).toFixed(1)} KB gzip, over the ${BUDGET_GZIP.totalJs / 1024} KB total budget.\n  ${detail.join('\n  ')}`).toBeLessThanOrEqual(BUDGET_GZIP.totalJs)
    expect(css, `CSS is ${(css / 1024).toFixed(1)} KB gzip, over the ${BUDGET_GZIP.css / 1024} KB budget`).toBeLessThanOrEqual(BUDGET_GZIP.css)
    expect(shell, `the app shell is ${(shell / 1024).toFixed(1)} KB gzip, over the ${BUDGET_GZIP.shell / 1024} KB budget`).toBeLessThanOrEqual(BUDGET_GZIP.shell)
  })

  /**
   * §8 P1: "no wasted huge assets for inactive themes." Art is resolved per
   * identity through the registry, so a viewer should never pay for all three.
   */
  test('a single identity does not download every identity\'s art', async ({ page }) => {
    /*
      Set the identity BEFORE the first paint. The earlier version of this test
      navigated without one, so Playwright's default light preference selected
      Bone — and the test then failed on Bone's own art, reporting a defect in
      the app that was really a wrong premise in the test.
    */
    await page.addInitScript(() => {
      try {
        // Vermilion is the amoled appearance of the Oni pack post-2b;
        // ThemeProvider migrates the old identity name on load, but we can
        // set the migrated shape directly to avoid the migration step.
        localStorage.setItem('hellogitty-visual-theme', 'oni')
        localStorage.setItem('hellogitty-theme', 'amoled')
      } catch {
        /* a blocked-storage browser falls back to the default pack */
      }
    })

    const artRequests: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/art/')) artRequests.push(r.url().split('/').pop()!)
    })
    await page.goto('/app/', { waitUntil: 'networkidle' })
    expect(
      await page.evaluate(() => document.documentElement.dataset.visualTheme),
      'the pack did not take; the rest of this test would measure nothing',
    ).toBe('oni')

    const foreign = artRequests.filter((n) => n.includes('bone') || n.includes('azure'))
    expect(
      foreign,
      `the vermilion appearance fetched art belonging to others: ${foreign.join(', ')}`,
    ).toHaveLength(0)
  })
})
