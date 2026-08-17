// A workflow holding the production Clerk secret must not be reachable from a PR.
//
// WHY THIS GUARD EXISTS. `.github/workflows/prod-smoke.yml` signs in to the live
// site, which means it runs with `secrets.CLERK_SECRET_KEY` — the production
// `sk_live_…` key — in its environment. That key can enumerate every user, mint a
// sign-in ticket for ANY account including the founder's, and delete users and
// organisations. The comment block at the top of that workflow says the trigger
// set is deliberate; a comment is not a check, and the whole reason this repo
// keeps finding defects is that a sentence claiming enforcement is where people
// stop looking.
//
// The failure being prevented is one edit: someone adds `pull_request:` to "test
// it on a PR". From that moment a fork PR runs repository workflow code with the
// production key in scope, and the first person to notice is whoever reads the
// leaked key. GitHub's own fork-secret restrictions do not save this — they are
// per-event, and `pull_request_target` is the documented hole.
//
// ── WHY IT SCANS RATHER THAN NAMES A FILE ────────────────────────────────────
// A test that opened `prod-smoke.yml` by name would pass forever once somebody
// copied the pattern into a second workflow, which is the shape this repo's
// guards keep failing in: they encode the defect that prompted them and go blind
// to the same defect one file over. So discovery is by PROPERTY — every workflow
// that references the production secret, or that runs the disposable-identity
// script — and the assertions apply to whatever that finds. Adding a second
// production-credentialled workflow needs no edit here; it is simply covered.
//
// Parsed with a small indentation walker rather than a YAML dependency, matching
// the precedent in src/test/ciGatesReallyRun.test.ts.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

/**
 * What makes a workflow "production-credentialled". Either signal is enough —
 * the secret reference is the direct one, and the script reference catches a
 * workflow that reaches the same key by some other name.
 */
const PRODUCTION_SECRET_SIGNALS = [
  "secrets.CLERK_SECRET_KEY",
  "scripts/prod-smoke/",
];

/**
 * The only triggers such a workflow may declare.
 *
 * Both are gated on write access or on GitHub's scheduler, and both can only run
 * workflow code that already exists on the branch they are dispatched against.
 * Everything else — `pull_request`, `pull_request_target`, `push`,
 * `issue_comment`, `repository_dispatch`, `workflow_call` — can be reached by
 * something other than a maintainer deliberately pressing a button.
 */
const ALLOWED_TRIGGERS = new Set(["workflow_dispatch", "schedule"]);

interface Workflow {
  file: string;
  source: string;
}

function loadProductionWorkflows(): Workflow[] {
  if (!existsSync(WORKFLOW_DIR)) return [];
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((file) => ({ file, source: readFileSync(join(WORKFLOW_DIR, file), "utf8") }))
    .filter((wf) => PRODUCTION_SECRET_SIGNALS.some((signal) => wf.source.includes(signal)));
}

/**
 * The trigger names declared in the `on:` block.
 *
 * Reads the block between a column-0 `on:` and the next column-0 key, and
 * returns every 2-space-indented map key inside it. Comment lines are dropped
 * first — this file's own subject matter means the workflow it inspects has the
 * word `pull_request` written several times in prose, and a guard that failed on
 * its own explanation would be useless.
 */
function declaredTriggers(source: string): string[] {
  const lines = source.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (start === -1) {
    // `on: [push]` / `on: workflow_dispatch` inline forms. Returning the raw
    // remainder as a single pseudo-trigger makes the assertion below fail loudly
    // rather than silently reporting "no triggers", which would pass.
    const inline = lines.find((line) => /^on:\s*\S/.test(line));
    return inline ? [inline.replace(/^on:\s*/, "").trim()] : [];
  }

  const triggers: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next column-0 key ends the block
    const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (match) triggers.push(match[1]);
  }
  return triggers;
}

const workflows = loadProductionWorkflows();

describe("workflows carrying the production Clerk secret", () => {
  it("finds at least one — otherwise every assertion below is vacuous", () => {
    // The scan is by content. A rename, a moved script or a changed secret name
    // would make it match nothing, and a guard that inspects nothing reports
    // exactly the same green as a guard that inspects everything and approves.
    expect(
      workflows.map((w) => w.file),
      `No workflow under .github/workflows references any of ${PRODUCTION_SECRET_SIGNALS.join(", ")}. ` +
        `Either the production smoke workflow was deleted, or it now reaches the secret by a name ` +
        `this scan does not know — add that name to PRODUCTION_SECRET_SIGNALS.`,
    ).not.toHaveLength(0);
  });

  it.each(workflows)(
    "$file is triggered only by workflow_dispatch or schedule",
    ({ file, source }) => {
      const triggers = declaredTriggers(source);

      expect(triggers, `${file} declares no triggers at all — the on: block could not be parsed.`)
        .not.toHaveLength(0);

      const forbidden = triggers.filter((t) => !ALLOWED_TRIGGERS.has(t));
      expect(
        forbidden,
        `${file} holds the production Clerk secret and declares the trigger(s) ` +
          `[${forbidden.join(", ")}]. Any trigger other than ${[...ALLOWED_TRIGGERS].join(" / ")} can be ` +
          `reached by something that is not a maintainer pressing a button — a fork PR under ` +
          `pull_request_target runs base-repo workflow code, and a push runs on any branch. ` +
          `The production sk_live key can mint a sign-in ticket for any account and delete users. ` +
          `To run this on a branch, dispatch it: gh workflow run ${file} --ref <branch>.`,
      ).toEqual([]);
    },
  );

  it.each(workflows)("$file deletes its disposable identity even when it fails", ({ file, source }) => {
    // The cleanup step is the second guardrail, and it is worth pinning because
    // its `if: always()` is the easy half to lose: a refactor that reorders steps
    // or wraps them in a condition turns "always deleted" into "deleted when the
    // test passed", and the runs that leave a live production user behind are
    // precisely the failed ones.
    if (!source.includes("clerk-disposable.mjs")) return;

    const lines = source.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
    const cleanupIndex = lines.findIndex((line) => line.includes("clerk-disposable.mjs cleanup"));
    expect(
      cleanupIndex,
      `${file} provisions a disposable Clerk identity but never runs ` +
        `\`clerk-disposable.mjs cleanup\`, so every run leaves a real user and organisation ` +
        `behind in the production Clerk instance.`,
    ).toBeGreaterThan(-1);

    // Look back over the step that owns the cleanup command for `if: always()`.
    // Ten lines is generous for a step of `name` / `if` / `run`, and short enough
    // that it cannot reach the previous step's condition.
    const stepWindow = lines.slice(Math.max(0, cleanupIndex - 10), cleanupIndex + 1).join("\n");
    expect(
      /if:\s*always\(\)/.test(stepWindow),
      `${file} runs the disposable-identity cleanup without \`if: always()\`. A failed ` +
        `assertion, a timeout or a cancellation would then skip it and leave a live user in ` +
        `production Clerk — and a failing run is the most likely run to leave one.`,
    ).toBe(true);
  });
});
