import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Accessibility gate.
 *
 * Runs @axe-core for every (appearance x visual pack) pair on the same
 * fixture the visual gate uses — because contrast failures here are
 * pack-specific, and the real HelloGitty defects were in the pack
 * tokens (--pack-* rules that sit on --panel, --head and the ornament
 * tokens), not in the shared chrome. A single run at the default
 * appearance would have missed the azure-oni-v2 AMOLED `--rule`
 * sitting at 1.84:1 under #000.
 *
 * SCOPE AND INTENT. This is REPORTING, not auto-remediation. We collect
 * every axe violation grouped by (rule, pack+appearance), dump the full
 * JSON so a reviewer can inspect every node, and fail the test when
 * anything is found. No rule is silently excluded — an exclusion list
 * is the first place a gate goes stale. If a known false positive
 * appears, raise it as a project decision rather than quietly muting
 * it here.
 *
 * TAGS. We run `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa`. This
 * matches the contrast promises every pack's token documentation
 * makes ("≥4.5:1 normal text, ≥3:1 non-text"). `best-practice` is
 * deliberately left off: it flags opinions as violations, and the
 * contract this is verifying is WCAG, not axe-core's style guide.
 *
 * ONE PROJECT. Runs under `desktop-1400` only; accessibility is not
 * viewport-specific here (nothing reflows to hide content). If a future
 * narrow-breakpoint change lands, add `test.skip(testInfo.project.name
 * !== "desktop-1400" && testInfo.project.name !== "mobile-390")` and a
 * mobile-390 pass.
 */

const APPEARANCES = ["dark", "light", "amoled"] as const;

async function packsFromApp(page: Page): Promise<string[]> {
  const html = await page.content();
  const m = html.match(/var VISUAL_THEMES\s*=\s*\{([\s\S]*?)\};/);
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
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
}

/**
 * One row per (pack, appearance, rule). Flattened so it survives a JSON
 * dump intact; grouping is for the terminal report, not the data.
 */
interface Finding {
  pack: string;
  appearance: string;
  rule: string;
  impact: string;
  help: string;
  helpUrl: string;
  nodeCount: number;
  sampleTargets: string[];
  sampleFailureSummary: string;
}

test.describe("accessibility", () => {
  // 18 axe runs × ~2s each + page setup. Default 30s is too tight.
  test.setTimeout(180_000);

  test("every appearance and pack passes axe-core", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1400", "axe runs once, at 1400");

    await makeDeterministic(page);
    await page.goto(process.env.HG_BASE_URL ? "/" : "/dashboard.html", {
      waitUntil: "networkidle",
    });

    const packs = await packsFromApp(page);
    expect(packs.length, "no visual packs in the running app — gate would pass vacuously").toBeGreaterThan(1);

    const findings: Finding[] = [];

    for (const appearance of APPEARANCES) {
      for (const pack of packs) {
        await applyTheme(page, appearance, pack);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();

        for (const v of results.violations) {
          findings.push({
            pack: pack || "default",
            appearance,
            rule: v.id,
            impact: v.impact ?? "unknown",
            help: v.help,
            helpUrl: v.helpUrl,
            nodeCount: v.nodes.length,
            sampleTargets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
            sampleFailureSummary: v.nodes[0]?.failureSummary ?? "",
          });
        }
      }
    }

    // Write the full report to the test-results dir so a reviewer has every
    // node, not just the three samples kept per finding above. The console
    // summary is a navigator; the file is the source of truth.
    const reportPath = path.join(testInfo.project.outputDir, "axe-report.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(findings, null, 2));

    // Console grouping. By rule first (because a rule is a defect class
    // regardless of pack), then by pack within. Reviewers look at this
    // before opening the JSON.
    if (findings.length > 0) {
      const byRule = new Map<string, Finding[]>();
      for (const f of findings) {
        const arr = byRule.get(f.rule) ?? [];
        arr.push(f);
        byRule.set(f.rule, arr);
      }
      const lines: string[] = ["", `axe violations: ${findings.length} (grouped by rule)`];
      for (const [rule, fs2] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
        lines.push(`  [${fs2[0].impact}] ${rule} — ${fs2[0].help}  (${fs2[0].helpUrl})`);
        for (const f of fs2) {
          lines.push(
            `    ${f.pack}/${f.appearance}: ${f.nodeCount} node${f.nodeCount === 1 ? "" : "s"}` +
              (f.sampleTargets.length ? ` — ${f.sampleTargets.join(" | ")}` : ""),
          );
        }
      }
      lines.push("", `full JSON: ${reportPath}`);
      console.log(lines.join("\n"));
    }

    expect(
      findings,
      `axe found ${findings.length} violation(s); see ${reportPath}`,
    ).toHaveLength(0);
  });
});
