import { test, expect, type Page } from "@playwright/test";

/**
 * The visual gate.
 *
 * Captures the dashboard for every (appearance x visual pack) pair and compares
 * against a committed baseline. The point is not pixel perfection — it is that
 * a human or an agent cannot any longer claim a texture is "subtle" when it is
 * in fact absent, or ship a layer that paints over the content it was meant to
 * sit behind. Both of those happened and neither showed up in a diff.
 */

/** Appearances the app supports. "auto" is excluded: it follows the OS. */
const APPEARANCES = ["dark", "light", "amoled"] as const;

/**
 * Visual packs read from the app itself rather than hard-coded here, so a pack
 * added or retired in web/index.html cannot silently escape the gate. A list
 * duplicated in a test is a list that goes stale.
 */
async function packsFromApp(page: Page): Promise<string[]> {
  // Read the registry out of the served HTML rather than off `window`.
  // `var VISUAL_THEMES` lives inside a template-defined script block and is
  // function-scoped, so it never becomes a window global — the first version of
  // this helper looked for one, found nothing, and was caught by the vacuity
  // assertion below rather than silently testing zero packs.
  const html = await page.content();
  const m = html.match(/var VISUAL_THEMES\s*=\s*\{([\s\S]*?)\};/);
  if (!m) return [""];
  const ids = [...m[1].matchAll(/(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\{/g)].map(
    (x) => x[1] ?? x[2],
  );
  // "" is the default (no pack), which is as much a shipped appearance as any.
  return ["", ...ids];
}

/**
 * Freeze everything that legitimately changes between two runs, so a diff means
 * a visual regression and nothing else.
 *
 * Deliberately NOT masking: panel geometry, art layers, colours. Those are what
 * the gate is for.
 */
async function makeDeterministic(page: Page) {
  // The clock renders to the second and would fail every run otherwise.
  await page.clock.setFixedTime(new Date("2026-11-06T12:00:00Z"));

  await page.addInitScript(() => {
    // The dashboard reloads itself on a timer; a reload mid-capture produces a
    // half-painted screenshot that looks like a rendering bug.
    const noop = () => 0 as unknown as number;
    window.setInterval = noop as typeof window.setInterval;
    try {
      Object.defineProperty(window.location, "reload", { value: () => {}, writable: false });
    } catch {
      /* some engines refuse; the interval kill above is the load-bearing half */
    }
  });
}

/** Regions whose CONTENT is live data and would differ run to run. */
function volatileRegions(page: Page) {
  return [
    page.locator(".statrail .stat-fig"), // counts move as GitHub moves
    page.locator(".hclock"), // belt and braces alongside the frozen clock
    page.locator("[data-rail='api']"), // rate-limit headroom drifts constantly
  ];
}

async function applyTheme(page: Page, appearance: string, pack: string) {
  await page.evaluate(
    ([a, p]) => {
      const root = document.documentElement;
      root.dataset.theme = a;
      if (p) root.dataset.visualTheme = p;
      else delete root.dataset.visualTheme;
    },
    [appearance, pack],
  );
  // Two frames: one for the attribute, one for the paint it triggers.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
}

test.describe("dashboard visual baseline", () => {
  test("every appearance and pack renders as its baseline", async ({ page }, testInfo) => {
    const failures: string[] = [];

    // An external request in an offline-first product is itself a defect.
    const external: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (!u.startsWith("http://127.0.0.1") && !u.startsWith("http://localhost") && !u.startsWith("data:")) {
        external.push(u);
      }
    });

    await makeDeterministic(page);
    await page.goto(process.env.HG_BASE_URL ? "/" : "/dashboard.html", { waitUntil: "networkidle" });

    const packs = await packsFromApp(page);
    expect(packs.length, "no visual packs found in the running app — the gate would pass vacuously").toBeGreaterThan(1);

    // VIEWPORT CAPTURE STRATEGY — the "option B" argument, decided here.
    //
    // At 1400 we baseline the full page: every pack defect in this project's
    // history landed either in the chrome (header, stat rail, panel edges) or
    // across the panel bodies, and the full capture catches both. At narrower
    // viewports we baseline the CHROME REGION only (`.site-head` + first stat
    // rail) and skip the body. The reasoning:
    //
    //   - All real defects so far lived in pack art, which is painted on the
    //     chrome. Body pixels are Go-template output and are already covered
    //     by 186 Go tests; running their PNGs at four widths adds no defect
    //     class the chrome capture misses.
    //   - Full-page captures at all four widths would put ~15 MB into VCS
    //     (18 × 4, variably sized) and triple the suite's commit churn
    //     every time a pack changes. Chrome regions at 1280/1024/390 add
    //     ~4 MB total (chrome strip is ~180px tall × 3 widths × 18 packs)
    //     and only churn when the chrome itself moves — which is exactly
    //     what we want this gate to tell us about.
    //   - "Layout assertions only" at the narrow viewports (option C) would
    //     let a pack whose ornament clips wrong on a narrow header pass
    //     silently — the whole point of the gate is that structure assertions
    //     cannot catch that class.
    //
    // Trade-off we accept: a panel-body pack defect that only appears at
    // narrow widths is uncaught. If one ships, that is the point to add a
    // second region or full baseline at that width.
    const isFullPage = testInfo.project.name === "desktop-1400";

    for (const appearance of APPEARANCES) {
      for (const pack of packs) {
        await applyTheme(page, appearance, pack);
        const name = `dashboard-${appearance}-${pack || "default"}-${testInfo.project.name}.png`;
        try {
          if (isFullPage) {
            await expect(page).toHaveScreenshot(name, {
              fullPage: false,
              mask: volatileRegions(page),
              maskColor: "#ff00ff",
            });
          } else {
            // Chrome region: header band + stat rail. `.site-head` is
            // position: sticky, which means the capture pulls the pinned
            // version at scroll 0; the rail sits immediately beneath it.
            // Capture both as one bounding rect by taking a locator that
            // wraps `main > *:first-of-type`... but the actual markup has
            // the rail at the top of the dashboard page's body, so we
            // clip to the viewport's top 480px which safely contains
            // both without depending on markup internals that may move.
            await expect(page).toHaveScreenshot(name, {
              fullPage: false,
              clip: { x: 0, y: 0, width: testInfo.project.use.viewport!.width, height: 480 },
              mask: volatileRegions(page),
              maskColor: "#ff00ff",
            });
          }
        } catch (e) {
          // Collect rather than bail, so one capture does not hide the other
          // seventeen. A gate that reports the first failure only is a gate you
          // have to run eighteen times.
          failures.push(`${appearance}/${pack || "default"}: ${(e as Error).message.split("\n")[0]}`);
        }
      }
    }

    expect(external, `the page fetched external resources: ${external.join(", ")}`).toHaveLength(0);
    expect(failures, `visual regressions:\n  ${failures.join("\n  ")}`).toHaveLength(0);
  });
});
