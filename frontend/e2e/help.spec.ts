import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expectNoHorizontalOverflow } from './overflow'

/**
 * The /help page's gate.
 *
 * Help is mostly server-rendered Markdown with two live sections —
 * glossary and about — so the tests cover: the HTML lands, the search
 * finds across sections and glossary, unknown About rows render an
 * em-dash rather than the server's placeholder string, and the AI
 * prompt is actually copyable. Plus axe and 390px overflow.
 *
 * MOCKING. `/app/api/help.json` is served by `page.route` so the test
 * controls the shape; other shell endpoints answer minimally.
 */

async function withHelp(page: Page, body: unknown) {
  await page.route('**/app/api/help.json', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  )
}

async function withShellDocs(page: Page) {
  await page.route('**/app/api/dashboard.json', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '', version: 'test',
        kpis: [
          { id: 'needs', value: 0, label: 'Needs you', sublabel: '', known: false },
          { id: 'prs', value: 0, label: 'Open PRs', sublabel: '', known: false },
          { id: 'repos', value: 0, label: 'Repos', sublabel: '', known: true },
          { id: 'api', value: 0, label: 'API left', sublabel: '', known: false },
        ],
        repos: [], stageHeads: [],
        repoTotals: { newCount: 0, repoCount: 0 },
        pipeline: { counts: [], opened: 0, open: 0, merged: 0, closed: 0, rate: '', known: false },
        work: { known: false, partial: false, login: '', needYou: 0, total: 0, items: [] },
        conversations: { known: false, quiet: 0, needYou: 0, total: 0 },
      }),
    }),
  )
  await page.route('**/app/api/session.json', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'test-token', writable: true }),
    }),
  )
}

function helpDoc(overrides: Record<string, unknown> = {}) {
  return {
    title: 'HelloGitty help',
    intro: '<p>Help intro text here.</p>',
    introText: 'hellogitty help',
    sections: [
      {
        id: 'getting-started',
        title: 'Getting started',
        text: 'add a repo to start tracking it',
        html: '<p>Add a repository to start tracking it.</p>',
      },
      {
        id: 'troubleshooting',
        title: 'Troubleshooting',
        text: 'if something fails, check the server log',
        html: '<p>If something fails, check the server log.</p>',
      },
    ],
    glossary: [
      {
        id: 'repo-dormant',
        label: 'Dormant',
        kind: 'Health light',
        means: 'No commits recently',
        do: 'Investigate or archive',
        search: 'dormant health light no commits recently',
      },
    ],
    about: [
      { key: 'Version', value: 'v0.2.0', known: true },
      { key: 'Last check', value: 'Not checked yet', known: false },
      { key: 'GitHub API this hour', value: 'Not reported yet', known: false },
      { key: 'Notifications', value: 'Readable: new-activity dots are on', known: true },
      {
        key: 'Install and settings',
        value: 'README on GitHub',
        url: 'https://github.com/x/y#readme',
        known: true,
      },
    ],
    aiPrompt: 'You are helping maintain a HelloGitty install at /install. [TASK]',
    ...overrides,
  }
}

test.describe('help page', () => {
  test.skip(
    !process.env.HG_BASE_URL,
    'help.spec needs the Go binary running under HG_BASE_URL — the static fixture does not serve /help.',
  )

  test('renders title, intro, sections and TOC', async ({ page }) => {
    await withShellDocs(page)
    await withHelp(page, helpDoc())
    await page.goto('/help', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: 'HelloGitty help', level: 2 })).toBeVisible()
    await expect(page.getByText('Help intro text here.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Getting started', level: 2 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Troubleshooting', level: 2 })).toBeVisible()
    // The TOC has deep-links.
    await expect(page.getByRole('link', { name: 'Troubleshooting' })).toBeVisible()
  })

  // UNKNOWN IS NOT A STATUS. A row that hasn't been learned renders an
  // em-dash, never the server's "Not checked yet" placeholder as if it
  // were a real value. Two separate codepaths hit this: Last check and
  // GitHub API this hour, both known: false in the fixture.
  test('About: unknown rows render em-dashes, not placeholder strings', async ({ page }) => {
    await withShellDocs(page)
    await withHelp(page, helpDoc())
    await page.goto('/help', { waitUntil: 'networkidle' })

    // The two per-row testids make the assertion specific.
    await expect(page.getByTestId('about-unknown-last-check')).toHaveText('—')
    await expect(page.getByTestId('about-unknown-github-api-this-hour')).toHaveText('—')
    // And neither placeholder is rendered as a real value. The literal
    // strings sit in the row's title column server-side, but the dd
    // column must not carry them.
    const dds = page.locator('#about dd')
    await expect(dds.filter({ hasText: 'Not checked yet' })).toHaveCount(0)
    await expect(dds.filter({ hasText: 'Not reported yet' })).toHaveCount(0)
    // Known rows do carry their real values.
    await expect(dds.filter({ hasText: 'v0.2.0' })).toHaveCount(1)
    await expect(dds.filter({ hasText: /Readable: new-activity dots are on/ })).toHaveCount(1)
  })

  test('search finds across sections and glossary', async ({ page }) => {
    await withShellDocs(page)
    await withHelp(page, helpDoc())
    await page.goto('/help', { waitUntil: 'networkidle' })

    const search = page.getByPlaceholder('Ask or search, e.g. how to add a repo')
    await search.fill('troubleshoot')
    const results = page.getByRole('region', { name: 'Search results' })
    await expect(results).toBeVisible()
    await expect(results.getByText('Troubleshooting').first()).toBeVisible()

    await search.fill('dormant')
    // The glossary row links to #term-… and reads as "Health light Dormant".
    await expect(results.getByRole('link', { name: 'Health light Dormant' })).toBeVisible()

    await search.fill('nonexistent-string-xyz')
    await expect(page.getByText(/Nothing matches/)).toBeVisible()
  })

  test('AI prompt: renders content and the Copy button', async ({ page }) => {
    await withShellDocs(page)
    await withHelp(page, helpDoc())
    await page.goto('/help', { waitUntil: 'networkidle' })

    const prompt = page.locator('#ai-prompt')
    await expect(prompt).toContainText('You are helping maintain a HelloGitty install')
    await expect(page.getByRole('button', { name: /Copy prompt/ })).toBeVisible()
  })

  test('axe reports no serious or critical violations', async ({ page }) => {
    await withShellDocs(page)
    await withHelp(page, helpDoc())
    await page.goto('/help', { waitUntil: 'networkidle' })

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      bad,
      `/help has serious/critical axe violations:\n  ${bad.map((v) => `[${v.impact}] ${v.id} — ${v.help}`).join('\n  ')}`,
    ).toHaveLength(0)
  })

  test('no horizontal overflow at 390px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'overflow check runs under mobile-390')
    await withShellDocs(page)
    await withHelp(
      page,
      helpDoc({
        aiPrompt:
          'A prompt that happens to contain a line\nwithout spaces that is longer than a phone viewport would normally be comfortable with but must still not overflow',
      }),
    )
    await page.goto('/help', { waitUntil: 'networkidle' })
    await expectNoHorizontalOverflow(page, 390)
  })
})
