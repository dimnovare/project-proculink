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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from "fs";
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
    expect(out).toMatch(/registry-moved|file-not-found/);
  });
});

// ─── registry-moved, against the REAL registry files ─────────────────────────
//
// WHY THIS EXISTS SEPARATELY. The test directly above runs against a fixture tree in which
// the policed files DO NOT EXIST, so it only ever proves the `file-not-found` branch. The
// `registry-moved` branch — the one that fires when a registry is renamed or lifted into
// another module — was never exercised against a real file, and it silently stopped working:
// `blockBody` takes the FIRST `const NAME` match, and a comment mentioning the declaration
// captures the anchor, so the declaration could be renamed with the gate still exit 0 and the
// label count quietly dropping. A meta-test that certifies a guard without running it against
// the tree that matters is worse than none.
//
// So this copies the REAL registry files into a fixture, proves the copy is faithful (baseline
// must be exit 0), and then mutates each one. The registry list is PARSED OUT OF THE GATE, so
// a seventh registry is covered the day it is added.
describe("--nouns registry-moved, exercised against the real registry files", () => {
  const GATE_SRC = readFileSync(SCRIPT, "utf8");

  /** `NOUN_REGISTRIES` as the gate itself declares it: [{ file, blocks: [...] }, …]. */
  const REGISTRIES = (() => {
    const body = /const NOUN_REGISTRIES = \[([\s\S]*?)\n\];/.exec(GATE_SRC);
    if (!body) throw new Error("NOUN_REGISTRIES not found in the gate");
    return [...body[1].matchAll(/\{\s*file:\s*"([^"]+)",\s*blocks:\s*\[([^\]]*)\]/g)].map((m) => ({
      file: m[1],
      blocks: [...m[2].matchAll(/"([^"]+)"/g)].map((b) => b[1]),
    }));
  })();

  let real: string;

  /** A fixture tree holding vocabulary.ts plus a verbatim copy of every policed file. */
  function freshTree(): string {
    const dir = mkdtempSync(join(tmpdir(), "vocab-real-"));
    mkdirSync(join(dir, "src", "lib"), { recursive: true });
    copyFileSync(join(REPO_ROOT, "src", "lib", "vocabulary.ts"), join(dir, "src", "lib", "vocabulary.ts"));
    for (const { file } of REGISTRIES) {
      const parts = file.split("/");
      mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
      copyFileSync(join(REPO_ROOT, ...parts), join(dir, ...parts));
    }
    return dir;
  }

  const readIn = (dir: string, file: string) => readFileSync(join(dir, ...file.split("/")), "utf8");
  const writeIn = (dir: string, file: string, body: string) =>
    writeFileSync(join(dir, ...file.split("/")), body, "utf8");

  /**
   * Rename the DECLARATION only, never a mention of the same token in a comment — which is
   * precisely the case the guard stopped catching.
   */
  const renameDecl = (src: string, name: string) =>
    src.replace(new RegExp(`^(\\s*(?:export\\s+)?)const\\s+${name}\\b`, "m"), `$1const ${name}_MOVED`);

  beforeAll(() => { real = freshTree(); });
  afterAll(() => rmSync(real, { recursive: true, force: true }));

  it("the six real registries are found, and the faithful copy passes", () => {
    expect(REGISTRIES.length).toBeGreaterThanOrEqual(6);
    const { code, out } = runGate(["--nouns"], real);
    expect(out, `baseline must be a clean pass, got:\n${out}`).toContain("OK —");
    expect(code).toBe(0);
  });

  for (const { file, blocks } of REGISTRIES) {
    for (const name of blocks) {
      it(`fires registry-moved when ${name} is renamed in ${file}`, () => {
        const dir = freshTree();
        try {
          const src = readIn(dir, file);
          const renamed = renameDecl(src, name);
          expect(renamed, `no declaration of ${name} in ${file}`).not.toBe(src);
          writeIn(dir, file, renamed);
          const { code, out } = runGate(["--nouns"], dir);
          expect(out).toContain("registry-moved");
          expect(code).toBe(1);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });

      // THE ACTUAL DEFECT. A comment mentioning the declaration must not become the anchor —
      // `blockBody` takes the first match, so before comments were stripped this exact shape
      // turned a renamed registry into a silent pass.
      it(`fires registry-moved for ${name} even when a comment names the declaration`, () => {
        const dir = freshTree();
        try {
          const decoy = `// path-pinned to \`const ${name}\` in ${file}\n`;
          writeIn(dir, file, decoy + renameDecl(readIn(dir, file), name));
          const { code, out } = runGate(["--nouns"], dir);
          expect(out).toContain("registry-moved");
          expect(code).toBe(1);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });

      // The other half of the same hazard: the array is lifted into a shared module and
      // imported back. The labels leave the scan entirely, so the gate MUST refuse to
      // silently check fewer of them.
      it(`fires registry-moved when ${name} is lifted out of ${file} into an import`, () => {
        const dir = freshTree();
        try {
          const src = readIn(dir, file);
          const gone = src.replace(
            new RegExp(`^(\\s*(?:export\\s+)?)const\\s+${name}\\b`, "m"),
            `$1const ${name}_ELSEWHERE_PLACEHOLDER`,
          );
          writeIn(dir, file, `import { ${name} } from "./registryTable";\n${gone}`);
          const { code, out } = runGate(["--nouns"], dir);
          expect(out).toContain("registry-moved");
          expect(code).toBe(1);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }
});
