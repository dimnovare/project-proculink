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
 * SC 2.5.8's spacing verdict is NOT computed here. It rides on each control as
 * `crowded`, decided inside tests/e2e/control-sweep.spec.ts where one page's
 * geometry exists at one time.
 *
 * It used to be computed here, and it was wrong: this file only ever sees the
 * MERGED records, so "is another target within 24px" was asked across every
 * route in the project at once. A button on /inbox at (100, 200) came back
 * crowded because a link on /pricing happened to sit at (100, 205). Two pages
 * that never coexist, one inflated count, and nothing in the output to show it.
 * The fix is not a better comparison here — it is not having the data here.
 */

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

  // PER ROUTE, and this was wrong until 2026-08-27. A box is in VIEWPORT
  // coordinates, so comparing every control in the project against every other
  // one asked whether a button on /inbox sits within 24px of a link on /pricing
  // — pages that never exist at the same time. It inflated the count with pairs
  // that cannot crowd each other, and the inflation is invisible: a ghost
  // neighbour looks exactly like a real one in the output.
  // A record written before the spec decided this carries no `crowded` field at
  // all, and `undefined` would quietly read as "not crowded" — a clean report
  // from a run that measured nothing. Counted so the report can say so.
  const undecided = withBoxes.filter((c) => typeof c.crowded !== "boolean").length;

  projects[project] = {
    project,
    width,
    floor,
    routes: pages.length,
    controls: controls.length,
    undecided,
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
      belowWcagCrowded: undersized.filter((c) => c.crowded === true),
      // Under the floor but far enough from every other target to pass by the
      // spacing exception. Reported so the exemption stays visible and arguable
      // rather than silently shrinking the count.
      belowWcagButSpaced: undersized.filter((c) => c.crowded === false),
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
  if (projects[n].undecided > 0) {
    push(
      `> ⚠ **${n}**: ${projects[n].undecided} control(s) carry no SC 2.5.8 verdict. ` +
        "Those records predate the spec deciding it, so their crowded count is zero because " +
        "nothing decided it, not because nothing is crowded. Re-run the sweep.",
    );
    push();
  }
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
