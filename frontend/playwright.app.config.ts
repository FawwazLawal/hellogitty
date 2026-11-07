import { defineConfig, devices } from '@playwright/test'

/**
 * The gate for the React app, run against the GO BINARY rather than the dev
 * server.
 *
 * That choice is the point of this config. Vite's dev server transforms modules
 * on the fly, serves unminified source and injects its own client; the binary
 * serves a built, minified bundle through the SPA fallback and the caching
 * rules in serveApp. Those are different programs, and the defects that matter
 * at this phase — a wrong base path, an asset 404, a fallback that does not
 * fire — exist only in the second one.
 *
 * It expects a binary already serving on 7342. Build and start it with:
 *   cd frontend && pnpm build
 *   go build -o /tmp/hg-app ./cmd/hellogitty
 *   /tmp/hg-app -config <your config>
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['app.spec.ts', 'budget.spec.ts', 'conversations.spec.ts', 'settings-clock.spec.ts'],
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.HG_APP_URL ?? 'http://127.0.0.1:7342',
    deviceScaleFactor: 1,
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
