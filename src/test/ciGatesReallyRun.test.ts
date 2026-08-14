// Does CI actually run the quality gates this repo believes it runs?
//
// `.github/workflows/ci.yml` is the only merge gate here — vercel.json sets no
// build gate, and the git hooks installed by `prepare` are local-only and
// skippable. So a gate that stops being invoked there stops existing, silently,
// and every "CI is green" claim afterwards is about a smaller suite than the one
// people think ran. There is no other detector for that: a renamed script leaves
// `bun run <old-name>` in the workflow, and bun exits non-zero on an unknown
// script — but only if somebody looks at WHICH step failed, and only after it
// has already been merged.
//
// WHY NOTHING BELOW HARD-CODES A GATE NAME.
//
// The obvious version of this file is a `REQUIRED_GATES` array. That is the
// shape the abandoned `ci/wp01-reconciled-local` branch had, and it is exactly
// how a drift survives in this repo: the literal list is written once, ci.yml
// grows four more gates and renames a job, and the test keeps passing while
// describing a workflow that no longer exists. Every assertion here is a
// PROPERTY of whatever the parser finds — "each script referenced exists",
// "each gate step is blocking" — so adding, removing or renaming a gate needs no
// edit to this file, and a gate that quietly stops running still fails it.
//
// The gate list is therefore ci.yml itself. What is pinned is that the list is
// non-empty, internally consistent, and reachable on a pull request.
//
// Parsed with a small indentation walker rather than a YAML library, on purpose:
// adding a dependency to lint our own CI config is not worth the install, and
// the shape being read here (jobs → steps → run) is fixed by the Actions schema.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const WORKFLOW_PATH = ".github/workflows/ci.yml";
const workflow = readFileSync(join(ROOT, WORKFLOW_PATH), "utf8");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

type Step = {
  job: string;
  name: string;
  /** Every line of the step's `run:`, block scalars expanded. */
  run: string[];
  /** True when the step, or the job around it, is `continue-on-error: true`. */
  soft: boolean;
};

/**
 * Walk `jobs:` and return every step, tagged with its job.
 *
 * Block scalars (`run: |`) are expanded into `run` line-by-line so a multi-command
 * step is read whole, and so their CONTENT can never be mistaken for step keys —
 * the Playwright skip-reporter step embeds a node heredoc full of text that a
 * naive `/run:/` regex would happily parse as YAML.
 */
function parseJobs(yaml: string): { jobs: string[]; steps: Step[] } {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start === -1) return { jobs: [], steps: [] };

  const jobs: string[] = [];
  const steps: Step[] = [];
  const softJobs = new Set<string>();

  let job: string | null = null;
  let inSteps = false;
  let step: Step | null = null;
  let block: { indent: number; key: string; step: Step } | null = null;

  const closeStep = () => {
    if (step) steps.push(step);
    step = null;
    block = null;
  };

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];

    // Inside a block scalar, anything blank or indented deeper is content, not YAML.
    if (block) {
      const indent = line.search(/\S/);
      if (line.trim() === "" || indent > block.indent) {
        if (block.key === "run") block.step.run.push(line.trim());
        continue;
      }
      block = null;
    }

    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break; // dedented back out of `jobs:`

    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      closeStep();
      job = header[1];
      jobs.push(job);
      inSteps = false;
      continue;
    }
    if (!job) continue;

    if (/^ {4}steps:\s*$/.test(line)) {
      closeStep();
      inSteps = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      // Any other job-level key ends the steps list.
      closeStep();
      inSteps = false;
      if (/^ {4}continue-on-error:\s*true\s*$/.test(line)) softJobs.add(job);
      continue;
    }
    if (!inSteps) continue;

    const dash = /^ {6}-\s+(\S.*)$/.exec(line);
    if (dash) {
      closeStep();
      step = { job, name: "", run: [], soft: false };
    }
    if (!step) continue;

    const body = dash ? dash[1] : /^ {8}(\S.*)$/.exec(line)?.[1];
    if (!body) continue;

    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(body);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    const value = rawValue.trim();

    if (/^[|>][+-]?\d*$/.test(value)) {
      block = { indent: line.search(/\S/), key, step };
      continue;
    }
    if (key === "name") step.name = value;
    if (key === "run") step.run.push(value);
    if (key === "continue-on-error" && value === "true") step.soft = true;
  }
  closeStep();

  return { jobs, steps: steps.map((s) => ({ ...s, soft: s.soft || softJobs.has(s.job) })) };
}

/**
 * The script names a step asks bun to run.
 *
 * Only `bun run <script>` counts. `bunx playwright install` is a binary, not a
 * package.json script, and asserting it exists there would be a false red.
 */
function scriptsInvokedBy(step: Step): string[] {
  return step.run.flatMap((line) => [...line.matchAll(/\bbun run ([A-Za-z0-9:._-]+)/g)].map((m) => m[1]));
}

const { jobs, steps } = parseJobs(workflow);

/** Every step that invokes at least one package.json script. */
const gateSteps = steps
  .map((step) => ({ ...step, scripts: scriptsInvokedBy(step) }))
  .filter((step) => step.scripts.length > 0);

const invokedScripts = [...new Set(gateSteps.flatMap((s) => s.scripts))].sort();

const where = (step: { job: string; name: string }) => `${step.job} › ${step.name || "(unnamed step)"}`;

describe(`quality gates in ${WORKFLOW_PATH}`, () => {
  // ANTI-VACUITY FLOOR — this test is what makes the rest of the file mean
  // anything. `every()` over an empty array is TRUE, so a parser that matches
  // nothing turns every other assertion below into a green no-op. That failure
  // has shipped in this repo before, in guards that walked a directory one level
  // above the files they were meant to read.
  //
  // If this goes red, the parser is broken. FIX THE PARSER — do not lower the
  // floor to whatever the parser currently happens to find.
  //
  // The numbers are floors with deliberate headroom, not a census: today the
  // workflow has 6 jobs, 18 gate steps and 13 distinct scripts, and the
  // conformance-gate job alone runs 8 distinct ones. A census would go red on
  // every legitimate CI edit, which trains people to edit the number instead of
  // reading the failure.
  it("extracts a real gate list, not an empty one", () => {
    expect(jobs.length, "no jobs parsed out of the workflow").toBeGreaterThanOrEqual(4);
    expect(gateSteps.length, "no `bun run` steps parsed out of the workflow").toBeGreaterThanOrEqual(14);
    expect(invokedScripts.length, "suspiciously few distinct scripts invoked").toBeGreaterThanOrEqual(10);

    // The conformance-gate job runs many DIFFERENT scripts in one place. A parse
    // that finds only the e2e jobs would clear the totals above on step count
    // alone while having lost every lint gate, so pin the concentration too —
    // without naming the job, which has been renamed once already.
    const distinctPerJob = jobs.map(
      (job) => new Set(gateSteps.filter((s) => s.job === job).flatMap((s) => s.scripts)).size,
    );
    expect(
      Math.max(0, ...distinctPerJob),
      "no single job runs a broad set of gates — the conformance-gate job looks lost",
    ).toBeGreaterThanOrEqual(8);
  });

  // The failure this whole file exists for. Renaming a script in package.json
  // without touching ci.yml leaves the step calling a name bun does not know.
  it("only invokes scripts that exist in package.json", () => {
    const missing = gateSteps
      .flatMap((step) => step.scripts.map((script) => ({ script, at: where(step) })))
      .filter(({ script }) => !(script in pkg.scripts))
      .map(({ script, at }) => `${at}: \`bun run ${script}\` — no such script in package.json`);

    expect(missing).toEqual([]);
  });

  it("keeps every gate step blocking — never continue-on-error", () => {
    // `if: always()` is NOT this. It keeps later gates running after an earlier
    // one fails so a push reports every problem at once; the failed step still
    // fails the job. `continue-on-error: true` is the one that turns a gate into
    // a green check that can never go red.
    const soft = gateSteps.filter((step) => step.soft).map(where);
    expect(soft).toEqual([]);
  });

  it("runs on pull requests targeting main, not only on pushes", () => {
    // Read the pre-`jobs:` region with comments stripped: this file's `on:` and
    // `concurrency:` commentary discusses `pull_request` at length, and matching
    // prose would prove nothing about what the workflow is wired to.
    const triggers = workflow
      .slice(0, workflow.indexOf("jobs:"))
      .split(/\r?\n/)
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");

    expect(triggers).toMatch(/^on:\s*$/m);
    expect(triggers).toMatch(/\n {2}pull_request:\s*\n {4}branches:\s*\[\s*main\s*\]/);
    expect(triggers).toMatch(/\n {2}push:\s*\n {4}branches:\s*\[\s*main\s*\]/);
  });

  it("installs from the committed lockfile before any gate in the same job", () => {
    // A gate is only as trustworthy as the dependency tree it ran against, and a
    // non-frozen install resolves whatever is newest at that moment. Derived per
    // job rather than listed, so a new gate job is covered the day it is added.
    const problems: string[] = [];
    for (const job of jobs) {
      const inJob = steps.filter((s) => s.job === job);
      const firstGate = inJob.findIndex((s) => scriptsInvokedBy(s).length > 0);
      if (firstGate === -1) continue;
      const install = inJob.findIndex((s) => s.run.some((l) => l === "bun install --frozen-lockfile"));
      if (install === -1) problems.push(`${job}: runs gates with no \`bun install --frozen-lockfile\` step`);
      else if (install > firstGate) problems.push(`${job}: installs dependencies AFTER its first gate`);
    }
    expect(problems).toEqual([]);
  });

  it("passes --strict to any gate whose script is report-only without it", () => {
    // scripts/check-pageshell.mjs exits 0 on every input unless `--strict` is
    // passed, so dropping the flag leaves a step that runs, prints, and can never
    // fail — the exact silent no-op this file exists to prevent. Derived, not
    // named: a script qualifies when its own source reads `--strict` and its
    // package.json definition does not already supply it. check-cards.mjs and
    // check-tokens.mjs bake the flag into their npm script, so they are exempt
    // by that rule rather than by an allowlist.
    const problems: string[] = [];
    for (const script of invokedScripts) {
      const definition = pkg.scripts[script];
      if (!definition || definition.includes("--strict")) continue;
      const file = /node (scripts\/[\w.-]+\.mjs)/.exec(definition)?.[1];
      if (!file || !existsSync(join(ROOT, file))) continue;
      if (!readFileSync(join(ROOT, file), "utf8").includes("--strict")) continue;

      for (const step of gateSteps.filter((s) => s.scripts.includes(script))) {
        const invocation = step.run.find((line) => line.includes(`bun run ${script}`)) ?? "";
        if (!/(^|\s)--strict(\s|$)/.test(invocation)) {
          problems.push(`${where(step)}: \`${invocation}\` — ${file} is report-only without --strict`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // THE REVERSE DIRECTION. Guards in this repo habitually encode the shape of
  // the defect that prompted them and stay blind to the same defect rotated:
  // above asks "does every CI step name a real script", this asks "does every
  // gate-shaped script get run by CI". A `lint:*` that nothing invokes is a rule
  // somebody wrote, believed, and never enforced.
  //
  // CHOSEN: FAIL, not merely report. A listed-but-ignored finding is read once
  // and then scrolled past; the whole point of the packet is that CI gates stop
  // being honour-system. The cost of failing is one line in the workflow, which
  // is what should have happened anyway.
  //
  // Exempted by a DERIVED rule rather than an allowlist: a script is a local
  // variant when its last `:`-segment is a mode word and the script it varies IS
  // invoked by CI — `lint:tokens:report` is the report-only twin of the strict
  // `lint:tokens` a step already runs, and running both would be waste. Add a
  // genuinely new `lint:whatever` and no exemption applies, so it fails until CI
  // runs it or somebody argues it is not a gate.
  //
  // Scoped to `lint:*`, `check:*` and `typecheck`. `test:*` is deliberately out:
  // `test:watch`, `test:e2e:ui` and `test:e2e:live` are developer entry points
  // that CI is right not to run, and no derived rule separates them from a gate.
  it("runs every gate-shaped script in package.json", () => {
    const VARIANT_SUFFIXES = new Set(["report", "warn", "built", "update", "fix", "watch", "ui", "dev"]);
    const invoked = new Set(invokedScripts);

    const orphans = Object.keys(pkg.scripts)
      .filter((name) => /^(lint|check)(:|$)/.test(name) || name === "typecheck")
      .filter((name) => !invoked.has(name))
      .filter((name) => {
        const cut = name.lastIndexOf(":");
        if (cut === -1) return true;
        const [base, suffix] = [name.slice(0, cut), name.slice(cut + 1)];
        return !(VARIANT_SUFFIXES.has(suffix) && invoked.has(base));
      })
      .map((name) => `${name} — a gate-shaped script no CI step invokes`);

    expect(orphans).toEqual([]);
  });
});
