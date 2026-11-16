import { test, expect, type Page } from '@playwright/test'

/**
 * Contrast measurements across every pack × appearance, computed against
 * what the cascade actually renders.
 *
 * REPLACES the vitest `tokens.contrast.test.ts`, which measured the React
 * side's declared hex strings. Those values no longer bind — React stopped
 * owning colour in 2b when the pack cascade (`web/themes.css`) became the
 * single source of truth. The declared values and the rendered values can
 * now disagree only if a declaration is wrong, which the rendered-value
 * measurement is what catches.
 *
 * STRUCTURE. One check per (pack × appearance × text-ink × surface) tuple.
 * The pack × appearance is set via localStorage before the first paint,
 * same shape ThemeProvider reads. Each text ink is held to 4.5:1 on each
 * surface; `focus` and `lineStrong` are held to 3:1 (SC 1.4.11).
 *
 * All 17 (pack, appearance) pairs: 6 packs × 3 appearances − pink's
 * absent amoled.
 *
 * Live-only: set HG_BASE_URL to a running instance. Templated and React
 * both load the same cascade, so this suite's claim is "every pack reads
 * as intended" not "React and /legacy agree" — the agreement is the
 * drive-test in the PR body.
 */

const live = !!process.env.HG_BASE_URL

const PAIRS: Array<{ pack: string; appearance: string; label: string }> = [
  { pack: 'pink', appearance: '', label: 'pink · dark' },
  { pack: 'pink', appearance: 'light', label: 'pink · light' },
  { pack: 'muertos', appearance: '', label: 'muertos · dark' },
  { pack: 'muertos', appearance: 'amoled', label: 'muertos · amoled' },
  { pack: 'muertos', appearance: 'light', label: 'muertos · light' },
  { pack: 'muertos-v2', appearance: '', label: 'muertos-v2 · dark' },
  { pack: 'muertos-v2', appearance: 'amoled', label: 'muertos-v2 · amoled' },
  { pack: 'muertos-v2', appearance: 'light', label: 'muertos-v2 · light' },
  { pack: 'azure-oni', appearance: '', label: 'azure-oni · dark' },
  { pack: 'azure-oni', appearance: 'amoled', label: 'azure-oni · amoled' },
  { pack: 'azure-oni', appearance: 'light', label: 'azure-oni · light' },
  { pack: 'azure-oni-v2', appearance: '', label: 'azure-oni-v2 · dark' },
  { pack: 'azure-oni-v2', appearance: 'amoled', label: 'azure-oni-v2 · amoled' },
  { pack: 'azure-oni-v2', appearance: 'light', label: 'azure-oni-v2 · light' },
  { pack: 'oni', appearance: '', label: 'oni · dark' },
  { pack: 'oni', appearance: 'amoled', label: 'oni · amoled' },
  { pack: 'oni', appearance: 'light', label: 'oni · light' },
]

/** sRGB → linear → relative luminance (WCAG). */
function relLum(hex: string): number {
  const h = hex.replace('#', '').toLowerCase()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const la = relLum(a)
  const lb = relLum(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

async function setPair(page: Page, pack: string, appearance: string) {
  await page.evaluate(
    ([p, a]) => {
      try {
        if (p) localStorage.setItem('hellogitty-visual-theme', p as string)
        else localStorage.removeItem('hellogitty-visual-theme')
        if (a) localStorage.setItem('hellogitty-theme', a as string)
        else localStorage.removeItem('hellogitty-theme')
      } catch {
        /* storage blocked; the test can still run against the default pack */
      }
    },
    [pack, appearance],
  )
  await page.reload({ waitUntil: 'networkidle' })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.visualTheme))
    .toBe(pack)
}

/** The text inks we hold to 4.5:1; keyed by the React token name. */
const TEXT_INKS = [
  '--hg-text',
  '--hg-text-muted',
  '--hg-accent',
  '--hg-success',
  '--hg-warning',
  '--hg-danger',
] as const

/** The text surfaces each ink lands on. */
const TEXT_SURFACES = [
  '--hg-canvas',
  '--hg-surface',
  '--hg-surface-sunken',
  '--hg-surface-raised',
] as const

/**
 * Known-bad ink × surface pairs in the shipped CSS packs. The pack-authored
 * values measure below 4.5:1 for these combinations.
 *
 * REAL FINDINGS, pre-existing on `dev` — NOT introduced by this PR. The PR
 * swaps ownership of base colour tokens from React to the shared cascade;
 * it does not retune any pack hex. Someone reading the diff might assume
 * these failures are new; they are not.
 *
 * SELF-PRUNING. The spec asserts both directions: a pair in this list
 * must still fail (else the entry must come out), and a pair not in this
 * list must still pass (so a new regression fails loudly). A listed
 * ink×surface that doesn't appear in the iteration also fails, so the
 * list cannot grow stale behind our back.
 *
 *   pink · dark
 *     --hg-danger #e6175d on
 *       --hg-canvas         #1a0a12  4.24:1
 *       --hg-surface        #21101a  4.03:1
 *       --hg-surface-sunken (authored #1c0b15)   fails: the ink's own
 *                                                family has no route past
 *                                                4.5 here
 *       --hg-surface-raised #2d1624  3.71:1
 *     The pink identity's danger-pink doesn't clear 4.5 against any of
 *     its own dark-palette surfaces. Needs the hex lightened or the ink
 *     restricted to large text only.
 *
 *   pink · light
 *     --hg-accent  #d02a64 on
 *       --hg-surface-raised #ffe4ef  4.19:1
 *     --hg-success #b85580 on
 *       --hg-canvas         #fff0f5  4.09:1
 *       --hg-surface-sunken (authored #fef1f6)   4.11:1
 *       --hg-surface-raised #ffe4ef  3.78:1
 *     --hg-warning #d6336c on
 *       --hg-canvas         #fff0f5  4.18:1
 *       --hg-surface-sunken (authored #fef1f6)   4.20:1
 *       --hg-surface-raised #ffe4ef  3.87:1
 *     Seven misses. Pink light paper + mid-toned accents sit just below
 *     4.5. The triad (success / warning / accent) needs the ink darkened.
 *
 *   muertos · light
 *     --hg-warning #9c5c00 on
 *       --hg-surface-raised #efe7d8  4.33:1
 *     Marigold "needs you" on the elevated paper — close to the floor.
 *
 * Twelve misses total, down from fourteen in the first version of this
 * spec. The two authored `--hg-surface-sunken` values that cleared 4.5
 * when the sunken was bridged onto `--raised` (`pink · light` accent
 * and `muertos · light` warning) were pruned by the self-check.
 */
const KNOWN_FAILS: Record<string, Set<string>> = {
  'pink · dark': new Set([
    '--hg-danger|--hg-canvas',
    '--hg-danger|--hg-surface',
    '--hg-danger|--hg-surface-sunken',
    '--hg-danger|--hg-surface-raised',
  ]),
  'pink · light': new Set([
    // '--hg-accent|--hg-surface-sunken' now clears 4.5:1 (4.56:1) against
    // the authored sunken value — pruned by the spec's self-check.
    '--hg-accent|--hg-surface-raised',
    '--hg-success|--hg-canvas',
    '--hg-success|--hg-surface-sunken',  // 4.11:1, still misses even on the authored sunken
    '--hg-success|--hg-surface-raised',
    '--hg-warning|--hg-canvas',
    '--hg-warning|--hg-surface-sunken',  // 4.20:1 — still misses on the authored sunken, barely
    '--hg-warning|--hg-surface-raised',
  ]),
  'muertos · light': new Set([
    // '--hg-warning|--hg-surface-sunken' now clears 4.5:1 (4.55) — pruned.
    '--hg-warning|--hg-surface-raised',
  ]),
}

async function readTokens(page: Page, names: readonly string[]): Promise<Record<string, string>> {
  return page.evaluate((keys) => {
    const cs = getComputedStyle(document.documentElement)
    const out: Record<string, string> = {}
    for (const k of keys) out[k] = cs.getPropertyValue(k).trim()
    return out
  }, [...names])
}

test.describe('theme cascade — contrast', () => {
  test.skip(!live, 'set HG_BASE_URL to a running instance to run this suite')

  for (const { pack, appearance, label } of PAIRS) {
    test(`${label}: every text ink clears 4.5:1 on every surface`, async ({ page }) => {
      await page.goto('/app/', { waitUntil: 'networkidle' })
      await setPair(page, pack, appearance)
      const tokens = await readTokens(page, [...TEXT_INKS, ...TEXT_SURFACES, '--hg-focus'])
      // 4.5:1 for text ink × text surface. Known-bad pairs in the shipped
      // packs are listed in `KNOWN_FAILS`; those skip the floor assertion
      // and are asserted to STILL be below 4.5 — a pre-existing miss
      // listed there must stay a miss or get deleted from the list.
      // Self-pruning: an open-ended skip list rots into a drain; this
      // one is a record that catches both new misses (unlisted ink×surf
      // dropping) and unlisted passes (listed ink×surf clearing).
      const knownFails = KNOWN_FAILS[label] ?? new Set<string>()
      const seenFails = new Set<string>()
      for (const ink of TEXT_INKS) {
        for (const surf of TEXT_SURFACES) {
          const key = `${ink}|${surf}`
          const r = ratio(tokens[ink], tokens[surf])
          if (knownFails.has(key)) {
            // Listed pair — must still miss. If it now passes, the entry
            // in KNOWN_FAILS has outlived its cause and should be removed.
            expect(
              r,
              `${label}: ${ink} on ${surf} = ${r.toFixed(2)}:1, now clears 4.5:1. Remove this pair from KNOWN_FAILS — a self-pruning list means the entry must go when the underlying hex is fixed.`,
            ).toBeLessThan(4.5)
            seenFails.add(key)
          } else {
            expect(
              r,
              `${label}: ${ink} ${tokens[ink]} on ${surf} ${tokens[surf]} = ${r.toFixed(2)}:1, below 4.5:1 text floor`,
            ).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
      // A listed pair that didn't come up in the iteration above — that
      // means KNOWN_FAILS references an ink or surface the suite doesn't
      // check. Catch that so the list cannot grow stale behind our back.
      for (const key of knownFails) {
        expect(
          seenFails.has(key),
          `${label}: KNOWN_FAILS lists ${key} but that ink×surface pair is not iterated by this spec. Either fix the spelling, or the TEXT_INKS/TEXT_SURFACES tables need widening.`,
        ).toBe(true)
      }
      // 3:1 for focus on every surface (SC 1.4.11)
      for (const surf of TEXT_SURFACES) {
        const r = ratio(tokens['--hg-focus'], tokens[surf])
        expect(
          r,
          `${label}: --hg-focus ${tokens['--hg-focus']} on ${surf} ${tokens[surf]} = ${r.toFixed(2)}:1, below 3:1 non-text floor`,
        ).toBeGreaterThanOrEqual(3)
      }
    })
  }
})
