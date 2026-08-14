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

  // ── The landing page ────────────────────────────────────────────────────────
  //
  // A ROUTE GROUP ADDS NO PATH SEGMENT. `src/app/(home)/` IS `/` — the page every
  // prospect sees — and it is a SIBLING of `(marketing)`, not a child of it. Naming
  // `(app)` and `(marketing)` therefore read as "all of src/app" and was not, which is
  // how the hero shipped `live order topology` past a green gate. The fixture plants
  // that exact string, so this test fails if the target is ever dropped again.
  it("scans src/app/(home) — the landing page is a SIBLING of (marketing), not a child", () => {
    mkdirSync(join(root, "src", "app", "(home)"), { recursive: true });
    write("src/app/(home)/page.tsx", `export const H = () => <span>live order topology</span>;\n`);
    const { code, out } = runGate([], root);
    expect(code).toBe(1);
    expect(out).toContain("src/app/(home)/page.tsx");
    expect(out).toContain("[metaphor: topology]");
    rmSync(join(root, "src", "app", "(home)", "page.tsx"));
    // Baseline back to green, so the next test's failure is attributable to its own fixture.
    expect(runGate([], root).code).toBe(0);
  });

  // ── One-word labels ─────────────────────────────────────────────────────────
  //
  // The multi-line-prose fallback required TWO words, to keep a bare identifier on its
  // own line out of scope. That floor also excluded every one-word button in the
  // product — 90 of them across the scanned trees (Cancel, Retry, Revoke, Export), and
  // the landing hero's `Topology` view toggle among them. Written exactly as Prettier
  // formats a multi-attribute element: the opening tag's `>` alone on its own line.
  it("reads a ONE-WORD button label written across lines (the two-word floor's blind spot)", () => {
    write(
      "src/components/bridge/Toggle.tsx",
      [
        "export const T = () => (",
        "  <button",
        '    type="button"',
        "  >",
        "    Topology",
        "  </button>",
        ");",
        "",
      ].join("\n"),
    );
    const { code, out } = runGate([], root);
    expect(code).toBe(1);
    expect(out).toContain("Toggle.tsx");
    expect(out).toContain("[metaphor: topology]");
    rmSync(join(root, "src", "components", "bridge", "Toggle.tsx"));
  });

  // The relaxation above is keyed on the previous line being EXACTLY `>`, because only a
  // broken-up JSX opening tag produces that — after it, a bare word is unambiguously an
  // element's text. A line that merely ENDS in `>` may be a generic close, and relaxing
  // on that would put real code back in scope. This pins the distinction: loosen the key
  // to "ends with `>`" and this test turns red.
  it("does not relax the floor after a line that merely ENDS in `>` — a generic close is not a tag", () => {
    write(
      "src/components/bridge/Generic.tsx",
      ["type Props = Record<string, string>", "topology", ""].join("\n"),
    );
    expect(runGate([], root).code).toBe(0);
    rmSync(join(root, "src", "components", "bridge", "Generic.tsx"));
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

// ─── BLOCK exemptions are PER TIER ────────────────────────────────────────────
//
// `BLOCK_EXEMPT` used to exempt a path from BOTH blocking tiers at once, on ONE
// justification: the help corpus is reference documentation for a technical reader,
// so it must be free to say cXML, UBL and `Idempotency-Key`.
//
// That reason is real, and it covers the JARGON tier only. "idempotency" IS a jargon
// word, and vocabularyTerms.mjs keeps "exception" on the list with a comment saying
// the help articles are allowed it because they are BLOCK-exempt. Both deliberate.
//
// It does not reach the METAPHOR tier. bridge / crossing / dock / lane / spine / wire /
// traveller / topology are the words the founder purged from user-facing copy
// (CLAUDE.md §9); no technical reader needs them, and the help corpus is the single
// largest body of user-facing prose in the product. The stated reason also names cXML
// and UBL, which are GLOSS words — a tier that never blocks — so that half of the
// justification bought nothing at all.
//
// The exempt corpus was already almost clean when this landed, so the split is a guard
// that holds a clean corpus clean rather than a copy fix. The shapes that put a metaphor
// word in a help file WITHOUT it being copy — a CSS variable (`--gradient-link-spine`),
// an import path (`@/components/bridge/layout/Card`), a route (`href="/bridge"`), a
// proper noun (Proton Bridge) — all pass untouched; none of them reaches a visible span.
// Two spans did have to change, and both were ordinary English rather than the metaphor:
// "on the wire in clear text" and "Zapier/Make wiring". They were reworded, not masked —
// the same matcher already blocks "on the wire" everywhere else a user can read it.
//
// BOTH DIRECTIONS ARE PINNED, so the split cannot be "simplified" back into one list
// without a test going red:
//   • must-flag  — a metaphor word in a help file now FAILS
//   • must-allow — jargon in the same help file still PASSES
// Re-merging as "exempt from both" reddens the first; as "exempt from neither",
// the second.
describe("check-vocabulary.mjs — per-tier BLOCK exemption", () => {
  let root: string;

  const METAPHOR_PROSE = "This crossing uses the supplier dock.";
  const JARGON_PROSE = "Every exception is recorded, and the write is idempotent.";
  const CLEAN_PROSE = "Every order reaches its supplier.";

  /** The three help corpora, and how prose is written in each file kind. */
  const HELP_CORPUS = [
    {
      what: "a help reference article",
      rel: "src/app/(marketing)/help/api/page.mdx",
      body: (prose: string) => ["# Help", "", prose, ""].join("\n"),
    },
    {
      what: "a help component",
      rel: "src/components/help/GuideNote.tsx",
      body: (prose: string) => `export const GuideNote = () => <p>${prose}</p>;\n`,
    },
    {
      what: "the help article registry",
      rel: "src/lib/help-articles.ts",
      body: (prose: string) => `export const HELP_ARTICLES = [{ summary: "${prose}" }];\n`,
    },
  ];

  /**
   * The staff runbook is exempt for a DIFFERENT reason — it is our own operations copy,
   * not customer copy — and that reason does cover both tiers. Pinned so the split stays
   * targeted at the help corpus rather than becoming "metaphor is enforced everywhere".
   */
  const ADMIN = {
    what: "the staff runbook",
    rel: "src/app/(app)/admin/page.tsx",
    body: (prose: string) => `export const Admin = () => <p>${prose}</p>;\n`,
  };

  const ALL = [...HELP_CORPUS, ADMIN];

  const write = (rel: string, text: string) =>
    writeFileSync(join(root, ...rel.split("/")), text, "utf8");

  /** Every exempt file written clean, then `prose` planted in exactly one of them. */
  const plant = (target: { rel: string }, prose: string) => {
    for (const f of ALL) write(f.rel, f.body(f.rel === target.rel ? prose : CLEAN_PROSE));
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "vocab-tier-"));
    for (const f of ALL) {
      mkdirSync(join(root, ...f.rel.split("/").slice(0, -1)), { recursive: true });
    }
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  // A green baseline is what makes each planted word below attributable to its own
  // fixture rather than to something left behind by the previous test.
  it("baseline: the exempt corpus carrying ordinary copy is GREEN", () => {
    plant(HELP_CORPUS[0], CLEAN_PROSE);
    const { code, out } = runGate([], root);
    expect(code).toBe(0);
    expect(out).toContain("OK — no retired metaphor");
  });

  // THE REPORT IS ASSERTED BEFORE THE EXIT CODE, in every test below. Both mutations were
  // actually run, and with the exit code first each one failed as a bare `0 !== 1` — true,
  // but it tells the next reader nothing about which file or which word. Asserting the
  // report first makes vitest print the gate's own output, which names both.
  for (const f of HELP_CORPUS) {
    it(`FAILS on a retired metaphor word in ${f.what}`, () => {
      plant(f, METAPHOR_PROSE);
      const { code, out } = runGate([], root);
      expect(out).toContain(f.rel);
      expect(out).toContain("[metaphor: crossing]");
      expect(code).toBe(1);
    });

    it(`still exempts ${f.what} from the JARGON tier`, () => {
      plant(f, JARGON_PROSE);
      const { code, out } = runGate([], root);
      // A green run prints no file paths at all, so naming this file IS the offence.
      expect(out).not.toContain(f.rel);
      expect(out).toContain("OK — no retired metaphor");
      expect(code).toBe(0);
    });
  }

  it(`keeps BOTH exemptions on ${ADMIN.what}`, () => {
    plant(ADMIN, `${METAPHOR_PROSE} ${JARGON_PROSE}`);
    const { code, out } = runGate([], root);
    expect(out).not.toContain(ADMIN.rel);
    expect(out).toContain("OK — no retired metaphor");
    expect(code).toBe(0);
  });

  // The deliverable is a guard over a corpus that is ALREADY clean. This is the
  // assertion that says so: the real help tree passes with the metaphor tier live.
  it("the REAL repo stays green with the metaphor tier live over the help corpus", () => {
    const { code, out } = runGate([], REPO_ROOT);
    expect(code).toBe(0);
    expect(out).toContain("OK — no retired metaphor");
  }, 30_000);
});

// ─── blockBody anchoring — what may and may not capture a registry declaration ────────
//
// The noun budget finds each policed registry with `\bconst\s+NAME\b` and takes the FIRST
// match, and every defect here is that sentence. A COMMENT quoting the declaration captured
// the anchor — the same class `4c7350a` fixed in the LINK GUARDS, which never touched the
// gate. Stripping comments does not close it either: a STRING or TEMPLATE LITERAL carrying
// the same token captures it identically, because `stripComments` preserves literals by
// design (the two link guards read their contents). A JSX TEXT NODE is neither, and an
// ALIAS or FACTORY assignment lets the bracket scan run past the declaration entirely.
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

  /**
   * blockBody searches the MASKED copy but must SLICE from the unmasked one. Slicing from the
   * masked copy leaves the gate green and utterly vacuous rather than broken: masking keeps the
   * quotes and the length, so `"Partners"` becomes `"        "` and every `label:` regex still
   * matches — but so does every entry in the approved word list, and comparing blanks to blanks
   * offends nobody. Found by mutating this fix; a count assertion cannot see it, because the
   * count does not change.
   *
   * So this asserts the body carries real TEXT: plant an unapproved label and require the gate
   * to quote it back.
   */
  it("reads real label text out of the block, not masked whitespace", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "const FILTER_CHIPS: Array<{ label: string }> = [",
        '  { label: "Partners" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toContain('"Partners"');
    expect(out).toContain("partners");
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
    expect(out).toMatch(/InboxView\.tsx.*→.*registry-moved/);
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
    expect(out).toMatch(/InboxView\.tsx.*→.*registry-moved/);
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
    expect(out).toMatch(/InboxView\.tsx.*→.*registry-moved/);
  });

  // ─── a JSX text node is neither comment nor literal, so masking cannot see it ───
  //
  // What handles it is the LINE-ANCHOR: a declaration must start its line (optionally after
  // `export`), and a `const NAME` sitting inside markup does not. Both directions matter —
  // the decoy must not steal the anchor, and it must not suppress the failure either.

  it("a JSX TEXT NODE naming the declaration does not become the anchor", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "export const Doc = () => <p>const FILTER_CHIPS lives in this file</p>;",
        "const FILTER_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(0);
    expect(out).toContain("checked 8 navigation label(s)");
  });

  it("a JSX-TEXT decoy does not hide a registry that was renamed away", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "export const Doc = () => <p>const FILTER_CHIPS lives in this file</p>;",
        "const RENAMED_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toMatch(/InboxView\.tsx.*→.*registry-moved/);
  });

  /**
   * KNOWN GAP, pinned so it stays visible rather than being assumed closed.
   *
   * The line-anchor handles a `const NAME` sitting inside markup, which is every realistic
   * JSX-text case. It does NOT handle one that starts its own line — a multi-line `<pre>`
   * whose literal text happens to be a declaration. Then the decoy is the only match, so
   * uniqueness sees nothing wrong, and its region yields a label, so the floor sees nothing
   * wrong either: the gate reads the decoy and reports OK while the real registry is gone.
   *
   * Left open deliberately. Closing it needs real JSX awareness, and the shape — a code
   * sample written as raw JSX text rather than in a template literal or an MDX fence — does
   * not occur in this repo. If this test ever FAILS, the gap has been closed: delete it.
   */
  it("KNOWN GAP: a line-anchored declaration inside JSX <pre> text is still believed", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "export const Doc = () => (",
        "  <pre>",
        'const FILTER_CHIPS = [ label: "Orders" ]',
        "  </pre>",
        ");",
        "const RENAMED_CHIPS: Array<{ label: string }> = [",
        '  { label: "Issues" },',
        "];",
      ],
    });
    const { code } = runGate(["--nouns"], root);
    expect(code).toBe(0);
  });

  // ─── the body must START at the declaration ───
  //
  // Found by adversarial review, and it reproduced on the REAL InboxView.tsx. The bracket
  // scan used to run forward from the `=` for the next `{` or `[` ANYWHERE, so a registry
  // that is not a literal — aliased to a hoisted const, or built by a factory — let the scan
  // sail past the assignment and police an unrelated block further down the file. Exit 0,
  // "OK", no parse-failure token, and the real count slipped 42 → 38: well inside noise.
  //
  // Neither shape is exotic. Both are what "hoist the chips so the tests can import them"
  // and "generate the chips from the status table" look like.

  it("an ALIASED registry is reported, not silently re-pointed at the next block", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "const REAL_CHIPS = [",
        '  { label: "Partners" },',
        "];",
        "const FILTER_CHIPS = REAL_CHIPS;",
        "const SOMETHING_ELSE = [",
        '  { label: "Orders" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toMatch(/InboxView\.tsx.*→.*not-a-literal/);
  });

  it("a FACTORY-built registry is reported, not silently re-pointed at the next block", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "const FILTER_CHIPS = buildChips(STATUSES);",
        "const SOMETHING_ELSE = [",
        '  { label: "Orders" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toMatch(/InboxView\.tsx.*→.*not-a-literal/);
  });

  // `new Set([…])` is the one indirection a policed block really uses — FILLER in
  // vocabulary.ts — so it must keep working, or the gate cannot load its own vocabulary.
  it("still reads a `new Set([…])` declaration", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "const FILTER_CHIPS = new Set([",
        '  { label: "Orders" },',
        "]);",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(0);
    expect(out).toContain("checked 8 navigation label(s)");
  });

  // ─── labels are not always double-quoted ───
  //
  // The extractor matched `"…"` only, so a single-quoted or template-literal label was
  // skipped WITHOUT A WORD. The per-block floor cannot catch it: the double-quoted siblings
  // still parse, so the block is not empty. There is no Prettier here to normalise the style.

  for (const [style, written] of [
    ["single-quoted", `{ label: 'Partners' },`],
    ["template-literal", "{ label: `Partners` },"],
  ] as const) {
    it(`polices a ${style} label`, () => {
      plant({
        "src/components/bridge/InboxView.tsx": [
          "const FILTER_CHIPS: Array<{ label: string }> = [",
          `  ${written}`,
          "];",
        ],
      });
      const { code, out } = runGate(["--nouns"], root);
      expect(code).toBe(1);
      expect(out).toContain("partners");
    });
  }

  // …and an apostrophe inside a double-quoted label must still PARSE. A naive widening to a
  // backreferenced `[^"'`]` class would have silently stopped matching this — the label would
  // vanish from the count rather than be judged.
  //
  // The assertion is that it was READ, not that it passed: `unapprovedWords` splits on `'`,
  // so "Supplier's" becomes "supplier" + a bare "s" and the label is legitimately rejected.
  // That rejection is the proof — an unparsed label produces no offence at all.
  it("still reads a double-quoted label containing an apostrophe", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "const FILTER_CHIPS: Array<{ label: string }> = [",
        `  { label: "Supplier's orders" },`,
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(out).toContain("checked 8 navigation label(s)");
    expect(out).not.toContain("could not be read");
    expect(code).toBe(1);
    expect(out).toContain(`"Supplier's orders"`);
  });

  // ─── the per-block floor ───

  it("a registry that parses but yields NO labels is an offence, not a silent zero", () => {
    plant({
      "src/components/bridge/InboxView.tsx": ["const FILTER_CHIPS: Array<{ label: string }> = [];"],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toMatch(/InboxView\.tsx.*→.*empty-registry/);
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

  /**
   * The two kinds of failure are reported apart, and the split must key on how the offence
   * was RAISED, not on what its words happen to be. `unapprovedWords` does not split on `-`,
   * so a nav label literally named "Registry-moved" produces `bad: ["registry-moved"]` — and
   * a classifier that sniffed `bad` for a known code filed a real wording problem under
   * "this registry could not be read", handing the reader the wrong remediation entirely.
   */
  it("reports a label that merely LOOKS like a parse code as a wording offence", () => {
    plant({
      "src/components/bridge/InboxView.tsx": [
        "const FILTER_CHIPS: Array<{ label: string }> = [",
        '  { label: "Registry-moved" },',
        "];",
      ],
    });
    const { code, out } = runGate(["--nouns"], root);
    expect(code).toBe(1);
    expect(out).toContain("teach a word outside the vocabulary");
    expect(out).not.toContain("could not be read");
    // …and the block really was read, which is why this is a wording problem.
    expect(out).toContain("checked 8 navigation label(s)");
  });

  // ─── the real tree ───

  it("reads every policed registry in the REAL repo, with no parse failure", () => {
    const { code, out } = runGate(["--nouns"], REPO_ROOT);
    expect(code).toBe(0);
    expect(out).not.toMatch(
      /registry-moved|empty-registry|ambiguous-declaration|not-a-literal|file-not-found/,
    );

    // The BLOCK COUNT is the assertion that matters, and it is exact. Deleting an entry from
    // NOUN_REGISTRIES polices less while the label count stays entirely plausible — losing
    // NAV_MAIN takes 42 to 36, HUB_LABELS to 39, FILTER_CHIPS to 37. A loose label floor
    // cannot tell any of those from an ordinary IA change; measured, a `>= 35` floor let five
    // of the six deletions through. Update this number deliberately, with the registry entry.
    expect(out).toContain("across 7 registry block(s)");

    // Labels stay a loose backstop on top of that, for a collapse the block count cannot see.
    const count = Number(/checked (\d+) navigation label/.exec(out)?.[1]);
    expect(count).toBeGreaterThanOrEqual(35);
  });
});
