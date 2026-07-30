// Regression guard: CI must actually run the checks we already wrote.
//
// The defect this exists to catch: .github/workflows/ci.yml once defined only
// `build` (bun run build) and `test-e2e` (bun run test:e2e). The whole vitest
// suite, ESLint, the PageShell conformance audit and the vocabulary gate ran
// nowhere at merge time, so every "tests pass" claim about this repo was
// unverified. If someone deletes the unit-gate job, drops a step out of it, or
// quietly neuters one, these assertions fail.
//
// ci.yml is the only merge gate in this repo (vercel.json sets no build gate and
// there are no git hooks), so it is the single place worth guarding.
//
// Parsed with small regexes rather than a YAML library on purpose: adding a
// parser dependency just to lint our own CI config is not worth the install.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const WORKFLOW = "'.github/workflows/ci.yml'";
const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

/**
 * The commands that must gate every pull request, in the order they should run.
 *
 * `check:pageshell` MUST carry --strict. Without the flag the script is
 * report-only and always exits 0 (see scripts/check-pageshell.mjs), which would
 * make the step a silent no-op — a green check that can never go red. That is
 * precisely the failure mode this whole guard exists to prevent.
 */
const REQUIRED_GATES = [
  "bun run test",
  "bun run lint",
  "bun run check:pageshell --strict",
  "bun run lint:vocab",
] as const;

/** Split the `jobs:` mapping into { jobName -> raw block text }. */
function extractJobs(yaml: string): Record<string, string> {
  const lines = yaml.split(/\r?\n/);
  const jobsIdx = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIdx === -1) return {};

  const jobs: Record<string, string> = {};
  let current: string | null = null;

  for (const line of lines.slice(jobsIdx + 1)) {
    if (/^\S/.test(line)) break; // dedented back out of `jobs:`
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs[current] = "";
      continue;
    }
    if (current) jobs[current] += `${line}\n`;
  }
  return jobs;
}

/**
 * Every `run:` step command in a job block, trimmed.
 *
 * Exact values, never substrings — "bun run test" is a prefix of
 * "bun run test:e2e", and treating the existing e2e job as proof that the unit
 * suite runs is exactly the mistake this file guards against.
 */
function runCommands(jobBlock: string): string[] {
  return [...jobBlock.matchAll(/^\s*-?\s*run:\s*(.+?)\s*$/gm)]
    .map((match) => match[1])
    .filter((command) => command !== "|" && command !== ">");
}

const jobs = extractJobs(workflow);
const gateJobEntry = Object.entries(jobs).find(([, block]) => {
  const commands = runCommands(block);
  return REQUIRED_GATES.every((gate) => commands.includes(gate));
});

describe(`unit + lint gates in ${WORKFLOW}`, () => {
  it("runs the vitest suite, ESLint, the PageShell audit and the vocabulary gate in one job", () => {
    const found = Object.fromEntries(
      REQUIRED_GATES.map((gate) => [
        gate,
        Object.values(jobs).some((block) => runCommands(block).includes(gate)),
      ])
    );

    expect(found).toEqual({
      "bun run test": true,
      "bun run lint": true,
      "bun run check:pageshell --strict": true,
      "bun run lint:vocab": true,
    });
    expect(gateJobEntry, "all four gates must live in a single job").toBeDefined();
  });

  it("gates every pull request to main, not just pushes", () => {
    // `on:` is workflow-level, so it covers every job in the file — including
    // the gate job asserted above.
    const triggers = workflow.slice(0, workflow.indexOf("jobs:"));
    expect(triggers).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[\s*main\s*\]/);
    expect(triggers).toMatch(/pull_request:\s*\n\s*branches:\s*\[\s*main\s*\]/);
  });

  it("keeps the gate job blocking — never continue-on-error", () => {
    const [, gateJob] = gateJobEntry ?? ["", ""];
    expect(gateJob).not.toMatch(/continue-on-error:\s*true/);
  });

  it("installs dependencies with the committed lockfile before gating", () => {
    const [, gateJob] = gateJobEntry ?? ["", ""];
    expect(runCommands(gateJob)).toContain("bun install --frozen-lockfile");
    expect(gateJob).toContain("oven-sh/setup-bun@v2");
    expect(gateJob).toContain("actions/checkout@v4");
  });

  it("runs the gates fastest-signal-first", () => {
    // Cosmetic relative to the guards above: a deliberate reorder should fail
    // here alone, not muddy the "does it run at all" assertions.
    const [, gateJob] = gateJobEntry ?? ["", ""];
    const commands = runCommands(gateJob);
    const positions = REQUIRED_GATES.map((gate) => commands.indexOf(gate));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
