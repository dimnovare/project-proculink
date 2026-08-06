import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { CORE_SCREENS, EXPECTED_CORE_SCREEN_COUNT, checkCoreScreenRegistry } from "./coreScreens";
import { preparePage, settle, DEV_OVERLAY_SELECTORS } from "./a11yHarness";

/**
 * axe-core over the ten core screens, held by a ratchet.
 *
 * WHY A RATCHET AND NOT "ZERO VIOLATIONS". The first run against `main` found 9
 * violating nodes across the ten screens — 7 of them on one screen, and 7 of the
 * 9 are `color-contrast`. Seven of the ten screens are already clean. Zero is
 * therefore *nearly* available, and it is deliberately not asserted, for one
 * reason: the contrast failures resolve to values in the LOCKED design token set
 * (CLAUDE.md §3), which this packet is explicitly forbidden to change. Asserting
 * zero would mean either editing a locked token or suppressing the rule, and
 * both of those hide the finding instead of recording it. So the debt is written
 * down, in a file with names and numbers a founder can read, and it cannot grow.
 * Same shape as `scripts/check-tokens.mjs`, which already holds token debt on a
 * per-file ratchet in this repo. See the PR body for the traced token values.
 *
 * THE RATCHET IS TWO-SIDED, which is the part that keeps it honest:
 *   • a count ABOVE baseline fails      → you introduced a violation
 *   • a count BELOW baseline also fails → you fixed one; lower the number
 * A one-sided ratchet rots: the baseline drifts upward from reality until it
 * permits violations nobody ever introduced. Two-sided means the file always
 * states the true current count, so `git log` on it reads as the a11y history.
 *
 * WHAT THIS CANNOT CATCH, stated because an a11y gate that overclaims is worse
 * than none. Axe is an automated checker; it finds roughly a third of WCAG
 * failures. It cannot tell you a label is wrong, an order is illogical, or an
 * error message is unhelpful. And because the ratchet is per-rule COUNTS, a
 * commit that fixes one `color-contrast` node and breaks a different one on the
 * same screen nets to zero and passes. The fix for that is `--update-snapshots`
 * discipline plus review, not a cleverer number.
 */

const BASELINE_PATH = join(process.cwd(), "tests", "e2e", "a11y-baseline.json");

/**
 * WCAG 2.0/2.1 level A and AA. This is the conformance target, and it is the set
 * that contains `color-contrast` — the rule the packet's acceptance criterion
 * names. `best-practice` is deliberately excluded: it carries opinions (landmark
 * counts, heading-order preferences) that are not the standard, and mixing them
 * in makes a failure ambiguous about whether a legal requirement broke.
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

type ScreenBaseline = Record<string, number>;
type Baseline = Record<string, ScreenBaseline>;

const WRITE_BASELINE = process.env.A11Y_UPDATE_BASELINE === "1";

function readBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return {};
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

/**
 * Baseline writes accumulate across the ten parallel-capable tests in this file,
 * so each test merges into whatever is on disk rather than replacing it.
 * `workers: 1` is enforced for the update run (see package.json) so this is a
 * read-modify-write with no concurrent writer, not a race.
 */
function mergeBaseline(screenId: string, counts: ScreenBaseline): void {
  const current = readBaseline();
  current[screenId] = counts;
  const ordered: Baseline = {};
  for (const s of CORE_SCREENS) if (current[s.id]) ordered[s.id] = current[s.id];
  writeFileSync(BASELINE_PATH, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

interface ViolationNode {
  rule: string;
  impact: string;
  help: string;
  target: string;
  summary: string;
}

/** One line per failing NODE, not per rule — a rule with 6 nodes is 6 problems. */
function formatNodes(nodes: ViolationNode[]): string {
  return nodes
    .map(
      (n) =>
        `  [${n.impact ?? "n/a"}] ${n.rule} — ${n.help}\n` +
        `      at: ${n.target}\n` +
        `      ${n.summary.replace(/\n/g, "\n      ")}`,
    )
    .join("\n");
}

/**
 * The registry floor. Runs before the sweep, in its own test, so a broken
 * registry reports as "the registry is broken" and not as ten unrelated
 * navigation failures.
 */
test("the core-screen registry still describes real routes", () => {
  const problems = checkCoreScreenRegistry();
  expect(
    problems.map((p) => `${p.kind}: ${p.detail}`),
    "core-screen registry is not sound",
  ).toEqual([]);
  expect(CORE_SCREENS.length).toBe(EXPECTED_CORE_SCREEN_COUNT);
});

test.describe("axe-core — WCAG 2.1 A/AA over the core screens", () => {
  // Ten routes, several of them the heaviest in the app, each compiled on first
  // hit by `next dev`. Same reasoning as tap-targets.spec.ts: the clock is the
  // flake source, not the assertion.
  test.describe.configure({ timeout: 120_000 });

  for (const screen of CORE_SCREENS) {
    test(`${screen.path} (${screen.label})`, async ({ page }, testInfo) => {
      await preparePage(page);
      const response = await page.goto(screen.path);

      // A 404 renders an error boundary, and axe finds very little wrong with an
      // error boundary. Without this, a renamed route turns into a PASS.
      expect(
        response?.status(),
        `${screen.path} did not serve a page — a scan of an error page is not a scan of ${screen.id}`,
      ).toBeLessThan(400);

      await settle(page);

      // Anti-vacuity: axe on a blank body reports zero violations and looks green.
      const contentSize = await page.evaluate(() => ({
        text: document.body.innerText.trim().length,
        controls: document.querySelectorAll("button, a[href], input, select, textarea").length,
      }));
      expect(
        contentSize.text,
        `${screen.path} rendered almost no text (${contentSize.text} chars) — the scan would be vacuous`,
      ).toBeGreaterThan(200);
      expect(
        contentSize.controls,
        `${screen.path} rendered no interactive controls — did it load?`,
      ).toBeGreaterThan(0);

      let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
      for (const selector of DEV_OVERLAY_SELECTORS) builder = builder.exclude(selector);
      const results = await builder.analyze();

      const nodes: ViolationNode[] = results.violations.flatMap((v) =>
        v.nodes.map((n) => ({
          rule: v.id,
          impact: n.impact ?? v.impact ?? "n/a",
          help: v.help,
          target: n.target.join(" "),
          summary: n.failureSummary ?? "",
        })),
      );

      const counts: ScreenBaseline = {};
      for (const n of nodes) counts[n.rule] = (counts[n.rule] ?? 0) + 1;

      // Always attach the full report, pass or fail. A green run that is green
      // because of a large baseline is exactly the run somebody needs to read.
      const report =
        `${screen.path} — ${nodes.length} violating node(s) across ${Object.keys(counts).length} rule(s)\n\n` +
        (nodes.length ? formatNodes(nodes) : "  (none)");
      await testInfo.attach(`axe-${screen.id}.txt`, { body: report, contentType: "text/plain" });
      // `A11Y_REPORT=1 bun run test:e2e:a11y` prints the current debt to the
      // terminal. Reading it should not require downloading a CI artifact.
      if (process.env.A11Y_REPORT === "1" && nodes.length) console.log(`\n${report}\n`);

      if (WRITE_BASELINE) {
        mergeBaseline(screen.id, counts);
        test.info().annotations.push({
          type: "baseline-written",
          description: `${screen.id}: ${JSON.stringify(counts)}`,
        });
        return;
      }

      const baseline = readBaseline();
      const expected = baseline[screen.id];
      expect(
        expected,
        `No axe baseline recorded for "${screen.id}". Run: bun run test:e2e:a11y:update`,
      ).toBeDefined();

      const rules = new Set([...Object.keys(counts), ...Object.keys(expected ?? {})]);
      const regressions: string[] = [];
      const improvements: string[] = [];

      for (const rule of [...rules].sort()) {
        const now = counts[rule] ?? 0;
        const was = expected?.[rule] ?? 0;
        if (now > was) {
          const offending = nodes.filter((n) => n.rule === rule);
          regressions.push(
            `${rule}: ${was} → ${now} on ${screen.path}\n${formatNodes(offending)}`,
          );
        } else if (now < was) {
          improvements.push(`${rule}: ${was} → ${now} on ${screen.path}`);
        }
      }

      expect(
        regressions,
        `${screen.path} — accessibility REGRESSION. These violations are new or grew:`,
      ).toEqual([]);

      expect(
        improvements,
        `${screen.path} — accessibility IMPROVED and the baseline is now stale. ` +
          `Lower it in the same commit so the recorded debt stays true: ` +
          `bun run test:e2e:a11y:update`,
      ).toEqual([]);
    });
  }
});
