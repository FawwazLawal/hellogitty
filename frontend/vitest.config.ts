import { defineConfig } from 'vitest/config'

/**
 * Vitest owns the unit tests; Playwright owns `e2e/`.
 *
 * Without this, `vitest run` picks up e2e/*.spec.ts, tries to execute
 * Playwright's `test.describe()` outside a Playwright runner, and reports three
 * failed files. The product is fine; the runner is in the wrong place. That is
 * worth excluding rather than tolerating, because a suite that is red for a
 * reason which is not a defect is a suite people stop reading — the same
 * reasoning that made the accessibility gate a ratchet instead of a wall.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'jsdom',
    globals: true,
  },
})
