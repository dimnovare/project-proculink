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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
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
  it("passes the design-token gate", () => {
    // No --root: this is the real tree, with the real allowlist and baseline.
    let status = 0;
    try {
      execFileSync(process.execPath, [SCRIPT, "--strict"], {
        cwd: resolve(__dirname, "../.."),
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (err) {
      status = (err as { status?: number }).status ?? -1;
    }
    expect(status).toBe(0);
  });
});
