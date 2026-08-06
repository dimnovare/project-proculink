/**
 * Resolved-value contrast gate — the check `scripts/check-tokens.mjs` structurally
 * cannot perform.
 *
 * WHY THIS FILE EXISTS.
 * The token lint reads SOURCE TEXT and fails on raw hex. It is therefore blind to
 * the failure mode that actually ships:
 *
 *     style={{ background: "var(--amber-soft)", color: "var(--amber)" }}
 *
 * There is no raw hex on that line, so `lint:tokens` is green on it — forever —
 * and the pair is 3.65:1 against a 4.5:1 floor. A hex gate and AA conformance are
 * ORTHOGONAL: neither implies the other. Contrast has to be computed from the
 * RESOLVED values, which is what this file does — it parses globals.css for the
 * real token values and asserts the ratio at the sites that were measured failing.
 *
 * EVERY CASE HAS TWO HALVES, deliberately:
 *   (a) the maths — the pair clears its floor;
 *   (b) the source — the site still uses that pair.
 * Without (b) the file would stay green if somebody put `--amber` back, because
 * `--amber-text` on `--amber-soft` would still compute fine in isolation. Without
 * (a) it would be a string-matching test that never re-checks the numbers.
 *
 * The source rules are repo-wide on purpose. WP-30's refutation found the same
 * failing pair in a second file (`settings/page.tsx`) after it had been fixed in
 * the first — the token was swept, the PAIR was not. A per-site assertion would
 * have repeated that mistake; a repo-wide rule cannot.
 *
 * WHAT THIS FILE DOES NOT DO — read this before quoting a green run.
 *   1. IT IS A LIST, NOT A SWEEP. Every row below is a pair somebody MEASURED and
 *      then pinned. A failing pair nobody has looked at is not in the list, so it
 *      is green here, and green here is not a claim that the app passes AA.
 *   2. IT RESOLVES TOKENS, NOT LAYOUTS. `contrast(fg, bg)` needs to be told the
 *      background. Nothing here discovers what is actually painted behind a
 *      given element — that is a rendering question, and every `bg` in the table
 *      was determined by reading the tree by hand. A pair can be right here and
 *      wrong on screen if the element moved.
 *   3. ALPHA IS COMPOSITED BY HAND. `#2E8E3A18` over white is `#EBF4EC`, computed
 *      once and written down. Change the row colour underneath and the pinned
 *      composite is stale with nothing to notice.
 *   4. THE SOURCE RULES COVER TWO VALUE FAMILIES, amber and the retired emerald,
 *      plus one pairing rule for green-under-white. `src/app/**` has never been
 *      contrast-audited at all: it carries a hex-literal ledger in
 *      check-tokens.mjs, and THAT LEDGER IS ABOUT RAW HEX, not about contrast.
 *      Round 2's AC treated the two as interchangeable — it deferred its
 *      un-audited remainder to "the 798 ledgered violations" while 27 measured
 *      sub-4.5:1 text pairs sat in src/components/**, a region the ledger has
 *      never had a single row for. A debt ledger is only an alibi for the files
 *      it lists, and only for the kind of debt it counts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative } from "path";

const REPO = resolve(__dirname, "../..");
const SRC = join(REPO, "src");

// ─── WCAG 2.1 ─────────────────────────────────────────────────────────────────

/** WCAG 2.1 relative luminance. Same maths as FileChip.test.tsx, stated here so
 *  this file has no dependency on a component's test. */
function luminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Boundary sanity: the canonical WCAG example is #767676 on white ≈ 4.54:1.
 *  If this drifts, every other number in the file is wrong. */
it("the contrast helper reproduces the canonical WCAG boundary", () => {
  expect(contrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
});

// ─── Token resolution — read the REAL values, never a copy ────────────────────

const GLOBALS = readFileSync(join(SRC, "app", "globals.css"), "utf8");

/** `--token: #hex;` declarations from globals.css. */
const TOKENS: Record<string, string> = Object.fromEntries(
  [...GLOBALS.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/gm)].map(
    (m) => [m[1], m[2]],
  ),
);

/** `var(--x)` or `#hex` → `#hex`. Throws rather than silently returning a
 *  non-colour, so a renamed token fails loudly instead of passing. */
function resolveColor(value: string): string {
  const v = value.trim();
  const varMatch = /^var\((--[a-z0-9-]+)/.exec(v);
  if (varMatch) {
    const hit = TOKENS[varMatch[1]];
    if (!hit) throw new Error(`${varMatch[1]} is not defined in globals.css`);
    return hit;
  }
  if (/^#[0-9A-Fa-f]{3,8}$/.test(v)) return v;
  throw new Error(`not a colour literal or token reference: ${value}`);
}

// ─── Part (a): the maths, from resolved token values ─────────────────────────

/** [name, fg, bg, floor, why]. Floors: 4.5:1 normal text, 3:1 non-text/UI. */
const PAIRS: Array<[string, string, string, number, string]> = [
  [
    "amber text on the amber chip fill",
    "var(--amber-text)",
    "var(--amber-soft)",
    4.5,
    "settings/page.tsx billing-gate notice — --amber here was 3.65:1",
  ],
  [
    "amber text on white",
    "var(--amber-text)",
    "var(--surface)",
    4.5,
    "--amber on white is 4.11:1 — still under the floor",
  ],
  [
    "amber text on the work-area background",
    "var(--amber-text)",
    "var(--bg)",
    4.5,
    "--amber on --bg is 3.83:1",
  ],
  [
    "white on the AA button-fill green",
    "var(--surface)",
    "var(--brand-green-btn)",
    4.5,
    "webhooks + settings primary buttons — --brand-green is 4.1613:1",
  ],
  [
    "white on the deep green (button hover)",
    "var(--surface)",
    "var(--brand-green-deep)",
    4.5,
    "the hover state has to clear the floor too",
  ],
  [
    "danger text on the danger chip fill",
    "var(--danger)",
    "#FBE3E3",
    4.5,
    "admin modals — the stale #C53A3A was 4.26:1 on this fill",
  ],
  [
    "the help-article focus ring on white",
    "var(--brand-green-deep)",
    "var(--surface)",
    3,
    "WCAG 1.4.11 non-text — the banned #28C55E was 2.27:1",
  ],
  [
    "the help-article focus ring on the work-area background",
    "var(--brand-green-deep)",
    "var(--bg)",
    3,
    "same ring over --bg — #28C55E was 2.12:1",
  ],
  [
    "the eyebrow dot on the dark how-it-works pill",
    "var(--brand-blue-bright)",
    // rgba(30,102,201,0.10) composited over --navy, computed once and pinned:
    // 0.10 * #1E66C9 + 0.90 * #0B1A2F = #0D223E.
    "#0D223E",
    3,
    "WP-30 shipped --brand-blue there at 2.89:1 (was #2D7AE0, 3.78:1)",
  ],
  [
    "ink-faint on surface-2",
    "var(--ink-muted)",
    "var(--surface-2)",
    4.5,
    "settings 'Coming soon' chip — --ink-faint on --surface-2 is 4.48:1",
  ],
  // ─── The green family, added in round 3 ────────────────────────────────────
  //
  // `--brand-green` is to green what `--amber` is to amber: the NON-TEXT member
  // of the family. 4.1613:1 on white. globals.css had already learned this lesson
  // once and shipped `--amber-text`; nothing had drawn the same conclusion for
  // green, so ~20 sites in src/components/** were painting copy in it — a region
  // the src/app-scoped ledger has never had a row for. `--brand-green-deep`
  // already existed and is the right value; no new token was needed.
  [
    "green text on white",
    "var(--brand-green-deep)",
    "var(--surface)",
    4.5,
    "supplier names, saved-credential notes, add-field glyphs — --brand-green is 4.1613:1",
  ],
  [
    "green text on the green chip fill",
    "var(--brand-green-deep)",
    "var(--brand-green-soft)",
    4.5,
    "the workshop ready-row — a stray #2E7D38 was 4.4403:1 on this fill",
  ],
  [
    "green text on the work-area background",
    "var(--brand-green-deep)",
    "var(--bg)",
    4.5,
    "the supplier eyebrow + code in the flow drawer — --brand-green is 3.8846:1 there",
  ],
  [
    "green text on the navy chrome",
    "var(--brand-green-bright)",
    "var(--navy)",
    4.5,
    "the marketing 'Open the dashboard' link — --brand-green is 4.1948:1 on navy, and " +
      "going DEEPER makes it worse: --brand-green-deep is 1.99:1. Dark surfaces need the " +
      "bright step, which is the opposite move from every other row here.",
  ],
];

describe("resolved token pairs clear their WCAG floor", () => {
  it.each(PAIRS)("%s", (_name, fg, bg, floor, why) => {
    const a = resolveColor(fg);
    const b = resolveColor(bg);
    const ratio = contrast(a, b);
    expect(
      ratio,
      `${fg} (${a}) on ${bg} (${b}) is ${ratio.toFixed(4)}:1, below the ${floor}:1 floor — ${why}`,
    ).toBeGreaterThanOrEqual(floor);
  });
});

// ─── Part (b): the source, so a revert goes red ───────────────────────────────

const SKIP_DIR = new Set(["node_modules", ".next", "mocks"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.has(entry)) out.push(...walk(full));
    } else if (/\.(tsx?|mdx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES = walk(SRC).map((f) => ({
  rel: relative(REPO, f).replace(/\\/g, "/"),
  text: readFileSync(f, "utf8"),
}));

/** Report every `file:line  <line>` matching a predicate, for a readable failure. */
function hits(re: RegExp): string[] {
  const out: string[] = [];
  for (const { rel, text } of SOURCES) {
    text.split(/\r?\n/).forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line)) out.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
    });
  }
  return out;
}

describe("the failing pairs cannot come back", () => {
  it("never assigns --amber / #B36D14 to a text colour", () => {
    // --amber (#B36D14) is 3.65:1 on --amber-soft, 4.11:1 on white and 3.83:1 on
    // --bg: it fails the 4.5:1 text floor on EVERY light surface this app has.
    // globals.css says so itself. It stays legal for dots, borders, strokes and
    // fills (non-text, ≥3:1) — this rule is scoped to `color:` and `fg:` only.
    const found = hits(/\b(?:color|fg)\s*:\s*(?:[^,;}\n]*\?\s*)?["'`](?:var\(--amber\)|#B36D14)["'`]/i);
    expect(found, `use var(--amber-text) / #8A5310 instead:\n${found.join("\n")}`).toEqual([]);
  });

  it("never assigns the one-off #9A6B00 to a text colour", () => {
    // The near-miss amber, and never a token: #9A6B00 on the #FFF7E6 chip fill is
    // 4.3999:1, under the 4.5:1 NORMAL-text floor — WCAG large text starts at
    // 18.66px bold, so the 9px/700 and 10.5px/700 chips it painted were all normal
    // text. --amber-text (#8A5310) is 5.9237:1 on the same fill.
    //
    // This is a source rule rather than a comment because the count is the lesson:
    // five copies existed, four were fixed, and the fifth (WorkshopStatusBar's
    // "fields need a source" chip) survived every gate — axe only scans the ten
    // screens in tests/e2e/coreScreens.ts, and check-tokens.mjs reads source text,
    // not contrast. Neither could see it.
    const found = hits(/\b(?:color|fg)\s*:\s*(?:[^,;}\n]*\?\s*)?["'`]#9A6B00["'`]/i);
    expect(found, `use var(--amber-text) / #8A5310 instead:\n${found.join("\n")}`).toEqual([]);
  });

  it("has deleted the banned emerald #28C55E", () => {
    // docs/design-system/11-unified-page-rules.md bans the retired emerald
    // greens. It shipped as the focus-visible ring on all 46 help articles at
    // 2.27:1 against a 3:1 non-text floor.
    const found = hits(/#28C55E/i);
    expect(found, `banned colour — see 11-unified-page-rules.md:\n${found.join("\n")}`).toEqual([]);
  });

  it("never puts white text on --brand-green / #2E8E3A", () => {
    // 4.1613:1. --brand-green-btn (#297F34, 5.02:1) is the founder-approved
    // solid fill under white text; --brand-green stays for text/icons/dots on
    // LIGHT surfaces, where it is the foreground rather than the background.
    const found = hits(
      /background\s*:\s*[^,;}\n]*(?:var\(--brand-green\)|#2E8E3A)[^\n]*\bcolor\s*:\s*["'`](?:#FFF(?:FFF)?|var\(--surface[,)])/i,
    );
    expect(found, `use var(--brand-green-btn):\n${found.join("\n")}`).toEqual([]);
  });
});

describe("the specific sites the refutation measured", () => {
  const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

  it("settings' billing-gate notice uses the amber TEXT token", () => {
    const src = read("src/app/(app)/settings/page.tsx");
    expect(src).toContain(`background: "var(--amber-soft)", color: "var(--amber-text)"`);
  });

  it("the webhooks primary action rests on the AA button green, not --brand-green", () => {
    const src = read("src/app/(app)/operations/webhooks/page.tsx");
    expect(src).not.toMatch(/style\.background = "var\(--brand-green\)"/);
    expect(src).toContain(`background: "var(--brand-green-btn)"`);
  });

  it("the settings API-key Copy button rests on the AA button green", () => {
    const src = read("src/app/(app)/settings/page.tsx");
    expect(src).toContain(`background: "var(--brand-green-btn)", color: "#FFFFFF"`);
  });

  it("both admin modals draw the error row on the danger TOKENS", () => {
    // Only the error ROW was failing: #C53A3A on #FBE3E3 is 4.2567:1 at 12.5px.
    // The same red on WHITE (elsewhere in CreateInvoiceModal) is 5.1975:1 and is
    // left alone — this asserts the failing PAIR is gone, not the hex.
    for (const rel of [
      "src/app/(app)/admin/AdjustLimitsModal.tsx",
      "src/app/(app)/admin/CreateInvoiceModal.tsx",
    ]) {
      const src = read(rel);
      expect(src, `${rel} still draws the stale soft-red fill`).not.toContain(`background: "#FBE3E3"`);
      expect(src).toContain(`background: "var(--danger-soft)", border: "1px solid #F0B4B4", color: "var(--danger)"`);
    }
  });

  it("the how-it-works eyebrow dot uses the navy-legible blue", () => {
    const src = read("src/app/(marketing)/how-it-works/page.tsx");
    // WP-30 aliased BLUE_NODE onto --brand-blue, which is 2.89:1 on the dark
    // pill. --brand-blue-bright exists for exactly this and is 6.28:1.
    expect(src).toContain(`var(--brand-blue-bright)`);
    expect(src).not.toMatch(/const BLUE_NODE\b/);
  });

  it("the help-article shell rings in a token green, not an arbitrary hex", () => {
    const src = read("src/components/help/HelpArticleShell.tsx");
    expect(src).toContain("focus-visible:ring-brand-green-deep");
  });
});
