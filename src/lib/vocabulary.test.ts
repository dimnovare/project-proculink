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

  // Regression: found by a mutation check. A `*_LABELS` Record keys on route
  // SEGMENTS (`exceptions:`), not on `label:`, so the label-key matcher was
  // blind to CRUMB_LABELS — the registry §7.1 explicitly names.
  it("FAILS on a *_LABELS map value, whose key is a route segment not `label:`", () => {
    rmSync(join(root, "src", "lib", "labels.ts"));
    write(
      "src/lib/crumbs.ts",
      [
        "export const CRUMB_LABELS: Record<string, string> = {",
        '  inbox: "Orders",',
        '  exceptions: "Exceptions",',
        "};",
        "",
      ].join("\n"),
    );
    const { code, out } = runGate([], root);
    expect(code).toBe(1);
    expect(out).toContain("src/lib/crumbs.ts");
    expect(out).toContain("[jargon: exceptions]");
    // The route-segment KEY itself is code and must never be reported.
    expect(out).not.toMatch(/"inbox"/);
  });

  it("does NOT fire on a code identifier, a comment, or a status KEY", () => {
    rmSync(join(root, "src", "lib", "crumbs.ts"));
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
    // NOTE: in THIS fixture tree only HubTabs.tsx exists, so what fires here is
    // `file-not-found` for the other four registry files — the `registry-moved` branch is
    // never reached. The alternation made that invisible. `blockBody anchoring` below is
    // where `registry-moved` is actually exercised, against a tree where every registry
    // file is present and the baseline run is GREEN.
    expect(out).toMatch(/registry-moved|file-not-found/);
  });
});

// ─── blockBody anchoring — what may and may not capture a registry declaration ────────
//
// The noun budget finds each policed registry with `\bconst\s+NAME\b` and takes the FIRST
// match. Every defect in this file's history is that sentence: a COMMENT quoting the
// declaration captured the anchor (`4c7350a`, and again in the gate `4c7350a` had already
// fixed), and after comment stripping was added a STRING or TEMPLATE LITERAL carrying the
// same token captured it identically — `stripComments` preserves literals by design,
// because the two link guards read their contents.
//
// A disarmed anchor does not fail. It reads the wrong region, finds no `label:` literals,
// scores zero, and the run prints OK — so every test here asserts a SPECIFIC exit code and
// a SPECIFIC offence token, never just "it failed".
//
// The fixture tree carries ALL FIVE registry files with approved labels, so the baseline is
// exit 0. That matters: in the suite above only HubTabs.tsx exists, so every run exits 1 on
// `file-not-found` and an assertion of "exit 1" there would pass no matter what blockBody
// did. A green baseline is what makes each mutation below attributable.
describe("check-vocabulary.mjs — blockBody anchoring", () => {
  let root: string;

  /** Every policed registry, with labels drawn from the approved vocabulary. 8 labels total. */
  const CLEAN: Record<string, string[]> = {
    "src/components/bridge/BridgeSidebar.tsx": [
      "const NAV_MAIN: SidebarNavSection[] = [",
      '  { group: "Orders", items: [{ label: "Suppliers" }] },',
      "];",
      "const NAV_TAIL: SidebarNavItem[] = [",
      '  { label: "Workspace" },',
      "];",
    ],
    "src/components/bridge/layout/HubTabs.tsx": [
      "export const HUB_LABELS: Record<HubKey, string> = {",
      '  orders: "Orders",',
      "};",
      "export const HUB_TABS: Record<HubKey, HubTab[]> = {",
      '  orders: [{ label: "Orders" }],',
      "};",
    ],
    "src/components/bridge/SupplierDockProfile.tsx": [
      "const TABS: Array<{ id: Tab; label: string }> = [",
      '  { id: "delivery", label: "Delivery" },',
      "];",
    ],
    "src/app/(app)/settings/page.tsx": [
      "const TABS: Array<{ id: SettingsTab; label: string }> = [",
      '  { id: "billing", label: "Billing" },',
      "];",
    ],
    "src/components/bridge/InboxView.tsx": [
      "const FILTER_CHIPS: Array<{ label: string }> = [",
      '  { label: "Issues" },',
      "];",
    ],
  };

  const write = (rel: string, body: string) =>
    writeFileSync(join(root, ...rel.split("/")), body, "utf8");

  /** Restore every registry to its clean form, then apply `edits`. */
  const plant = (edits: Record<string, string[]> = {}) => {
    for (const [rel, lines] of Object.entries(CLEAN)) {
      write(rel, `${(edits[rel] ?? lines).join("\n")}\n`);
    }
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "vocab-anchor-"));
    for (const rel of Object.keys(CLEAN)) {
      mkdirSync(join(root, ...rel.split("/").slice(0, -1)), { recursive: true });
    }
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    copyFileSync(
      join(REPO_ROOT, "src", "lib", "vocabulary.ts"),
      join(root, "src", "lib", "vocabulary.ts"),
    );
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("baseline: every registry parses and the run is GREEN", () => {
    plant();
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(0);
    expect(out).toContain("checked 8 navigation label(s)");
  });

  // ─── the anchor may not be captured by data ───

  it("a STRING LITERAL naming the declaration does not become the anchor", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        'const DOC = "see const FILTER_CHIPS in this file";',
        "const FILTER_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(0);
    // The real block was still read — all 8 labels, not 7.
    expect(out).toContain("checked 8 navigation label(s)");
  });

  it("a TEMPLATE LITERAL naming the declaration does not become the anchor", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "const DOC = `see const FILTER_CHIPS in this file`;",
        "const FILTER_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(0);
    expect(out).toContain("checked 8 navigation label(s)");
  });

  it("a COMMENT naming the declaration does not become the anchor", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "// The vocabulary gate is pinned to const FILTER_CHIPS in this file.",
        "const FILTER_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(0);
    expect(out).toContain("checked 8 navigation label(s)");
  });

  // ─── …and a decoy may not SUPPRESS the failure when the registry really is gone ───
  //
  // This is the defect in its load-bearing direction. Renaming a policed registry MUST fail.
  // Before masking, a decoy literal made the rename pass silently: the anchor landed on the
  // decoy, the region parsed to nothing, and zero labels raised no offence.

  it("a STRING-LITERAL decoy does not hide a registry that was renamed away", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        'const DOC = "see const FILTER_CHIPS in this file";',
        "const RENAMED_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toContain("registry-moved");
    expect(out).toContain("InboxView.tsx");
  });

  it("a TEMPLATE-LITERAL decoy does not hide a registry that was renamed away", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "const DOC = `see const FILTER_CHIPS in this file`;",
        "const RENAMED_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toContain("registry-moved");
  });

  it("a COMMENT decoy does not hide a registry that was renamed away", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "// pinned to const FILTER_CHIPS — do not move",
        "const RENAMED_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toContain("registry-moved");
  });

  // ─── a JSX text node is neither comment nor literal, so masking cannot see it ───

  it("a JSX TEXT NODE naming the declaration is reported as ambiguous, not silently obeyed", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "export const Doc = () => <p>const FILTER_CHIPS lives in this file</p>;",
        "const FILTER_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toContain("ambiguous-declaration");
  });

  // ─── the per-block floor ───

  it("a registry that parses but yields NO labels is an offence, not a silent zero", () => {
    plant({
      "src/components/bridge/InboxView.tsx": ["const FILTER_CHIPS: Array<{ label: string }> = [];"],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toContain("empty-registry");
    expect(out).toContain("InboxView.tsx");
  });

  // ─── balancing over the masked copy ───

  it("a bracket inside a label does not truncate the block", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "const FILTER_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues", hint: "use ] to close" },',
        '  { label: "Orders" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(0);
    // 9, not 8: the second chip is only reached if the `]` inside the literal did not
    // decrement the depth counter and end the block early.
    expect(out).toContain("checked 9 navigation label(s)");
  });

  // ─── the real tree ───

  it("reads every policed registry in the REAL repo, with no parse failure", () => {
    const { code, out } = runGate(["--nouns"], REPO_ROOT);
    expect(code).toBe(0);
    expect(out).not.toMatch(/registry-moved|empty-registry|ambiguous-declaration|file-not-found/);
    // A collapse backstop, deliberately loose: the per-block floor above is what catches a
    // SINGLE disarmed registry, so this only has to catch the shape where the count quietly
    // craters. 42 labels today.
    const count = Number(/checked (\d+) navigation label/.exec(out)?.[1]);
    expect(count).toBeGreaterThanOrEqual(35);
  });
});
