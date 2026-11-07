import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * The gates, pointed at the React application.
 *
 * The existing visual and axe specs target the Go-rendered dashboard, and they
 * stay — that page is still what / serves and still what most people see. This
 * file covers the new app, which is a different surface with different risks.
 *
 * WHY A SEPARATE FILE rather than parameterising the old one: the two apps have
 * different URLs, different identity mechanics and, for now, different
 * baselines. Folding them together would mean a change to either one churning
 * the other's snapshots, and a gate whose snapshots churn for unrelated reasons
 * is a gate people stop reading.
 */

const IDENTITIES = ['vermilion', 'azure', 'bone'] as const
const APPEARANCES = ['dark', 'light'] as const

/** Set identity and appearance the way the app itself stores them, then reload. */
async function useTheme(page: Page, identity: string, appearance?: string) {
  await page.addInitScript(
    ([id, app]) => {
      try {
        localStorage.setItem('hellogitty-visual-theme', id as string)
        if (app) localStorage.setItem('hellogitty-theme', app as string)
        else localStorage.removeItem('hellogitty-theme')
      } catch {
        /* a blocked-storage browser still renders the default identity */
      }
    },
    [identity, appearance ?? ''],
  )
  await page.goto('/app/', { waitUntil: 'networkidle' })
  // The theme is applied in an effect, so wait for it to have landed rather
  // than for a fixed delay. Reading a computed style too early was the single
  // most common source of wrong measurements while building this.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.identity))
    .toBe(identity)
}

test.describe('the React app', () => {
  test('renders every identity with no console errors and no network reach', async ({ page }) => {
    const errors: string[] = []
    const external: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('request', (r) => {
      const u = r.url()
      if (!u.startsWith('http://127.0.0.1') && !u.startsWith('http://localhost') && !u.startsWith('data:')) {
        external.push(u)
      }
    })

    for (const identity of IDENTITIES) {
      await useTheme(page, identity)
      // The shell is present, not just a mounted root.
      await expect(page.locator('header').first()).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
      await expect(page.getByRole('table')).toBeVisible()
    }

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0)
    expect(external, `offline-first product reached the network: ${external.join(', ')}`).toHaveLength(0)
  })

  /**
   * The contrast sweep, run as a gate rather than by hand.
   *
   * This measures every text node against the background actually painted
   * behind it, which is the only version of this measurement that has been
   * trustworthy — reading a token and assuming it is what landed produced wrong
   * answers repeatedly, and so did reading computed styles mid-transition.
   */
  for (const identity of IDENTITIES) {
    test(`${identity}: every text node clears its contrast floor`, async ({ page }) => {
      await useTheme(page, identity)
      const failures = await page.evaluate(() => {
        const lin = (c: number) => {
          const v = c / 255
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
        }
        const toRGB = (s: string): number[] => {
          if (s.startsWith('#')) {
            const h = s.slice(1)
            const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
            return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16))
          }
          return (s.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
        }
        const L = (s: string) => {
          const [r, g, b] = toRGB(s)
          return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        }
        const cr = (a: string, b: string) => {
          const x = L(a)
          const y = L(b)
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
        }
        /** Walk up for the first ancestor that actually paints a background. */
        const painted = (el: Element): string => {
          let n: Element | null = el
          while (n && n !== document.documentElement) {
            const bg = getComputedStyle(n).backgroundColor
            if (bg && !/rgba\(.*,\s*0\)/.test(bg) && bg !== 'transparent') return bg
            n = n.parentElement
          }
          return getComputedStyle(document.body).backgroundColor
        }

        const out: { text: string; ratio: number; floor: number; size: string }[] = []
        const leaves = [...document.querySelectorAll('body *')].filter(
          (e) => e.children.length === 0 && (e.textContent ?? '').trim().length > 0,
        )
        for (const el of leaves) {
          const c = getComputedStyle(el)
          if (c.visibility === 'hidden' || c.display === 'none') continue
          const size = parseFloat(c.fontSize)
          const weight = parseInt(c.fontWeight) || 400
          const floor = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5
          const ratio = cr(c.color, painted(el))
          if (ratio < floor) {
            out.push({
              text: (el.textContent ?? '').trim().slice(0, 30),
              ratio: +ratio.toFixed(2),
              floor,
              size: c.fontSize,
            })
          }
        }
        return out
      })

      expect(
        failures,
        `text below its contrast floor:\n${failures.map((f) => `  "${f.text}" ${f.ratio}:1 (needs ${f.floor}, ${f.size})`).join('\n')}`,
      ).toHaveLength(0)
    })
  }

  /**
   * The focus indicator, measured rather than assumed present.
   *
   * This product shipped a focus ring at 2.08:1 for as long as nobody computed
   * it, and a suppressed outline on two inputs the week after. Both were found
   * by hand. This finds them automatically.
   */
  test('every focusable control has a visible focus indicator', async ({ page }) => {
    await useTheme(page, 'vermilion')
    const bad = await page.evaluate(() => {
      const out: { label: string; outline: string }[] = []
      const focusable = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea')]
      for (const el of focusable.slice(0, 60)) {
        el.focus()
        const c = getComputedStyle(el)
        const hasOutline = c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0
        const hasShadow = c.boxShadow !== 'none'
        if (!hasOutline && !hasShadow) {
          out.push({
            label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 28),
            outline: `${c.outlineStyle} ${c.outlineWidth}`,
          })
        }
      }
      return out
    })
    expect(
      bad,
      `controls with no visible focus indicator:\n${bad.map((b) => `  ${b.label} (outline: ${b.outline})`).join('\n')}`,
    ).toHaveLength(0)
  })

  /** Axe, per identity and appearance. Serious and critical only, as a wall. */
  for (const identity of IDENTITIES) {
    for (const appearance of APPEARANCES) {
      test(`${identity}/${appearance}: no serious or critical axe violations`, async ({ page }) => {
        await useTheme(page, identity, appearance)
        const results = await new AxeBuilder({ page }).analyze()
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        expect(
          bad,
          `axe violations:\n${bad.map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`).join('\n')}`,
        ).toHaveLength(0)
      })
    }
  }

  /** The document must not scroll sideways at phone width. */
  test('no horizontal overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await useTheme(page, 'vermilion')
    const overflow = await page.evaluate(() => {
      const de = document.documentElement
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth }
    })
    expect(
      overflow.scrollWidth,
      `the document is ${overflow.scrollWidth - overflow.clientWidth}px wider than the viewport`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1)
  })
})
