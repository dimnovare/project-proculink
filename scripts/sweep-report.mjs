#!/usr/bin/env node
/**
 * Merge the per-route records the control sweep writes into one report per
 * viewport, plus a cross-viewport comparison.
 *
 * WHY A SEPARATE SCRIPT. The sweep runs with parallel workers, and a Playwright
 * `afterAll` runs once PER WORKER — so an aggregate printed from inside the run
 * can only ever see a fraction of the routes while looking like a total. Each
 * route writes its own file; this merges them after the fact.
 *
 * The cross-viewport section is the point of the whole exercise: a finding that
 * appears at 390 but not at 1440 is a control that only exists in the mobile
 * tree, which is precisely the population no test in this repo could previously
 * reach.
 *
 *   node scripts/sweep-report.mjs            → markdown to stdout
 *   node scripts/sweep-report.mjs --json     → merged JSON
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

// NOT under test-results/: Playwright CLEARS that directory at the start of every
// run, so a report written there is destroyed by the next sweep — and, learned the
// hard way, so is any copy of the previous run kept beside it.
const ROOT = join(process.cwd(), ".qa-sweep");
const WCAG_MIN = 24;
const TOUCH_MIN = 44;

if (!existsSync(ROOT)) {
  console.error("No .qa-sweep/ output. Run: bunx playwright test --project=sweep-mobile --project=sweep-tablet --project=sweep-desktop");
  process.exit(1);
}

const VIEWPORT_WIDTH = { "sweep-mobile": 390, "sweep-tablet": 768, "sweep-desktop": 1440 };

/** A control's identity across viewports: route + how it is named + what it is. */
const key = (c) => `${c.route}|${c.tag}${c.role ? `[${c.role}]` : ""}|${c.name}`;


/**
 * WCAG 2.2 SC 2.5.8 — the SPACING exception, which is why the raw undersized
 * count is an upper bound and not a finding.
 *
 * The SC does not require a 24px target. It requires that a 24px-diameter circle
 * centred on the target does not intersect the circle of any OTHER target. A row
 * of 20px icons with generous gaps passes; two 20px icons jammed together do not.
 * Reporting size alone therefore over-reports, and `tap-targets.spec.ts` said as
 * much when it deferred the desktop work: "That is a real gap and it is
 * deliberately NOT closed here."
 *
 * Measuring it changes the question from "how many controls are under 24px"
 * (which nobody can act on) to "how many are under 24px AND crowded" (which is
 * the conformance failure). On this app that is the difference between a number
 * in the hundreds and a short list.
 *
 * WHAT THIS DOES NOT IMPLEMENT, stated so a green count is not over-read:
 *  • The `enclosed` exception (a target inside a larger sibling target).
 *  • The `essential` and `user-agent control` exceptions, which are judgement
 *    calls a script cannot make.
 * Both would only ever REDUCE the count further, so the number below stays an
 * upper bound — just a far tighter one.
 *
 * The test itself is a deliberate simplification: centre-to-centre distance
 * against the 24px diameter. The SC compares the undersized target's circle to
 * the OTHER target's circle, and where that other target is already 24px or
 * larger its own bounds are what count — so on a wide neighbour this is slightly
 * stricter than the SC. Stricter is the safe direction for a report, and saying
 * which direction it errs in is the point of writing it down.
 *
 * Distance between centres is the honest test: two circles of the same diameter
 * intersect when their centres are closer than the diameter itself.
 */
function isCrowded(target, all, diameter) {
  const cx = (b) => b.x + b.w / 2;
  const cy = (b) => b.y + b.h / 2;
  for (const other of all) {
    if (other === target) continue;
    const dx = cx(target.box) - cx(other.box);
    const dy = cy(target.box) - cy(other.box);
    if (Math.hypot(dx, dy) < diameter) return true;
  }
  return false;
}

const projects = {};
for (const project of readdirSync(ROOT)) {
  const dir = join(ROOT, project);
  // Directories only. This script WRITES REPORT.md into ROOT, so a second run
  // would otherwise try to readdir() its own output and crash — which it did,
  // the first time anyone ran it twice.
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  if (!readdirSync(dir).length) continue;
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

  const width = VIEWPORT_WIDTH[project] ?? 0;
  const floor = width <= 768 ? TOUCH_MIN : WCAG_MIN;
  const controls = pages.flatMap((p) => p.controls);
  // Only controls whose box was recorded can take part in a spacing measurement.
  // A run from before boxes were recorded has none, which the report says out
  // loud rather than reporting zero crowded controls as a clean result.
  const withBoxes = controls.filter((c) => c.box);
  const undersized = withBoxes.filter(
    (c) => !c.disabled && !c.inlineInText && !c.visuallyHidden && (c.width < WCAG_MIN || c.height < WCAG_MIN),
  );

  projects[project] = {
    project,
    width,
    floor,
    routes: pages.length,
    controls: controls.length,
    findings: {
      // Below the WCAG 2.2 AA floor at ANY width — the hard one.
      //
      // The two exclusions are the SC's own exceptions, not leniency. Without
      // them the first run reported 98 failures at 390px of which ~90 were prose
      // links in /terms, /privacy and /dpa (exempt: you cannot enlarge a word
      // inside a sentence) and the visually-hidden skip link, which measures 1px
      // BY DESIGN. Reporting those is reporting the pattern working, and it buries
      // the real ones.
      // Under the floor AND crowded — this is the SC 2.5.8 failure.
      belowWcagCrowded: undersized.filter((c) => isCrowded(c, withBoxes, WCAG_MIN)),
      // Under the floor but far enough from every other target to pass by the
      // spacing exception. Reported so the exemption stays visible and arguable
      // rather than silently shrinking the count.
      belowWcagButSpaced: undersized.filter((c) => !isCrowded(c, withBoxes, WCAG_MIN)),
      // Below the touch floor. Only meaningful where the pointer is coarse.
      belowTouch:
        width <= 768
          ? controls.filter(
              (c) => !c.disabled && !c.inlineInText && !c.visuallyHidden && (c.width < TOUCH_MIN || c.height < TOUCH_MIN),
            )
          : [],
      // Reported separately so the exemption stays visible and arguable rather
      // than silently shrinking the finding count.
      exemptInlineOrHidden: controls.filter(
        (c) => (c.inlineInText || c.visuallyHidden) && (c.width < WCAG_MIN || c.height < WCAG_MIN),
      ),
      unnamed: controls.filter((c) => c.name === ""),
      placeholderOnly: controls.filter((c) => c.name.startsWith("«")),
      // Split: a control past the right edge inside a horizontal scroll strip is a
      // PATTERN (tabs, filter chips); one past the edge with no scroller is CLIPPED
      // and unreachable. Only the second is unambiguously a defect — but the first
      // still hides its tail controls unless something signals the scroll, so it is
      // reported, not dropped.
      clipped: controls.filter((c) => c.overflowRight > 0 && !c.inScrollContainer),
      inScrollStrip: controls.filter((c) => c.overflowRight > 0 && c.inScrollContainer),
      horizontalScroll: pages.filter((p) => p.horizontalOverflow > 0).map((p) => ({ route: p.route, px: p.horizontalOverflow })),
      noH1: pages.filter((p) => p.h1Count === 0).map((p) => p.route),
      multipleH1: pages.filter((p) => p.h1Count > 1).map((p) => `${p.route} (${p.h1Count})`),
      headingSkips: pages.filter((p) => p.headingSkips?.length).map((p) => ({ route: p.route, skips: p.headingSkips })),
      consoleErrors: pages.filter((p) => p.appConsoleErrors?.length).map((p) => ({ route: p.route, errors: p.appConsoleErrors })),
      pageErrors: pages.filter((p) => p.pageErrors?.length).map((p) => ({ route: p.route, errors: p.pageErrors })),
      backendRefused: pages.filter((p) => p.backendRefused?.length).map((p) => p.route),
      didNotRender: pages.filter((p) => !p.ok).map((p) => `${p.route} (HTTP ${p.status})`),
    },
    boxesRecorded: withBoxes.length,
    controlKeys: new Set(controls.map(key)),
    pages,
  };
}

// ── Cross-viewport: which controls exist at one width and not another ─────────
const names = Object.keys(projects);
const exclusive = {};
for (const a of names) {
  const others = names.filter((n) => n !== a);
  exclusive[a] = [...projects[a].controlKeys].filter((k) => others.every((b) => !projects[b].controlKeys.has(k)));
}

if (process.argv.includes("--json")) {
  const out = Object.fromEntries(
    Object.entries(projects).map(([k, v]) => [k, { ...v, controlKeys: undefined, pages: undefined }]),
  );
  console.log(JSON.stringify({ projects: out, exclusive }, null, 2));
  process.exit(0);
}

const lines = [];
const push = (s = "") => lines.push(s);

push("# ProcuLink control sweep");
push();
push("| Viewport | Routes | Controls | Controls only at this width |");
push("|---|---:|---:|---:|");
for (const n of names) {
  push(`| ${n} (${projects[n].width}px) | ${projects[n].routes} | ${projects[n].controls} | ${exclusive[n].length} |`);
}
push();
for (const n of names) {
  if (projects[n].boxesRecorded === 0 && projects[n].controls > 0) {
    push(
      `> \u26a0 **${n}**: no control boxes were recorded, so the SC 2.5.8 spacing measurement did not run. ` +
        "Its crowded/spaced counts are zero because nothing was measured, not because nothing is crowded. " +
        "Re-run the sweep on a build that records boxes.",
    );
    push();
  }
}
if (names.length < 2) {
  // With one project loaded, EVERY control is "only at this width" and the column
  // is a tautology. It printed 1060 of 1207 on a desktop-only run, which reads as
  // a startling finding and is arithmetic.
  push(
    "> ⚠ Only one viewport is present in `.qa-sweep/`, so the last column is meaningless — " +
      "every control is trivially exclusive when there is nothing to compare against. Run all three " +
      "projects (`bun run sweep`) before reading it.",
  );
} else {
  push(
    "The last column is why this sweep exists. A control that appears at only one width lives in a " +
      "breakpoint-forked tree, and before this run no automated test in the repo could reach it at that width.",
  );
}
push();

const SEVERITY = [
  ["didNotRender", "Route did not render", "P0"],
  ["pageErrors", "Threw during render", "P0"],
  ["consoleErrors", "Console errors", "P1"],
  ["horizontalScroll", "Page scrolls horizontally", "P1"],
  ["clipped", "Control clipped outside the viewport with no scroller", "P1"],
  ["inScrollStrip", "Control off-screen inside a horizontal scroll strip", "P2"],
  ["unnamed", "Control with no accessible name", "P1"],
  ["belowWcagCrowded", `Under ${WCAG_MIN}px AND crowded — fails WCAG 2.2 SC 2.5.8`, "P2"],
  ["belowWcagButSpaced", `Under ${WCAG_MIN}px but spaced — exempt under SC 2.5.8`, "info"],
  ["belowTouch", `Below the ${TOUCH_MIN}px touch floor`, "P2"],
  ["placeholderOnly", "Named only by placeholder/value", "P2"],
  ["noH1", "No <h1>", "P2"],
  ["multipleH1", "More than one <h1>", "P3"],
  ["headingSkips", "Heading level skipped", "P3"],
  ["backendRefused", "Calls the API in mock mode", "P2"],
  ["exemptInlineOrHidden", "Small, but exempt (inline prose link / skip link)", "info"],
];

push("## Findings by viewport");
push();
push("| Finding | Sev | " + names.map((n) => n.replace("sweep-", "")).join(" | ") + " |");
push("|---|---|" + names.map(() => "---:").join("|") + "|");
for (const [k, label, sev] of SEVERITY) {
  const counts = names.map((n) => projects[n].findings[k]?.length ?? 0);
  if (counts.every((c) => c === 0)) continue;
  push(`| ${label} | ${sev} | ${counts.join(" | ")} |`);
}
push();

for (const n of names) {
  const f = projects[n].findings;
  push(`## ${n} — ${projects[n].width}px`);
  push();
  for (const [k, label, sev] of SEVERITY) {
    const items = f[k] ?? [];
    if (!items.length) continue;
    push(`### ${sev} · ${label} (${items.length})`);
    push();
    for (const item of items.slice(0, 40)) {
      if (typeof item === "string") push(`- ${item}`);
      else if (item.errors) push(`- \`${item.route}\` — ${item.errors.slice(0, 2).join(" / ")}`);
      else if (item.skips) push(`- \`${item.route}\` — ${item.skips.join(", ")}`);
      else if (item.px !== undefined) push(`- \`${item.route}\` — ${item.px}px`);
      else
        push(
          `- \`${item.route}\` — \`<${item.tag}${item.role ? ` role="${item.role}"` : ""}>\` ` +
            `${item.name ? `"${item.name.slice(0, 60)}"` : "**(no name)**"} · ${item.width}×${item.height}` +
            `${item.overflowRight ? ` · ${item.overflowRight}px past the right edge` : ""}`,
        );
    }
    if (items.length > 40) push(`- …and ${items.length - 40} more (see the JSON)`);
    push();
  }
}

const md = lines.join("\n");
mkdirSync(ROOT, { recursive: true });
writeFileSync(join(ROOT, "REPORT.md"), md);
console.log(md);
console.error(`\nWritten: test-results/sweep/REPORT.md`);
