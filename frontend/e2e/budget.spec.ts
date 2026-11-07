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

const BUDGET_GZIP = {
  js: 150 * 1024,
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

test.describe('transfer budget', () => {
  test('the app shell stays within its measured baseline', () => {
    const assets = join(DIST, 'assets')
    let js = 0
    let css = 0
    const detail: string[] = []

    for (const name of readdirSync(assets)) {
      const p = join(assets, name)
      if (!statSync(p).isFile()) continue
      const g = gzipSize(p)
      detail.push(`${name} ${(g / 1024).toFixed(1)} KB gzip`)
      if (name.endsWith('.js')) js += g
      else if (name.endsWith('.css')) css += g
    }
    const doc = gzipSize(join(DIST, 'index.html'))
    const shell = js + css + doc

    expect(js, `JavaScript is ${(js / 1024).toFixed(1)} KB gzip, over the ${BUDGET_GZIP.js / 1024} KB budget.\n  ${detail.join('\n  ')}`).toBeLessThanOrEqual(BUDGET_GZIP.js)
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
        localStorage.setItem('hellogitty-visual-theme', 'vermilion')
      } catch {
        /* a blocked-storage browser falls back to the default identity */
      }
    })

    const artRequests: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/art/')) artRequests.push(r.url().split('/').pop()!)
    })
    await page.goto('/app/', { waitUntil: 'networkidle' })
    expect(
      await page.evaluate(() => document.documentElement.dataset.identity),
      'the identity did not take; the rest of this test would measure nothing',
    ).toBe('vermilion')

    const foreign = artRequests.filter((n) => n.includes('bone') || n.includes('azure'))
    expect(
      foreign,
      `the vermilion identity fetched art belonging to others: ${foreign.join(', ')}`,
    ).toHaveLength(0)
  })
})
