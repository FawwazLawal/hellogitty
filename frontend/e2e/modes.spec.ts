import { test, expect, type Page } from "@playwright/test";

/**
 * Media-mode visual gate — prefers-reduced-motion and forced-colors.
 *
 * Why these two and not every media feature: both are low-friction for a
 * user to set, both override the pack's own CSS, and both have already
 * been (or nearly been) sources of real shipped defects.
 *
 *   forced-colors: active
 *     We shipped a focus ring built from box-shadow. forced-colors paints
 *     a system-foreground solid everywhere and does NOT paint box-shadows
 *     at all, so keyboard focus vanished entirely. A capture would have
 *     caught it. It stays caught here.
 *
 *   prefers-reduced-motion: reduce
 *     Several packs add motion to ornament (lantern flicker, bauble
 *     rotation, grain shimmer). A pack that honours the setting looks
 *     the same before and after; a pack that does not keeps animating.
 *     The capture is the first frame after `animations: "disabled"` has
 *     been applied, so a correctly reduced pack diffs clean and an
 *     unreduced one shows the mid-animation art the ornament wanted to
 *     start with — which itself is the signal.
 *
 * SCOPE. Dark appearance only, every pack. Under forced-colors the
 * appearance is largely moot (system colours override the theme);
 * under reduced-motion appearance has no effect on whether an animation
 * is active. Running the full 3×6 matrix here would triple the PNG
 * weight for no additional defect class.
 *
 * At desktop-1400 only — media-mode defects do not reflow.
 */

const PACKS_RE = /var VISUAL_THEMES\s*=\s*\{([\s\S]*?)\};/;

async function packsFromApp(page: Page): Promise<string[]> {
  const html = await page.content();
  const m = html.match(PACKS_RE);
  if (!m) return [""];
  const ids = [...m[1].matchAll(/(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\{/g)].map(
    (x) => x[1] ?? x[2],
  );
  return ["", ...ids];
}

async function makeDeterministic(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-06T12:00:00Z"));
  await page.addInitScript(() => {
    const noop = () => 0 as unknown as number;
    window.setInterval = noop as typeof window.setInterval;
    try {
      Object.defineProperty(window.location, "reload", { value: () => {}, writable: false });
    } catch {
      /* fine */
    }
  });
}

async function applyPack(page: Page, pack: string) {
  await page.evaluate((p) => {
    const root = document.documentElement;
    root.dataset.theme = "dark";
    if (p) root.dataset.visualTheme = p;
    else delete root.dataset.visualTheme;
  }, pack);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
}

function volatileRegions(page: Page) {
  return [
    page.locator(".statrail .stat-fig"),
    page.locator(".hclock"),
    page.locator("[data-rail='api']"),
  ];
}

test.describe("media-mode baselines", () => {
  test("every pack under prefers-reduced-motion and forced-colors", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1400", "media-mode captures run at 1400 only");

    await makeDeterministic(page);
    await page.goto(process.env.HG_BASE_URL ? "/" : "/dashboard.html", {
      waitUntil: "networkidle",
    });

    const packs = await packsFromApp(page);
    expect(packs.length).toBeGreaterThan(1);

    const failures: string[] = [];

    for (const mode of ["reduced-motion", "forced-colors"] as const) {
      if (mode === "reduced-motion") {
        await page.emulateMedia({ reducedMotion: "reduce" });
      } else {
        await page.emulateMedia({ forcedColors: "active" });
      }

      for (const pack of packs) {
        await applyPack(page, pack);
        const name = `dashboard-${mode}-${pack || "default"}.png`;
        try {
          await expect(page).toHaveScreenshot(name, {
            fullPage: false,
            mask: volatileRegions(page),
            maskColor: "#ff00ff",
          });
        } catch (e) {
          failures.push(`${mode}/${pack || "default"}: ${(e as Error).message.split("\n")[0]}`);
        }
      }

      // Reset for the next iteration so the two media features don't stack.
      await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
    }

    expect(failures, `media-mode regressions:\n  ${failures.join("\n  ")}`).toHaveLength(0);
  });
});
