// WP-25 — tests for the extended vocabulary gate (DESIGN-DB-1 §7).
//
// Two things are pinned here:
//   1. `unapprovedWords()` — the rule. Table-driven, including the false
//      positives §7.3 warns about ("version" in a changelog must never fire).
//   2. `scripts/check-vocabulary.mjs` — the scan. Driven as a SUBPROCESS against
//      a fixture tree, so we prove the gate FAILS on planted jargon and PASSES
//      on the clean equivalent. A gate that only ever runs green on the real
//      repo proves nothing; the fixture is what makes this non-vacuous.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  APPROVED_NOUNS,
  APPROVED_PLACES,
  PENDING_IA_LABELS,
  unapprovedWords,
} from "./vocabulary";

const REPO_ROOT = join(__dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-vocabulary.mjs");

/** Run the gate against `root`; return { code, out }. Never throws on exit 1. */
function runGate(args: string[], root: string): { code: number; out: string } {
  try {
    const out = execFileSync("node", [SCRIPT, ...args, "--root", root], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("APPROVED_NOUNS", () => {
  it("is exactly the nine nouns a customer may be taught", () => {
    expect([...APPROVED_NOUNS]).toEqual([
      "order",
      "supplier",
      "item code",
      "order layout",
      "output",
      "delivery",
      "rule",
      "issue",
      "workspace",
    ]);
    expect(APPROVED_NOUNS).toHaveLength(9);
  });

  it("keeps the place list closed and small", () => {
    expect(APPROVED_PLACES.length).toBeLessThanOrEqual(6);
  });

  it("cites a spec row for every label it lets through pending the IA rebuild", () => {
    expect(PENDING_IA_LABELS.length).toBeGreaterThan(0);
    for (const entry of PENDING_IA_LABELS) {
      expect(entry.specRow, entry.label).toMatch(/§6\.\d+ #\d+ (DELETE|MERGE|HIDE)/);
    }
  });
});

describe("unapprovedWords", () => {
  const approved = [
    "Orders",
    "Suppliers",
    "Item codes",
    "Order layout",
    "Output layouts",
    "Delivery channels",
    "Rules",
    "Issues",
    "Workspace",
    "Overview",
    "Activity",
    "Settings",
    "Buyers",
    "Changes",
    "Deliveries",
    "Plan & billing",
    "API keys",
    "Shipping notices",
    "Format reference",
    "System status",
    "Queued to send",
    "Ready to send",
    "All orders",
  ];
  for (const label of approved) {
    it(`accepts "${label}"`, () => expect(unapprovedWords(label)).toEqual([]));
  }

  const rejected: Array<[string, string]> = [
    ["Partners", "partners"],
    ["PO Mapping", "mapping"],
    ["Validation rules", "validation"],
    ["Normalized", "normalized"],
    ["Exceptions", "exceptions"],
    ["Delivery log", "log"],
    ["Organization", "organization"],
    ["Dashboard", "dashboard"],
    ["Inbox", "inbox"],
  ];
  for (const [label, word] of rejected) {
    it(`rejects "${label}"`, () => expect(unapprovedWords(label)).toContain(word));
  }

  it("lets a PENDING_IA_LABELS entry through untouched", () => {
    expect(unapprovedWords("Rules & formats")).toEqual([]);
  });
});

// ─── The scan, driven as a subprocess against a fixture tree ──────────────────
describe("check-vocabulary.mjs scan", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "vocab-gate-"));
    mkdirSync(join(root, "src", "components", "bridge"), { recursive: true });
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    mkdirSync(join(root, "src", "app", "(marketing)", "help", "api"), { recursive: true });
    // The gate reads the approved lists out of the REAL vocabulary.ts.
    copyFileSync(join(REPO_ROOT, "src", "lib", "vocabulary.ts"), join(root, "src", "lib", "vocabulary.ts"));
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const write = (rel: string, body: string) =>
    writeFileSync(join(root, ...rel.split("/")), body, "utf8");

  it("FAILS on engine jargon in a src/components string a user reads", () => {
    write("src/components/bridge/Clean.tsx", `export const A = () => <p>Rules in use</p>;\n`);
    write("src/components/bridge/Dirty.tsx", `export const B = () => <p>Active rule bindings</p>;\n`);
    const { code, out } = runGate([], root);
    expect(code).toBe(1);
    expect(out).toContain("Dirty.tsx");
    expect(out).toContain("[jargon: bindings]");
    expect(out).not.toContain("Clean.tsx");
  });

  it("FAILS on jargon in MULTI-LINE JSX prose (the span the old gate could not see)", () => {
    rmSync(join(root, "src", "components", "bridge", "Dirty.tsx"));
    write(
      "src/components/bridge/Multi.tsx",
      ["export const C = () => (", "  <label>", "    Revision to test", "  </label>", ");", ""].join("\n"),
    );
    const { code, out } = runGate([], root);
    expect(code).toBe(1);
    expect(out).toContain("Multi.tsx");
    expect(out).toContain("[jargon: revision]");
  });

  it("FAILS on a label registry value in a src/lib/*.ts file", () => {
    rmSync(join(root, "src", "components", "bridge", "Multi.tsx"));
    write("src/lib/labels.ts", `export const X = [{ text: "Sign every payload with a secret" }];\n`);
    const { code, out } = runGate([], root);
    expect(code).toBe(1);
    expect(out).toContain("src/lib/labels.ts");
    expect(out).toContain("[jargon: payload]");
  });

  it("does NOT fire on a code identifier, a comment, or a status KEY", () => {
    rmSync(join(root, "src", "lib", "labels.ts"));
    write(
      "src/lib/keys.ts",
      [
        "// A comment about the canonical revision of the replay payload.",
        "export const STATUS = { delivery_dead_letter: { label: 'Retry needed' } };",
        "export const unrouted = 1;",
        "",
      ].join("\n"),
    );
    write(
      "src/components/bridge/Header.tsx",
      [
        "/* =========================================",
        "   Header — the ONE canonical surface.",
        "   Not wired into pages here.",
        "   ========================================= */",
        "const { revisions, wires } = props;",
        "export const D = () => <p>Ready to send</p>;",
        "",
      ].join("\n"),
    );
    const { code, out } = runGate([], root);
    expect(code).toBe(0);
    expect(out).toContain("OK — no retired metaphor");
  });

  it('never polices "version" — it is the approved replacement for "revision"', () => {
    write(
      "src/components/bridge/Changelog.tsx",
      `export const E = () => <p>Version history — this version was saved on 12 May.</p>;\n`,
    );
    expect(runGate([], root).code).toBe(0);
  });

  it("exempts help reference docs from the BLOCK tiers but still scans app copy", () => {
    write(
      "src/app/(marketing)/help/api/page.mdx",
      ["# API", "", "Send an `Idempotency-Key` header. The ingress endpoint is idempotent.", ""].join("\n"),
    );
    expect(runGate([], root).code).toBe(0);
  });

  it("does not scan a line inside an MDX code fence", () => {
    write(
      "src/app/(marketing)/legal.mdx",
      ["Some prose.", "", "```", "POST /api/ingress/{slug}/orders", "```", "", "More prose.", ""].join("\n"),
    );
    expect(runGate([], root).code).toBe(0);
  });

  it("--nouns FAILS when a nav label teaches a tenth noun, and names it", () => {
    mkdirSync(join(root, "src", "components", "bridge", "layout"), { recursive: true });
    write(
      "src/components/bridge/layout/HubTabs.tsx",
      [
        "export const HUB_LABELS: Record<HubKey, string> = {",
        '  partners: "Partners",',
        "};",
        "export const HUB_TABS: Record<HubKey, HubTab[]> = {",
        '  partners: [{ label: "Suppliers", href: "/library/suppliers" }],',
        "};",
        "",
      ].join("\n"),
    );
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toContain('"Partners"');
    expect(out).toContain("partners");
    // The approved sibling in the same block must NOT be reported.
    expect(out).not.toMatch(/"Suppliers"\s+→/);
  });

  it("--nouns FAILS LOUDLY if a policed registry is renamed or moved away", () => {
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toMatch(/registry-moved|file-not-found/);
  });
});
