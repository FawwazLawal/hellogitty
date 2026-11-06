import { defineConfig, devices } from "@playwright/test";

/**
 * Visual gate for HelloGitty.
 *
 * This exists because every visual failure in the Azure Oni work was a
 * feedback-loop failure, not a framework one: art was authored by something
 * that could not see its own output, and three consecutive "fixes" were each
 * reasoned correctly and wrong on screen. A screenshot that fails loudly is
 * the cheapest possible fix for that, and it is deliberately wired to the
 * EXISTING Go-rendered app rather than to the React prototype, so it earns its
 * keep before any migration lands.
 *
 * WHY A FIXTURE AND NOT THE LIVE APP. The first version of this gate pointed
 * at a running HelloGitty and failed on every capture — not because anything
 * looked wrong, but because the board's data moves: counts, relative
 * timestamps, feed rows and rate-limit headroom all change between two runs
 * minutes apart. A gate that fails when nothing is broken gets switched off
 * within a week, so masking more and more of the page was the wrong answer;
 * most of the page is data.
 *
 * The split is instead: the Go side already has 186 tests covering what markup
 * gets produced, and this suite covers how that markup LOOKS. So it renders a
 * captured page fixture — real markup, frozen content — which makes every
 * difference attributable to CSS, art or layout, which is exactly what the
 * Azure Oni failures were.
 *
 * Re-capture the fixture with `pnpm fixture:update` when the markup changes.
 * Set HG_BASE_URL to point at a live instance for authoring; the gate itself
 * should stay on the fixture. There is deliberately no default that resolves
 * to :7340, which is the owner's own dashboard.
 */
const useLive = !!process.env.HG_BASE_URL;
const baseURL = process.env.HG_BASE_URL ?? "http://127.0.0.1:7399";

export default defineConfig({
  testDir: "./e2e",
  // Visual comparison is meaningless when two workers race the same server.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],

  expect: {
    toHaveScreenshot: {
      // TIGHT ON PURPOSE, and these numbers were derived by experiment rather
      // than taste. The first attempt used maxDiffPixelRatio 0.002 with
      // threshold 0.15 — defensible-sounding values that made the suite USELESS:
      // re-introducing the real z-index bug, where a 5%-alpha decorative layer
      // paints over the dashboard, flagged zero of eighteen captures. A low
      // alpha overlay moves each pixel less than 0.15, so no pixel counted as
      // changed and the gate reported green on a genuine regression.
      //
      // Because this runs against a static fixture at a fixed viewport and DPR
      // on one machine, rendering is deterministic and there is almost no noise
      // to absorb: an unchanged run diffs zero pixels. So the tolerance can be
      // near zero, and it has to be, because the failures worth catching here
      // are subtle by nature — a texture that is absent rather than quiet, a
      // haze sitting one layer too high.
      maxDiffPixelRatio: 0.0002,
      threshold: 0.02,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },

  use: {
    baseURL,
    // Fixed DPR and viewport: a screenshot gate that moves with the window is
    // not a gate. Overridden per-project below for the responsive captures.
    deviceScaleFactor: 1,
    colorScheme: "dark",
    // Offline-first product: a test that reaches the network is testing the
    // network. Any external request is a failure worth seeing.
    bypassCSP: false,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  // Serves the captured fixture. python3 is already a hard dependency of this
  // repo's tooling, so this adds nothing to install.
  webServer: useLive
    ? undefined
    : {
        command: "python3 -m http.server 7399 --bind 127.0.0.1 --directory e2e/fixture",
        url: "http://127.0.0.1:7399/dashboard.html",
        reuseExistingServer: !process.env.CI,
        stdout: "ignore",
      },

  projects: [
    {
      name: "desktop-1400",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 },
    },
    {
      name: "desktop-1280",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "laptop-1024",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 800 }, deviceScaleFactor: 1 },
    },
    {
      name: "mobile-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
    },
  ],
});
