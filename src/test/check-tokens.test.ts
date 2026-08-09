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
 *
 * AND THE SAME QUESTION ONE LEVEL UP: a rule that can fail is still worthless if
 * it is pointed at the wrong files. Every fixture case below writes into
 * `<root>/src/app/**`, which is exactly where the gate used to be rooted — so
 * every one of them passed, for years, while the gate read 151 of the 666
 * colour-bearing files in src/ and not one line of any screen in the product.
 * The `describe("the scanned corpus")` block is the floor that closes that: it
 * asserts what the gate ACTUALLY TOKENISED against the real tree, and it fails
 * if the root ever narrows again.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const SCRIPT = resolve(__dirname, "../../scripts/check-tokens.mjs");

/**
 * Every case here spawns the gate as a real subprocess, and the gate now reads
 * 448 files / ~104k lines instead of the 147 it read when it was rooted at
 * src/app. Alone that is ~370ms a run; inside the full suite, sharing the machine
 * with 200-odd other files, it blows straight past vitest's 5s default — which is
 * exactly what happened the first time this change was run end to end: EVERY
 * real-tree case failed with "Test timed out in 5000ms" and NOT ONE of them
 * failed an assertion.
 *
 * That matters more than it looks. A guard whose own tests go red under load gets
 * marked flaky and then skipped, which is the same ending as a guard that fails
 * the build on day one. The scan got 3x bigger, so the budget does too.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

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

const REPO = resolve(__dirname, "../..");

/** Run the gate against the REAL tree — real allowlist, real baseline. */
function runRepo(...args: string[]): number {
  try {
    execFileSync(process.execPath, [SCRIPT, "--strict", ...args], {
      cwd: REPO,
      encoding: "utf8",
      stdio: "pipe",
    });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? -1;
  }
}

interface Stats {
  root: string;
  listed: number;
  tokenised: number;
  linesScanned: number;
  filesWithViolations: number;
  violations: number;
  retired: number;
  baselineRows: number;
  baselineTotal: number;
}

/** The gate's own account of what it read, against the real tree. */
function repoStats(): Stats {
  return JSON.parse(
    execFileSync(process.execPath, [SCRIPT, "--stats"], {
      cwd: REPO,
      encoding: "utf8",
      stdio: "pipe",
    }),
  ) as Stats;
}

/**
 * ANTI-VACUITY. Everything else in this file proves the RULES work. Nothing else
 * proves they were pointed at anything, and that is the failure that actually
 * happened: `SCAN_DIR = ["src", "app"]` joined to `src/app`, every rule was
 * correct, every fixture test was green, and the gate had never read a line of
 * InboxView.tsx / UploadWorkbench.tsx / BridgeDashboard.tsx — the files the
 * screens are made of.
 *
 * A FILE COUNT IS NOT A DETECTION FLOOR. "448 files scanned" is equally true of a
 * scanner that tokenised all of them and one that listed them and read none, so
 * these assert `tokenised` and `linesScanned` — counters the gate only increments
 * after a successful read + rule pass — and then the last test proves detection
 * end-to-end by putting a real violation in a real component file.
 */
describe("the scanned corpus", () => {
  it("reads src/**, not src/app/** — with a floor under what it actually tokenised", () => {
    const s = repoStats();
    expect(s.root).toBe("src");

    // Measured 2026-08-09: 665 colour-bearing files under src/, of which 217 are
    // *.test.* and deliberately skipped, leaving 448. The floors sit well under
    // the real numbers so ordinary growth does not churn them, but far above what
    // the old src/app root could ever have reached (147 files INCLUDING tests).
    expect(s.tokenised).toBeGreaterThan(350);
    expect(s.linesScanned).toBeGreaterThan(60_000);

    // Nothing was listed and then silently dropped before the rules ran.
    expect(s.tokenised).toBe(s.listed);
  });

  it("has a ledger that is non-trivial and matches the tree it was cut from", () => {
    const s = repoStats();
    // The debt is real and large; a ledger that collapsed to a handful of rows
    // would mean the scan narrowed, not that the tree got clean overnight.
    expect(s.baselineRows).toBeGreaterThan(100);
    expect(s.baselineTotal).toBeGreaterThan(3_000);

    // The gate is green, so found debt and ledgered debt must agree exactly.
    // This is what ties the ledger below to a LIVE run rather than to a file
    // somebody could have hand-written.
    expect(s.violations).toBe(s.baselineTotal);
    expect(s.filesWithViolations).toBe(s.baselineRows);

    // Retired colours are never ledgered, so this is the one count that must be 0.
    expect(s.retired).toBe(0);
  });

  it("ledgers the screen bodies the old src/app root could not see", () => {
    // Named, not counted. A floor on totals still passes if the scan reads 451
    // wrappers and helpers and no screens, so these are the specific files the
    // src/app root missed by construction — each one the body behind a ~10-line
    // page.tsx. Counts are asserted as ">0" rather than pinned: the ledger owns
    // the exact numbers, this owns the fact that the files are IN it.
    const ledger = JSON.parse(
      readFileSync(join(REPO, "scripts", "token-debt-baseline.json"), "utf8"),
    ) as Record<string, number>;

    for (const body of [
      "src/components/bridge/BridgeDashboard.tsx", // /bridge      (wrapper: 10 lines)
      "src/components/bridge/InboxView.tsx", // /inbox       (wrapper: 18 lines)
      "src/components/bridge/UploadWorkbench.tsx", // /upload      (wrapper: 11 lines)
      "src/components/bridge/SupplierDockProfile.tsx", // suppliers/[id] (wrapper: 14 lines)
    ]) {
      expect(ledger[body], `${body} missing from the ledger`).toBeGreaterThan(0);
    }

    // Most of the debt is in the region the gate used to be blind to. If a future
    // edit narrows the root back toward src/app, this is the assertion that goes
    // red first — the totals above would still look plausible.
    const rows = Object.keys(ledger);
    const inComponents = rows.filter((r) => r.startsWith("src/components/"));
    expect(inComponents.length).toBeGreaterThan(rows.length / 2);
  });

  it("DETECTS a violation in a src/components file — the old root's blind spot", () => {
    // The end-to-end detection floor: a real violation, in a real file, outside
    // src/app, must turn the gate red. Everything above reads the gate's own
    // report; this one plants the defect.
    //
    // The target is deliberately a leaf component and NOT one of the big screen
    // bodies named above. Vitest runs test files in parallel and several of them
    // read component SOURCE (statusVocabulary, textColorScan, orderPopulation…);
    // BridgeDashboard.tsx is named in eight test files, this one in none, so the
    // window where the tree is mutated cannot be observed by another worker.
    const target = join(REPO, "src", "components", "ui", "chart.tsx");
    const original = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([original, Buffer.from('\nconst _probe = "#123456";\n')]));
      expect(runRepo()).toBe(1);
    } finally {
      writeFileSync(target, original);
    }
    expect(runRepo()).toBe(0);
  });
});

describe("the repo itself", () => {
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

  it("FAILS when a baseline row records debt the file no longer carries", () => {
    // THE OTHER DIRECTION, and the one ratchets usually leave out. The gate used
    // to print a shrunk row as `[STALE]` and exit 0, so a row could outlive its
    // defect indefinitely: the file is clean, the ledger still bills it, and the
    // total the PR body quotes as "how much design debt exists" is wrong.
    //
    // Asserted through --baseline rather than by editing the tracked ledger, so a
    // crash mid-test cannot leave the repo's real baseline corrupted.
    const realBaseline = JSON.parse(
      readFileSync(join(REPO, "scripts", "token-debt-baseline.json"), "utf8"),
    ) as Record<string, number>;

    const [firstRow, realCount] = Object.entries(realBaseline)[0];
    expect(realCount).toBeGreaterThan(0);

    const inflated = join(ROOT, "inflated-baseline.json");
    writeFileSync(
      inflated,
      JSON.stringify({ ...realBaseline, [firstRow]: realCount + 7 }, null, 2),
      "utf8",
    );
    expect(runRepo("--baseline", inflated)).toBe(1);

    // A row for a file that does not exist at all is stale too — this is how a
    // DELETED page keeps billing the ledger forever.
    const ghost = join(ROOT, "ghost-baseline.json");
    writeFileSync(
      ghost,
      JSON.stringify({ ...realBaseline, "src/components/deleted-long-ago.tsx": 3 }, null, 2),
      "utf8",
    );
    expect(runRepo("--baseline", ghost)).toBe(1);

    // The unmodified ledger is still green, so the failures above came from the
    // inflation and not from the --baseline plumbing.
    const copy = join(ROOT, "copy-baseline.json");
    writeFileSync(copy, JSON.stringify(realBaseline, null, 2), "utf8");
    expect(runRepo("--baseline", copy)).toBe(0);
  });
});
