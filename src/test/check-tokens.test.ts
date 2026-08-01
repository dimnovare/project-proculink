/**
 * scripts/check-tokens.mjs — the design-token gate's own tests.
 *
 * The gate exists to fail a build, so the thing that must be proved is that it
 * CAN fail: a lint nobody can make go red is decoration. Every case here asserts
 * the process EXIT CODE, not the wording of the report, and each rule gets both
 * a positive (violating fixture → 1) and a negative (token-only fixture → 0).
 *
 * The .mdx case is not decoration either. next.config.ts sets
 * pageExtensions ["ts","tsx","mdx"] and the tree carries 45 `page.mdx` against
 * 44 `page.tsx`, so a .tsx-only enumerator would silently skip half the routes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const SCRIPT = resolve(__dirname, "../../scripts/check-tokens.mjs");

let ROOT: string;

/** Write one file into a throwaway tree at <root>/src/app/<rel>. */
function fixture(rel: string, contents: string): void {
  const full = join(ROOT, "src", "app", rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

/** Run the gate against the fixture tree. Returns its exit code. */
function run(...args: string[]): number {
  try {
    execFileSync(process.execPath, [SCRIPT, "--root", ROOT, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? -1;
  }
}

/** Run the gate and return its combined output, whatever the exit code. */
function output(...args: string[]): string {
  try {
    return execFileSync(process.execPath, [SCRIPT, "--root", ROOT, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

beforeAll(() => {
  ROOT = mkdtempSync(join(tmpdir(), "plk-tokens-"));
  mkdirSync(join(ROOT, "src", "app"), { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("check-tokens.mjs", () => {
  it("PASSES a tree whose pages only use tokens", () => {
    fixture(
      "clean/page.tsx",
      `export default function Page() {
  return <div className="bg-surface text-ink-muted" style={{ borderColor: "var(--border)" }} />;
}
`,
    );
    expect(run("--strict")).toBe(0);
  });

  it("FAILS on a raw hex literal in a .tsx page", () => {
    fixture(
      "dirty-tsx/page.tsx",
      `export default function Page() {
  return <div style={{ background: "#1E66C9" }} />;
}
`,
    );
    expect(run("--strict")).toBe(1);
    expect(output("--strict")).toContain("[hex-literal]");
  });

  it("FAILS on a raw hex literal in a .mdx page — pageExtensions includes mdx", () => {
    // Deliberately the ONLY offending file in this run, so a pass here cannot be
    // borrowed from the .tsx case.
    rmSync(join(ROOT, "src", "app", "dirty-tsx"), { recursive: true, force: true });
    fixture(
      "dirty-mdx/page.mdx",
      `# A help article

<span style={{ color: "#B36D14" }}>amber</span>
`,
    );
    expect(run("--strict")).toBe(1);
    const report = output("--strict");
    expect(report).toContain("dirty-mdx/page.mdx");
    expect(report).toContain("[hex-literal]");
  });

  it("FAILS on a per-page palette constant", () => {
    rmSync(join(ROOT, "src", "app", "dirty-mdx"), { recursive: true, force: true });
    fixture(
      "palette/page.tsx",
      `const BLUE = "#1E66C9";
export default function Page() {
  return <div style={{ color: BLUE }} />;
}
`,
    );
    expect(run("--strict")).toBe(1);
    expect(output("--strict")).toContain("[palette-const]");
  });

  it("FAILS on an inline-styled button background, even with no hex anywhere", () => {
    rmSync(join(ROOT, "src", "app", "palette"), { recursive: true, force: true });
    fixture(
      "inline-button/page.tsx",
      `export default function Page() {
  return (
    <button
      type="button"
      style={{ background: "var(--brand-green)" }}
    >
      Send
    </button>
  );
}
`,
    );
    expect(run("--strict")).toBe(1);
    const report = output("--strict");
    expect(report).toContain("[inline-button-bg]");
    // The fixture is token-only, so this must NOT also be reported as raw hex.
    expect(report).not.toContain("[hex-literal]");
  });

  it("does not mistake a '>' inside a QUOTED ATTRIBUTE for the end of a button tag", () => {
    rmSync(join(ROOT, "src", "app", "inline-button"), { recursive: true, force: true });
    // Brace-depth tracking alone is not enough: a `>` inside a quoted attribute
    // sits at depth 0 and terminated the tag before the scanner ever reached the
    // background. This exact fixture exited 0 — a real violation walked past one
    // of the two patterns §Enforcement names. `aria-label="Next >"` and
    // `title="Orders > Inbox"` are ordinary JSX.
    fixture(
      "quoted-gt-button/page.tsx",
      `export default function Page() {
  return (
    <button aria-label="a > b" style={{ background: "var(--brand-blue)" }}>
      x
    </button>
  );
}
`,
    );
    expect(run("--strict")).toBe(1);
    expect(output("--strict")).toContain("[inline-button-bg]");
    rmSync(join(ROOT, "src", "app", "quoted-gt-button"), { recursive: true, force: true });
  });

  it("catches rgb()/rgba()/hsl() with raw numbers, but not a token given an alpha", () => {
    // `rgba(30,102,201,0.22)` IS `#1E66C9` restated in decimal. 53 such literals
    // lived under src/app and were invisible to the ledger, so two pages could be
    // reported "cleaned to zero" while still hardcoding the brand blue.
    fixture("color-fn/page.tsx", `export const a = "rgba(30,102,201,0.22)";\n`);
    expect(run("--strict")).toBe(1);
    expect(output("--strict")).toContain("[color-fn]");

    // A token wearing an alpha is the CORRECT spelling and must not be flagged.
    fixture("color-fn/page.tsx", `export const a = "rgba(var(--rgb-brand-blue), 0.22)";\n`);
    expect(run("--strict")).toBe(0);
    rmSync(join(ROOT, "src", "app", "color-fn"), { recursive: true, force: true });
  });

  it("FAILS on a retired colour ANYWHERE under src/, not only under src/app/", () => {
    // The banned emerald shipped as the focus ring on all 46 help articles from
    // src/components/help/ — outside src/app/**, so the main scan was blind to
    // it by construction. This rule sweeps all of src/, has no baseline and no
    // allowlist. The fixture is deliberately in src/components, which the
    // src/app-scoped rules never look at.
    //
    // THE LITERAL IS ASSEMBLED, NOT WRITTEN. Spelling `focus-visible:ring-[#28C55E]`
    // out in this file put the banned emerald back into PRODUCTION CSS: Tailwind's
    // content scanner is a regex over file text, it scanned `src/**/*.ts`, and it
    // emitted `.focus-visible\:ring-\[\#28C55E\]{--tw-ring-color:rgb(40 197 94/…)}`
    // from this exact line. The guard skips `*.test.ts`; the compiler did not.
    // tailwind.config.ts now excludes tests too, and check-emitted-css.mjs reads the
    // compiler's real output — but the fixture is assembled anyway, so neither
    // spelling of the mistake is one edit away. The runtime value is unchanged, so
    // the assertion below still tests the real banned colour.
    mkdirSync(join(ROOT, "src", "components"), { recursive: true });
    const outside = join(ROOT, "src", "components", "Ring.tsx");
    const banned = ["#28", "C5", "5E"].join("");
    writeFileSync(outside, `export const ring = "focus-visible:ring-[${banned}]";\n`, "utf8");
    expect(run("--strict")).toBe(1);
    const report = output("--strict");
    expect(report).toContain("[retired-color]");
    expect(report).toContain("src/components/Ring.tsx");

    // Cleaned → green again, so the rule is two-sided.
    writeFileSync(outside, `export const ring = "focus-visible:ring-brand-green-deep";\n`, "utf8");
    expect(run("--strict")).toBe(0);
    rmSync(outside, { force: true });
  });

  it("catches a 3-digit hex", () => {
    fixture("short-hex/page.tsx", `export const a = "#fff";\n`);
    expect(run("--strict")).toBe(1);
    expect(output("--strict")).toContain("[hex-literal]");
    rmSync(join(ROOT, "src", "app", "short-hex"), { recursive: true, force: true });
  });

  it("does not mistake a JSX comparison for the end of a button tag", () => {
    rmSync(join(ROOT, "src", "app", "inline-button"), { recursive: true, force: true });
    // `count > 0` inside the tag: a naive `<button[^>]*>` would stop at that `>`
    // and never see the background, letting a real violation through.
    fixture(
      "tricky-button/page.tsx",
      `export default function Page({ count }: { count: number }) {
  return (
    <button type="button" disabled={count > 0} style={{ background: "#2E8E3A" }}>
      Send
    </button>
  );
}
`,
    );
    expect(run("--strict")).toBe(1);
    expect(output("--strict")).toContain("[inline-button-bg]");
  });

  it("is report-only without --strict, even with violations present", () => {
    // Same offending tree as the case above — only the flag differs.
    expect(run()).toBe(0);
  });

  it("PASSES once the offending page is cleaned", () => {
    fixture(
      "tricky-button/page.tsx",
      `export default function Page({ count }: { count: number }) {
  return (
    <button type="button" disabled={count > 0} className="bg-brand-green text-surface">
      Send
    </button>
  );
}
`,
    );
    expect(run("--strict")).toBe(0);
  });

  it("does not let the repo baseline absolve a fixture tree", () => {
    // A fixture placed at a path the real BASELINE forgives must still fail:
    // otherwise the ledger would silently exempt files it was never cut for.
    fixture("(app)/operations/connectors/page.tsx", `const X = "#123456";\n`);
    expect(run("--strict")).toBe(1);
    rmSync(join(ROOT, "src", "app", "(app)"), { recursive: true, force: true });
    expect(run("--strict")).toBe(0);
  });
});

describe("the repo itself", () => {
  const REPO = resolve(__dirname, "../..");

  /** Run the gate against the REAL tree — real allowlist, real baseline. */
  function runRepo(): number {
    try {
      execFileSync(process.execPath, [SCRIPT, "--strict"], {
        cwd: REPO,
        encoding: "utf8",
        stdio: "pipe",
      });
      return 0;
    } catch (err) {
      return (err as { status?: number }).status ?? -1;
    }
  }

  it("passes the design-token gate", () => {
    expect(runRepo()).toBe(0);
  });

  it("FAILS when a baselined file grows past its budget — in the real tree", () => {
    // The ledger's ONE load-bearing property: a file on the list may keep its
    // recorded count and may never exceed it. Every other test here pins the
    // ledger against a FIXTURE tree, where `--root` disables the baseline
    // entirely (USING_FIXTURE) — so none of them could ever have caught this
    // regressing. This one mutates a real baselined file and restores it.
    const target = join(REPO, "src", "app", "(app)", "admin", "page.tsx");
    const original = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([original, Buffer.from('\nconst _probe = "#123456";\n')]));
      expect(runRepo()).toBe(1);
    } finally {
      writeFileSync(target, original);
    }
    // Restored byte-for-byte, so the tree is green again.
    expect(runRepo()).toBe(0);
  });
});
