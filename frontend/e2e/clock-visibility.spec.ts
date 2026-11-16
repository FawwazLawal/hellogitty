import { test, expect } from '@playwright/test'

/**
 * The gate for #319: the masthead clock resyncs when a tab returns to visible.
 *
 * WHY THIS TEST EXISTS. `useLiveClock` ticks with `setInterval(1000)` inside
 * a `useEffect([])`. Chrome throttles that interval in hidden tabs — 1Hz for
 * a visible-but-unfocused one, as slow as one tick per minute under battery
 * or memory saver. On return to a visible tab, the clock would read the
 * time it last ticked until the next scheduled firing. A `visibilitychange`
 * listener closes the gap.
 *
 * WHAT WE CAN'T DO FROM A FIXTURE. We cannot make Chrome genuinely throttle
 * its own interval, nor make it skip ticks the way machine sleep would. So
 * the test substitutes a controlled stand-in: disable the interval's effect
 * by overriding `window.setInterval` BEFORE the app mounts, fake the clock
 * forward, dispatch a `visibilitychange`, and verify the masthead advanced.
 *
 * That isolation is the whole point: if the visibility listener were absent
 * (the sabotage case), a dropped interval would leave the clock exactly
 * where it was. The red-before-green proof is in the PR body.
 *
 * SCOPE. This is a correctness improvement, not a known fix for the frozen-
 * clock report on #307 — see #319's scoping. A green here means "the hook
 * now does the obvious thing," not "the owner's reported freeze is fixed."
 */

test.describe('/ — masthead clock resyncs on visibilitychange', () => {
  test('forces a tick when the tab returns to visible, without waiting for the interval', async ({ page }) => {
    // Neutralise `setInterval` BEFORE the app mounts, so the ONLY path that
    // can advance the clock is the visibility listener itself. Without this,
    // a passing test would prove nothing — the normal 1s interval could be
    // what did the work, and the sabotage pass (removing the listener)
    // would still appear green on a lucky timing.
    await page.addInitScript(() => {
      const real = window.setInterval.bind(window)
      // Keep setTimeout alive; only setInterval needs the no-op.
      window.setInterval = (() => 0) as typeof window.setInterval
      ;(window as unknown as { __realSetInterval: typeof setInterval }).__realSetInterval = real
    })

    await page.goto('/', { waitUntil: 'networkidle' })

    const clockText = () => page.locator('header .hg-clock-time').first().textContent()

    const t0 = await clockText()
    expect(t0, 'masthead clock should render on first paint').toBeTruthy()

    // Fake-advance the wall clock by five minutes. The interval is a no-op,
    // so without the visibility listener nothing will move.
    await page.evaluate(() => {
      const realDate = Date
      const base = Date.now() + 5 * 60 * 1000
      const FakeDate = class extends realDate {
        constructor(...args: ConstructorParameters<typeof Date>) {
          if (args.length === 0) super(base)
          else super(...(args as []))
        }
        static now() { return base }
      }
      window.Date = FakeDate as unknown as DateConstructor
    })

    // Dispatch the transition: hidden → visible. The real browser fires
    // this on tab return; we call it directly so we can assert on it.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // One animation frame is enough for the listener to fire setNow and
    // React to flush — polling guards against scheduling order anyway.
    await expect.poll(async () => await clockText(), { timeout: 2000 }).not.toBe(t0)

    const t1 = await clockText()
    expect(t1, 'clock should have advanced after visibilitychange').not.toBe(t0)
  })
})
