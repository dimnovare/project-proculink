import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripComments } from "../../scripts/lib/sourceScan.mjs";
import {
  DEFAULT_LOCAL_API,
  PRODUCTION_HOST,
  PRODUCTION_OPT_IN_FLAG,
  hasProductionOptIn,
  isProductionUrl,
  resolveTarget,
} from "../../scripts/live-matrix/target.mjs";

/**
 * Guard: no script under scripts/live-matrix may write to production unless someone
 * said so on the command line, for that invocation.
 *
 * The defect this is fed, verbatim: every harness in that folder carried
 *
 *     const API = process.env.PLK_API || "https://api.proculink.eu";
 *
 * so running one with no arguments and no environment posted to the live customer
 * database. On 2026-06-10 that happened — `ingest-harness.mjs` wrote 2,000 purchase
 * orders (PO numbers E2E-API-00000 … E2E-API-01999) into org `personal-workspace-d3be`
 * in ~54 seconds, all HTTP 200. Nothing failed. The default was simply taken.
 *
 * So the first test below is the defect itself: run each harness with an EMPTY
 * environment and NO arguments, and assert the target it prints is not production.
 * That runs the real scripts as a subprocess rather than re-testing the module in
 * isolation, because the module being correct was never the question — the question
 * is whether the executables reach it. Each harness prints its resolved target and
 * then exits 1 on the credentials it was not given, so no request is ever made.
 *
 * The opt-in is `--allow-production` on argv, never an environment variable. An env
 * var can be true without anyone having decided it should be true for this run: it
 * survives in an exported shell, in a .env, in a CI secret, in a parent process. So
 * there is a test here that throws a pile of plausible env vars at a production target
 * and asserts every one of them is still refused.
 *
 * Anti-vacuity: the swept corpus is asserted by exact filename list. Adding a fifth
 * harness fails this file until it is covered, and a glob that silently matches nothing
 * cannot pass.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const HARNESS_DIR = join(REPO_ROOT, "scripts", "live-matrix");

/** Every harness meant to be run from a shell — i.e. everything that could be run by accident. */
const SHELL_RUNNABLE = readdirSync(HARNESS_DIR)
  .filter((f) => f.endsWith(".mjs") && f !== "target.mjs")
  .sort();

const PRODUCTION_API = `https://api.${PRODUCTION_HOST}`;

type Run = { status: number | null; stdout: string; stderr: string };

/**
 * Run a harness with a constructed environment — never the developer's — so a stray
 * PLK_* in the ambient shell cannot decide the outcome of this test either.
 */
function runHarness(name: string, env: Record<string, string> = {}, args: string[] = []): Run {
  const result = spawnSync(process.execPath, [join(HARNESS_DIR, name), ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      windir: process.env.windir ?? "",
      ...env,
      // `as unknown as` because the project augments ProcessEnv with a required
      // NODE_ENV, and omitting it here is the point: the child gets nothing it was
      // not handed.
    } as unknown as NodeJS.ProcessEnv,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * Executable source only — the header blocks legitimately quote production URLs as
 * run examples, and a URL in a comment is documentation, not a target. `stripComments`
 * comes from scripts/lib/sourceScan.mjs, which src/test/sourceScan.test.ts pins as its
 * single definition in the repo.
 */
function executableSource(name: string): string {
  return stripComments(readFileSync(join(HARNESS_DIR, name), "utf8"));
}

/** The target a harness reported resolving to, read back off its own stdout. */
function reportedTarget(run: Run): string | null {
  return run.stdout.match(/^\[target\] .+ -> (\S+)/m)?.[1] ?? null;
}

describe("live-matrix harness corpus", () => {
  it("sweeps every shell-runnable harness in the folder", () => {
    // Anti-vacuity floor. Not `.length > 0` — the exact set, so a new harness added
    // without a target guard fails here instead of quietly joining an unswept glob.
    expect(SHELL_RUNNABLE).toEqual([
      "delivery-testfire-harness.mjs",
      "format-upload-harness.mjs",
      "inbound-email-harness.mjs",
      "ingest-harness.mjs",
    ]);
  });

  it("has real content behind every swept filename", () => {
    for (const name of SHELL_RUNNABLE) {
      expect(executableSource(name).length).toBeGreaterThan(500);
    }
  });

  it("routes every harness through the shared resolver, with no production fallback left", () => {
    for (const name of SHELL_RUNNABLE) {
      const code = executableSource(name);
      expect(code, `${name} must resolve its target through target.mjs`).toContain(
        "resolveTargetOrExit",
      );
      // The exact shape of the defect: a production URL as an `||` fallback.
      expect(code, `${name} still has a production URL fallback`).not.toMatch(
        /\|\|\s*['"`]https?:\/\/[^'"`]*proculink\.eu/,
      );
    }
  });

  it("keeps runner.js browser-only, so it can never become a shell-runnable production default", () => {
    // runner.js hardcodes API_BASE = https://api.proculink.eu and cannot take a flag,
    // which is only acceptable while a human pasting into a signed-in production tab is
    // the sole way to run it. Give it a node entry point and it becomes the same defect.
    const runner = readFileSync(join(HARNESS_DIR, "runner.js"), "utf8");
    expect(runner).toContain("window.Clerk");
    expect(runner).not.toMatch(/^#!/);
    expect(stripComments(runner)).not.toMatch(/process\.env|process\.argv/);
  });
});

describe.each(SHELL_RUNNABLE)("%s", (name) => {
  it("with no environment and no flags, does not resolve to a production URL", () => {
    const run = runHarness(name);
    const target = reportedTarget(run);
    expect(target, `${name} reported no target`).not.toBeNull();
    expect(isProductionUrl(target as string), `${name} defaulted to production`).toBe(false);
    expect(run.stdout).toContain(`[target] ${name} -> ${DEFAULT_LOCAL_API}`);
  });

  it("refuses a production target when the opt-in flag is absent", () => {
    const run = runHarness(name, { PLK_API: PRODUCTION_API });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("REFUSED");
    expect(run.stderr).toContain(PRODUCTION_OPT_IN_FLAG);
    // Refused before resolving — it never printed a target, so it never had one.
    expect(run.stdout).not.toContain("[target]");
  });

  it("cannot be unlocked by any environment variable", () => {
    const run = runHarness(name, {
      PLK_API: PRODUCTION_API,
      PLK_ALLOW_PRODUCTION: "1",
      PLK_PRODUCTION: "true",
      ALLOW_PRODUCTION: "yes",
      PRODUCTION: "1",
      FORCE: "1",
      CI: "true",
      NODE_ENV: "production",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("REFUSED");
  });

  it("reaches production only with the command-line flag", () => {
    // Safe to assert against the real production host: every harness prints its target
    // and then exits on the credentials this test deliberately withholds, so nothing is
    // ever sent. The assertion is that the flag — and only the flag — unlocks it.
    const run = runHarness(name, { PLK_API: PRODUCTION_API }, [PRODUCTION_OPT_IN_FLAG]);
    expect(run.stdout).toContain(`[target] ${name} -> ${PRODUCTION_API}`);
    expect(run.stdout).toContain("PRODUCTION (opt-in given)");
    expect(run.stderr).not.toContain("REFUSED");
  });

  it("accepts an explicitly configured non-production target without any flag", () => {
    const run = runHarness(name, { PLK_API: "https://staging.example.test" });
    expect(run.stdout).toContain(`[target] ${name} -> https://staging.example.test`);
    expect(run.stderr).not.toContain("REFUSED");
  });
});

describe("resolveTarget", () => {
  const noEnv = {} as NodeJS.ProcessEnv;
  /** `PLK_API` alone, typed for resolveTarget's ProcessEnv parameter. */
  const withApi = (plkApi: string) => ({ PLK_API: plkApi }) as unknown as NodeJS.ProcessEnv;

  it("defaults to a target that is not production", () => {
    expect(isProductionUrl(DEFAULT_LOCAL_API)).toBe(false);
    expect(resolveTarget({ env: noEnv, argv: [] })).toMatchObject({
      api: DEFAULT_LOCAL_API,
      isProduction: false,
      explicit: false,
    });
  });

  it("treats a blank PLK_API as unset rather than as a target", () => {
    expect(resolveTarget({ env: withApi("   "), argv: [] }).api).toBe(DEFAULT_LOCAL_API);
  });

  it("refuses production without the flag and allows it with the flag", () => {
    expect(() => resolveTarget({ env: withApi(PRODUCTION_API), argv: [] })).toThrow(
      /REFUSED/,
    );
    expect(
      resolveTarget({ env: withApi(PRODUCTION_API), argv: [PRODUCTION_OPT_IN_FLAG] }),
    ).toMatchObject({ api: PRODUCTION_API, isProduction: true });
  });

  it("classifies production hosts however they are written", () => {
    for (const url of [
      PRODUCTION_API,
      `https://${PRODUCTION_HOST}`,
      `https://www.${PRODUCTION_HOST}`,
      `https://app.${PRODUCTION_HOST}/`,
      `HTTPS://API.${PRODUCTION_HOST.toUpperCase()}`,
      `  https://api.${PRODUCTION_HOST}  `,
      `https://api.${PRODUCTION_HOST}.`, // fully-qualified trailing dot
      `api.${PRODUCTION_HOST}`, // no scheme
    ]) {
      expect(isProductionUrl(url), `${url} should be production`).toBe(true);
      expect(() => resolveTarget({ env: withApi(url), argv: [] })).toThrow(/REFUSED/);
    }
  });

  it("does not mistake look-alike hosts for production", () => {
    for (const url of [
      DEFAULT_LOCAL_API,
      "http://127.0.0.1:5223",
      `https://not${PRODUCTION_HOST}`,
      `https://${PRODUCTION_HOST}.attacker.test`,
      "https://staging.example.test",
    ]) {
      expect(isProductionUrl(url), `${url} should not be production`).toBe(false);
    }
  });

  it("refuses a PLK_API that is not a usable URL instead of falling back", () => {
    expect(() => resolveTarget({ env: withApi("http://exa mple.test"), argv: [] })).toThrow(
      /not a usable URL/,
    );
  });

  it("reads the opt-in from argv and from nowhere else", () => {
    expect(hasProductionOptIn([PRODUCTION_OPT_IN_FLAG])).toBe(true);
    expect(hasProductionOptIn(["--allow-production=1"])).toBe(false);
    expect(hasProductionOptIn([])).toBe(false);
    // The module must not consult the environment for the opt-in at all.
    const source = readFileSync(join(HARNESS_DIR, "target.mjs"), "utf8");
    const envReads = source.match(/env\.[A-Z_]+/g) ?? [];
    expect([...new Set(envReads)]).toEqual(["env.PLK_API"]);
  });
});
