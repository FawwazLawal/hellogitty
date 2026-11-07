import { test, expect, type Page } from '@playwright/test'

/**
 * The dead-controls gate.
 *
 * This exists because the audit that preceded it found fifteen interactive
 * elements across six React pages that looked alive and did nothing: four
 * Masthead buttons with no handlers, four KPI tiles whose href was a fragment
 * no element matched, a "Show all" button that stayed where it was when
 * clicked, a panel toolbar whose inputs and Track button had no handlers, a
 * link whose text said "templated settings page" and whose href pointed at
 * the templated dashboard. None of those were caught by axe, by the contrast
 * sweep or by any previous gate. Reading the JSX didn't catch them either —
 * `<button>` without `onClick` looks like a button, and `href="#needs"` looks
 * like a link.
 *
 * WHAT CATCHES THEM. This walks every converted React page, enumerates every
 * interactive element in the live DOM, and reads the React fiber props off
 * each node to see which synthetic listeners React actually attached. That is
 * the measurement that matches reality — a JSX static read cannot see which
 * handlers were conditionally passed, and `getEventListeners` sees nothing
 * because React does not attach per-node listeners.
 *
 * THE MECHANICAL RULES, each catches a specific earlier regression:
 *
 *   1. No `<a>` with a missing, empty or "#"-only `href` — "Open the full
 *      Conversations page" shipped with `href="#conversations"` and a fragment
 *      target that did not exist.
 *   2. No `<a>` whose `href` starts with `#` unless the referenced id exists —
 *      the four KPI tiles shipped with `href="#needs"` / `"#prs"` /
 *      `"#repos"` / `"#api"` and no matching ids anywhere in the document.
 *   3. No `<button>` without an `onClick`, unless it is `type="submit"` inside
 *      a `<form onSubmit>` — eight panel buttons shipped with no handler;
 *      the submit exception is what keeps the Issues page's Search button
 *      from being flagged, since its listener is on the form.
 *   4. No `role="button"` or `role="link"` without a handler — the
 *      Conversations "Unread" overview card from the templated days was
 *      `role="button"` with no filter behind it; this is where that would
 *      surface if it comes back.
 *   5. No text input or search input with no `onChange` — the dashboard
 *      TrackedRepos panel shipped a search field that filtered nothing and
 *      an add-a-repo field that updated no state.
 *
 * SAME-INSTANT STATE READ. All the measurement runs inside `page.evaluate`,
 * so the state and the DOM come from one tick. A pair that fetched the
 * server document and then looked at the page would race the app's own
 * refetch, and a correct component painting late would look identical to a
 * broken one. Everything that follows avoids that trap by never leaving the
 * page for data mid-check.
 *
 * SCOPE. Every page the React app actually serves on this build. If a Go-
 * templated page is converted later, add it to `REACT_PAGES` and the gate
 * covers it; the walker has no page-specific knowledge.
 */

/**
 * Which paths the React shell owns today. Grow this when a new page lands.
 *
 * The /alerts/* list is taken from `alertsReactPaths` in
 * internal/dashboard/alerts_api.go — the Go server's source of truth for
 * which alert routes serve the React shell. A new alert route added there
 * should be added here too, so the gate covers it.
 */
const REACT_PAGES = [
  '/',
  '/work',
  '/pipeline',
  '/settings',
  '/issues',
  '/repos',
  '/your-repos',
  '/conversations',
  '/help',
  '/feed',
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
 * The shape we extract from each candidate. Keep it a plain object so it
 * crosses the `evaluate` boundary cleanly — functions do not.
 */
interface Candidate {
  tag: string
  text: string
  href: string | null
  role: string | null
  type: string | null
  ariaLabel: string | null
  disabled: boolean
  inForm: boolean
  formHasOnSubmit: boolean
  handlers: string[]
}

async function candidatesOn(page: Page): Promise<Candidate[]> {
  return page.evaluate(() => {
    function reactProps(el: Element): Record<string, unknown> | null {
      // Fiber key contains a random suffix across React builds; match the prefix.
      for (const k of Object.keys(el)) {
        if (k.startsWith('__reactProps$')) return (el as unknown as Record<string, Record<string, unknown>>)[k]
      }
      return null
    }
    const handlers = (el: Element): string[] => {
      const p = reactProps(el) ?? {}
      const out: string[] = []
      for (const k of Object.keys(p)) {
        if (k.startsWith('on') && typeof p[k] === 'function') out.push(k)
      }
      return out
    }
    const asCandidate = (el: Element): Candidate => {
      const form = el.closest('form')
      const formProps = form ? reactProps(form) ?? {} : {}
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
        href: el.getAttribute('href'),
        role: el.getAttribute('role'),
        type: (el as HTMLInputElement | HTMLButtonElement).getAttribute?.('type') ?? null,
        ariaLabel: el.getAttribute('aria-label'),
        disabled: (el as HTMLButtonElement | HTMLInputElement).disabled ?? false,
        inForm: form !== null,
        formHasOnSubmit: typeof formProps['onSubmit'] === 'function',
        handlers: handlers(el),
      }
    }
    const nodes = new Set<Element>()
    for (const sel of ['a', 'button', 'input', 'textarea', 'select', '[role="button"]', '[role="link"]']) {
      for (const el of document.querySelectorAll(sel)) nodes.add(el)
    }
    return [...nodes].map(asCandidate)
  })
}

/**
 * Describe a candidate in a form a reviewer can act on — tag, text, key
 * attribute, role — rather than just "button at index 7".
 */
function describe(c: Candidate): string {
  const bits: string[] = [c.tag]
  if (c.href !== null) bits.push(`href="${c.href}"`)
  if (c.role) bits.push(`role="${c.role}"`)
  if (c.type) bits.push(`type="${c.type}"`)
  if (c.ariaLabel) bits.push(`aria-label="${c.ariaLabel}"`)
  const label = c.text || c.ariaLabel || '(empty)'
  return `<${bits.join(' ')}> "${label}"`
}

/**
 * Which "#…" fragment ids are present on the page. Measured in the same tick
 * as the candidates so a late-painted section does not look missing.
 */
async function fragmentIds(page: Page): Promise<Set<string>> {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[id]')].map((e) => (e as HTMLElement).id),
  )
  return new Set(ids)
}

test.describe('dead controls', () => {
  for (const path of REACT_PAGES) {
    test(`${path}: no anchor has a missing, empty or lone "#" href`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' })
      const list = await candidatesOn(page)
      const bad = list.filter(
        (c) => c.tag === 'a' && (c.href === null || c.href === '' || c.href === '#'),
      )
      expect(
        bad,
        `anchors with no destination on ${path}:\n${bad.map(describe).join('\n')}`,
      ).toHaveLength(0)
    })

    test(`${path}: fragment-href anchors point at an element that exists`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' })
      const list = await candidatesOn(page)
      const ids = await fragmentIds(page)
      const bad = list.filter((c) => {
        if (c.tag !== 'a') return false
        if (!c.href || !c.href.startsWith('#')) return false
        return !ids.has(c.href.slice(1))
      })
      expect(
        bad,
        `anchors to fragments that do not exist on ${path}:\n${bad.map(describe).join('\n')}`,
      ).toHaveLength(0)
    })

    test(`${path}: every <button> has a handler (submit-in-form excepted)`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' })
      const list = await candidatesOn(page)
      const bad = list.filter((c) => {
        if (c.tag !== 'button') return false
        if (c.disabled) return false
        if (c.handlers.length > 0) return false
        // The legitimate exception: a <button type="submit"> inside a
        // <form onSubmit={...}> is wired through the form, not the button.
        if (c.type === 'submit' && c.inForm && c.formHasOnSubmit) return false
        return true
      })
      expect(
        bad,
        `buttons with no handler on ${path}:\n${bad.map(describe).join('\n')}`,
      ).toHaveLength(0)
    })

    test(`${path}: every role="button" / role="link" has a handler`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' })
      const list = await candidatesOn(page)
      const bad = list.filter(
        (c) => (c.role === 'button' || c.role === 'link') && c.handlers.length === 0 && !c.disabled,
      )
      expect(
        bad,
        `role-styled elements with no handler on ${path}:\n${bad.map(describe).join('\n')}`,
      ).toHaveLength(0)
    })

    test(`${path}: every text or search input has an onChange`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' })
      const list = await candidatesOn(page)
      const bad = list.filter((c) => {
        if (c.tag !== 'input') return false
        if (c.disabled) return false
        const t = c.type ?? 'text'
        if (!['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(t)) return false
        return !c.handlers.includes('onChange')
      })
      expect(
        bad,
        `inputs with no onChange on ${path}:\n${bad.map(describe).join('\n')}`,
      ).toHaveLength(0)
    })
  }

  /**
   * Every internal anchor href across every React page should resolve to
   * something — not just be non-empty.
   *
   * This catches the specific failure mode a sibling review spotted while
   * sampling the KpiRail work: `/list?prs=open` serves 200, `/list?prs=merged`
   * serves 200, but bare `/list` is a 404. A future edit that drops the query
   * parameter produces a link that looks fine to every earlier check (it is
   * not empty, it is not a fragment, it has a handler) and lands nowhere. The
   * audit exists to catch controls that look alive and are not; a link that
   * resolves to 404 is the same failure in a different shape.
   *
   * Dedupe first, GET once per unique href. That is ~20 requests against a
   * localhost binary and finishes in the same couple of seconds as the per-
   * page tests, so the simple version is also the cheap version.
   *
   * External links (github.com, etc.) are left alone — chasing them hits the
   * network, which this suite explicitly refuses to do. Fragment-only hrefs
   * are left alone — they have their own dedicated check above.
   */
  test('every internal anchor href across every React page resolves', async ({ page, request }) => {
    // One-off longer budget because this test visits every page once. The
    // per-page tests above use networkidle; this one uses `load` because an
    // anchor href is in the HTML as soon as React paints, and waiting for
    // every poll to settle on every page would multiply the whole suite's
    // running time for a check that reads static markup.
    test.setTimeout(120_000)
    const seen = new Map<string, Set<string>>()
    for (const path of REACT_PAGES) {
      await page.goto(path, { waitUntil: 'load' })
      // Give React one tick to paint the nav tree after the shell mounts.
      await page.waitForSelector('nav[aria-label="Primary"]', { timeout: 10_000 })
      const hrefs: string[] = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => a.getAttribute('href') ?? ''),
      )
      for (const h of hrefs) {
        if (!h || !h.startsWith('/')) continue
        // A protocol-relative URL also starts with `/` but as `//host/path`.
        // Skip those as external.
        if (h.startsWith('//')) continue
        if (!seen.has(h)) seen.set(h, new Set())
        seen.get(h)!.add(path)
      }
    }
    const bad: string[] = []
    for (const [href, sources] of seen) {
      const res = await request.get(href, { maxRedirects: 0 })
      // Any 2xx or redirect (3xx) is a resolve; 4xx/5xx is the failure shape
      // this check exists to catch.
      if (res.status() >= 400) {
        bad.push(`${href} → HTTP ${res.status()} (linked from: ${[...sources].join(', ')})`)
      }
    }
    expect(
      bad,
      `internal anchor hrefs that do not resolve:\n${bad.join('\n')}`,
    ).toHaveLength(0)
  })

  /**
   * The settings page claims a "templated settings page" link. The original
   * shipped as `href="/legacy"`, which served the templated DASHBOARD. This
   * is the one semantic check that cannot be generic — only this page knows
   * what word maps to what URL.
   */
  test('/settings: the "templated settings page" link points at /legacy/settings', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const list = await candidatesOn(page)
    const link = list.find((c) => c.tag === 'a' && c.text.includes('templated settings page'))
    expect(link, 'the settings page should link to the templated settings page').toBeDefined()
    expect(link?.href, 'the "templated settings page" link should point at /legacy/settings').toBe('/legacy/settings')
  })
})
