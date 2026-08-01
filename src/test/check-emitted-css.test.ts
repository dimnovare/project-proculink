/**
 * scripts/check-emitted-css.mjs — the gate's own tests.
 *
 * A gate nobody can make go red is decoration, so every case here asserts the
 * process EXIT CODE against a fixture tree with a REAL tailwind config, and each
 * one is two-sided: a violating fixture exits 1, the cleaned fixture exits 0.
 *
 * The decimal case is the load-bearing one. Tailwind compiles `ring-[#28C55E]`
 * to `--tw-ring-color: rgb(40 197 94 / …)` — the hex survives only in the ESCAPED
 * SELECTOR. A hex-only matcher would pass a stylesheet whose declaration is the
 * banned colour, which is exactly the gap that let `rgb(40,197,94)` walk past the
 * source-side retired-colour rule.
 */

import { describe, it as vitestIt, expect, beforeAll, afterAll } from "vitest";

/**
 * Every case here SPAWNS THE TAILWIND COMPILER, which takes 1.5–4.5s per run and
 * more when several suites share the machine. Vitest's 5s default turned that
 * into flake: a first mutation check reported five failures where only one was
 * real, and the other four were timeouts wearing an assertion's clothes. A
 * timeout that reads as a failed assertion is worse than a slow test, because it
 * makes a mutation check unreadable — which is the one tool that says whether
 * any of this is load-bearing.
 */
const TAILWIND_SPAWN_MS = 60_000;
// This line is the timeout wrapper's DEFINITION, not a test: `fn` is a parameter, so there is no
// body here for expect-expect to inspect. Every call site below is a real test and is checked
// normally. (WP-02 added the rule; this is a scoped exception, not a blanket one.)
// eslint-disable-next-line vitest/expect-expect
const it = (name: string, fn: () => void | Promise<void>) => vitestIt(name, fn, TAILWIND_SPAWN_MS);
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const REPO = resolve(__dirname, "../..");
const SCRIPT = join(REPO, "scripts", "check-emitted-css.mjs");

let DIR: string;

/** Run the gate against a fixture config + input. Returns its exit code. */
function run(config: string, input: string): number {
  try {
    execFileSync(process.execPath, [SCRIPT, "--config", config, "--input", input], {
      cwd: REPO,
      encoding: "utf8",
      stdio: "pipe",
    });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? -1;
  }
}

function output(config: string, input: string): string {
  try {
    return execFileSync(process.execPath, [SCRIPT, "--config", config, "--input", input], {
      cwd: REPO,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

/**
 * A throwaway tailwind config scanning exactly one fixture file.
 *
 * `themeColors` lets a case emit a colour under a NAME, so the compiled output
 * carries the value only in the DECLARATION and never in the selector. That is
 * what isolates the decimal branch — see the decimal case for why it matters.
 */
function fixture(
  name: string,
  classNames: string,
  themeColors: Record<string, string> = {},
): { config: string; input: string } {
  const src = join(DIR, `${name}.tsx`);
  const config = join(DIR, `${name}.tailwind.cjs`);
  const input = join(DIR, `${name}.in.css`);
  writeFileSync(src, `export const C = "${classNames}";\n`, "utf8");
  writeFileSync(
    config,
    `module.exports = { content: [${JSON.stringify(src.replace(/\\/g, "/"))}], ` +
      `theme: { extend: { colors: ${JSON.stringify(themeColors)} } }, plugins: [] };\n`,
    "utf8",
  );
  writeFileSync(input, "@tailwind utilities;\n", "utf8");
  return { config, input };
}

// Assembled, never spelled — writing the banned class out in a scanned file is
// the exact defect this gate exists to catch. See tailwind.config.ts.
const EMERALD = ["#28", "C5", "5E"].join("");

beforeAll(() => {
  DIR = mkdtempSync(join(tmpdir(), "plk-emitted-"));
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe("check-emitted-css.mjs", () => {
  it("PASSES a config whose scanned files emit no retired colour", () => {
    const { config, input } = fixture("clean", "ring-[#1E66C9] text-[#0B1A2F]");
    expect(run(config, input)).toBe(0);
  });

  it("FAILS when an arbitrary-value class puts a retired colour in the output", () => {
    // This IS the shipped bug, reduced: a class name sitting in a scanned file
    // becomes a rule, whatever the file is for.
    const { config, input } = fixture("dirty", `focus-visible:ring-[${EMERALD}]`);
    expect(run(config, input)).toBe(1);
    expect(output(config, input)).toContain("retired value");
  });

  it("catches the DECIMAL form even when NO hex appears in the output at all", () => {
    // Tailwind emits `--tw-ring-color: rgb(40 197 94 / …)` — the hex survives only
    // in the escaped SELECTOR of an arbitrary-value class.
    //
    // THE FIRST VERSION OF THIS TEST WAS VACUOUS, and a mutation check is what
    // said so: it used `text-[#28C55E]` and asserted the report contained
    // "40 197 94", but the report prints a ±60-character CONTEXT WINDOW around
    // each hit — so the decimal sat in the window of the HEX hit, and stripping
    // the decimal branch entirely left the test green.
    //
    // Naming the colour in the theme removes the hex from the output completely.
    // The selector is `.text-retired-probe`; the ONLY trace of the banned value
    // is the declaration, in decimal. A hex-only matcher scores zero here.
    const { config, input } = fixture("decimal", "text-retired-probe", {
      "retired-probe": EMERALD,
    });
    const report = output(config, input);
    // Only the REPORTED HITS, not the whole report — the gate's banner names the
    // banned list, hex included, and asserting over that caught the banner
    // instead of the stylesheet.
    const hits = report.split("\n").filter((l) => /^\s+line \d+\s+"/.test(l));
    expect(hits.length, `no hit lines in:\n${report}`).toBeGreaterThan(0);
    expect(
      hits.join("\n"),
      "the fixture must not leak the hex into the CSS, or this proves nothing",
    ).not.toContain(EMERALD);
    expect(hits.join("\n")).toContain(`"40 197 94"`);
    expect(run(config, input)).toBe(1);
  });

  it("goes green again once the class is cleaned — the rule is two-sided", () => {
    const { config, input } = fixture("cleaned", "focus-visible:ring-[#1E6D29]");
    expect(run(config, input)).toBe(0);
  });

  it("names its own limits on every run, so a green result is not over-read", () => {
    const { config, input } = fixture("limits", "text-[#0B1A2F]");
    const report = output(config, input);
    expect(report).toContain("COMPILED CSS only");
    expect(report).toContain("Emission is not reachability");
  });
});

describe("the repo itself", () => {
  it("emits no retired colour from the real config", () => {
    // No --built here: .next is not guaranteed to exist in a test run, and a
    // check that quietly does nothing when its input is missing is worse than
    // no check. The COMPILE pass always runs. CI runs `lint:emitted-css`.
    try {
      execFileSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: "utf8", stdio: "pipe" });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      throw new Error(`exit ${e.status}\n${e.stdout ?? ""}${e.stderr ?? ""}`);
    }
  });

  it("compiles a stylesheet big enough for that pass to mean something", () => {
    // A gate that scanned an empty string would be green forever. The real
    // config emits ~150 KB; if this collapses, the assertion above is vacuous.
    const report = execFileSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: "utf8" });
    const bytes = /tailwind compile \(real config\)\s+\((\d+) bytes\)/.exec(report);
    expect(bytes, `could not read the compiled size from:\n${report}`).not.toBeNull();
    expect(Number(bytes![1])).toBeGreaterThan(50_000);
  });
});
