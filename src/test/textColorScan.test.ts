/**
 * textColorScan.ts — one case per spelling that evaded the regex it replaces.
 *
 * Each of the eight is asserted TWICE: the offending spelling is caught, and a
 * near-identical CONTROL that is legal is not. The controls are the point. This
 * value is banned as TEXT and legal as a border, a dot, a stroke and a gradient
 * stop (it clears the 3:1 non-text floor and fails the 4.5:1 text floor), so a
 * detector that fires on the whole file would be worse than the narrow regex —
 * it would be noise, and noise gets switched off.
 *
 * EVERY COLOUR LITERAL IN THIS FILE IS ASSEMBLED FROM PIECES. That is not
 * fussiness. Writing `text-[#B36D14]` out in a scanned file is exactly how the
 * retired emerald got back into production CSS: Tailwind's content scanner is a
 * regex over file text, it read a FIXTURE STRING out of check-tokens.test.ts, and
 * `bun run build` shipped the rule. tailwind.config.ts now excludes tests, but a
 * fixture that cannot be emitted even if that exclusion is lost is a stronger
 * thing to rely on than an exclusion. scripts/check-emitted-css.mjs proves it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative } from "path";
import { scanTextColorUses, type BannedValue, type ScanFile } from "./textColorScan";

// Assembled, never spelled. See the header.
const AMBER_HEX = ["#B3", "6D", "14"].join("");
const AMBER: BannedValue = { hex: AMBER_HEX, cssVar: "--amber", utility: "amber" };

/** One in-memory file. */
const f = (rel: string, text: string): ScanFile[] => [{ rel, text }];

/** Did the scanner fire at all? */
const caught = (rel: string, text: string): boolean =>
  scanTextColorUses(f(rel, text), AMBER).length > 0;

describe("the eight spellings that evaded the one-line regex", () => {
  it("0. the baseline it DID catch still fires", () => {
    expect(caught("a.tsx", `style={{ color: "${AMBER_HEX}" }}`)).toBe(true);
  });

  it("1. variable indirection", () => {
    expect(caught("a.tsx", `const TONE = "${AMBER_HEX}";\nstyle={{ color: TONE }}`)).toBe(true);
    // CONTROL: the same binding used as a BORDER is legal.
    expect(caught("a.tsx", `const TONE = "${AMBER_HEX}";\nstyle={{ borderColor: TONE }}`)).toBe(false);
  });

  it("2. a map key that is not called `fg`", () => {
    expect(caught("a.tsx", `const t = { tone: "${AMBER_HEX}" };\nstyle={{ color: t.tone }}`)).toBe(true);
    expect(caught("a.tsx", `const t = { tone: "${AMBER_HEX}" };\nstyle={{ background: t.tone }}`)).toBe(false);
  });

  it("3. a ternary's ELSE branch", () => {
    // The old rule's optional `[^,;}\n]*\?` consumed the condition and then
    // demanded the quote immediately — so only the THEN branch could ever match.
    expect(caught("a.tsx", `style={{ color: on ? "#0B1A2F" : "${AMBER_HEX}" }}`)).toBe(true);
    expect(caught("a.tsx", `style={{ color: on ? "${AMBER_HEX}" : "#0B1A2F" }}`)).toBe(true);
    // CONTROL: neither branch is the banned value.
    expect(caught("a.tsx", `style={{ color: on ? "#0B1A2F" : "#8A5310" }}`)).toBe(false);
  });

  it("4. the text-amber utility class", () => {
    expect(caught("a.tsx", `<span className="text-amber font-semibold">x</span>`)).toBe(true);
    // CONTROL: --amber-text IS the correct token. `text-amber-text` must not match.
    expect(caught("a.tsx", `<span className="text-amber-text font-semibold">x</span>`)).toBe(false);
    expect(caught("a.tsx", `<span className="bg-amber-soft">x</span>`)).toBe(false);
    // A variant prefix is still the same class.
    expect(caught("a.tsx", `<span className="hover:text-amber">x</span>`)).toBe(true);
  });

  it("5. an arbitrary text-[…] class", () => {
    expect(caught("a.tsx", `<span className="text-[${AMBER_HEX}]">x</span>`)).toBe(true);
    // CONTROL: the same hex as a RING is non-text and legal.
    expect(caught("a.tsx", `<span className="ring-[${AMBER_HEX}]">x</span>`)).toBe(false);
  });

  it("6. the fill of an SVG <text>", () => {
    expect(caught("a.tsx", `<text x="0" y="0" fill="${AMBER_HEX}">42</text>`)).toBe(true);
    // A JSX tag spread over lines is the normal case, not the exception.
    expect(
      caught("a.tsx", `<text\n  x={0}\n  fontSize={7}\n  fill="${AMBER_HEX}"\n>\n  42\n</text>`),
    ).toBe(true);
    // CONTROL: a <circle> stroke is a shape outline, not a glyph.
    expect(caught("a.tsx", `<circle r={9} stroke="${AMBER_HEX}" />`)).toBe(false);
  });

  it("7. a template literal", () => {
    expect(caught("a.tsx", "<div style={`color:" + AMBER_HEX + "`} />")).toBe(true);
    expect(caught("a.tsx", "<div style={`border:1px solid " + AMBER_HEX + "`} />")).toBe(false);
  });

  it("8. a .css file — CSS never quotes, and the old rule demanded a quote", () => {
    expect(caught("a.css", `.notice { color: var(--amber); }`)).toBe(true);
    expect(caught("a.css", `.notice { color: var(--amber-text); }`)).toBe(false);
    // CONTROL: the dot is non-text. globals.css draws several of these legally.
    expect(caught("a.css", `.pill-review .dot { background: var(--amber); }`)).toBe(false);
    // A custom property aliased onto the banned one, then used as text.
    expect(caught("a.css", `:root { --warn: var(--amber); }\n.n { color: var(--warn); }`)).toBe(true);
  });
});

describe("comments are stripped — a colour in prose renders nothing", () => {
  // The OPPOSITE of scripts/check-tokens.mjs, which scans comments on purpose
  // (a stale palette comment IS the drift it hunts). Different question: that
  // gate asks "is this written down", this one asks "does this render".
  // Without the strip, textColorScan.ts's own header — which must describe the
  // spellings it catches — is six violations of its own rule.
  it("ignores the banned value in a line comment", () => {
    expect(caught("a.tsx", `// use color: var(--amber) here? no — see the header`)).toBe(false);
  });

  it("ignores it in a block comment, and still catches the code below", () => {
    const src = `/* color: ${AMBER_HEX} is banned as text */\nstyle={{ borderColor: "${AMBER_HEX}" }}`;
    expect(caught("a.tsx", src)).toBe(false);
    expect(caught("a.tsx", `/* nothing */\nstyle={{ color: "${AMBER_HEX}" }}`)).toBe(true);
  });

  it("still reports the line number of the REAL file, not the stripped one", () => {
    // stripComments preserves newlines precisely so this stays true.
    const src = `/*\n *\n *\n */\nstyle={{ color: "${AMBER_HEX}" }}`;
    expect(scanTextColorUses(f("a.tsx", src), AMBER)[0]?.line).toBe(5);
  });

  it("does NOT strip string literals — a fixture string is still visible", () => {
    expect(caught("a.tsx", `const fixture = 'style={{ color: "${AMBER_HEX}" }}';`)).toBe(true);
  });
});

describe("the scanner does not fire on the property names next door", () => {
  // `borderColor` / `backgroundColor` contain "color" and MUST NOT open a text
  // slot — this value is legal in both. If the lookbehind is dropped, ~40 legal
  // sites in src/components/bridge/** turn red at once.
  it.each([
    ["borderColor", `style={{ borderColor: "${AMBER_HEX}" }}`],
    ["backgroundColor", `style={{ backgroundColor: "${AMBER_HEX}" }}`],
    ["background shorthand", `style={{ background: "${AMBER_HEX}" }}`],
    ["a border shorthand", `style={{ border: "1px solid ${AMBER_HEX}" }}`],
    ["an SVG gradient stop", `<stop offset="60%" stopColor="${AMBER_HEX}" />`],
    ["a sibling property on the same line", `{ color: "#8A5310", background: "${AMBER_HEX}" }`],
  ])("%s is not a text slot", (_name, src) => {
    expect(caught("a.tsx", src)).toBe(false);
  });
});

const REPO = resolve(__dirname, "../..");
const SKIP = new Set(["node_modules", ".next", "mocks"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP.has(entry)) out.push(...walk(full));
    } else if (/\.(tsx?|mdx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES: ScanFile[] = walk(join(REPO, "src")).map((full) => ({
  rel: relative(REPO, full).replace(/\\/g, "/"),
  text: readFileSync(full, "utf8"),
}));

/** An exemption, matched by LINE CONTENT so it goes stale instead of drifting. */
interface Exemption {
  rel: string;
  contains: string;
  reason: string;
}

describe("the real tree — the amber family", () => {
  /**
   * globals.css DEFINES `--amber`. `--amber: #B36D14;` is a custom-property
   * declaration, which `boundNames` correctly reads as an alias — the definition
   * site cannot avoid naming the value. Nothing else is exempt at file level.
   */
  const allow = (rel: string) => rel === "src/app/globals.css";

  /**
   * The scanner's known blind spot, written down rather than tuned away.
   *
   * A property SPELLED `color` is not always a glyph colour: this app keeps tone
   * maps whose `color` field is consumed as a `background`, and passes `color` to
   * lucide icons, where it becomes an SVG `currentColor` STROKE. Both are non-text
   * (a 3:1 floor, which #B36D14 clears at 4.1061:1 on white) and both are legal.
   * No source-text scanner can tell them from real text without following the
   * value to its consumer.
   *
   * MATCHED BY LINE CONTENT, NOT LINE NUMBER, and the match is asserted below. An
   * exemption whose line has changed goes STALE and turns the suite red instead of
   * quietly absolving whatever replaced it — which is the failure mode a
   * `file:line` list has, and the reason the token gate's own baseline is a
   * counted ledger rather than a set of paths.
   */
  const EXEMPT: Exemption[] = [
    {
      rel: "src/components/bridge/BridgeDashboard.tsx",
      contains: `{ key: "review",    label: "Needs review",  value: countBlocked,   color: AMBER },`,
      reason:
        "a stat-row RECORD field. Its only consumer renders `background: s.color` " +
        "on an 8×8px dot — never a glyph. The label beside it is #5E6779.",
    },
    {
      rel: "src/components/bridge/BridgeDashboard.tsx",
      contains: `{ label: "Needs review", value: countBlocked,   color: AMBER },`,
      reason:
        "a proportion-bar SEGMENT field, consumed as `background: s.color` on the " +
        "bar and on the 8×8px legend square. Its `<b>` count is #0B1A2F.",
    },
    {
      rel: "src/components/bridge/BridgeDashboard.tsx",
      contains: `<AlertTriangle size={12} strokeWidth={2.25} style={{ color: AMBER, flexShrink: 0 }} aria-hidden />`,
      reason:
        "a lucide icon: `color` becomes the SVG currentColor STROKE, not text. It " +
        "is aria-hidden and the sentence it decorates is #0B1A2F at 12px.",
    },
  ];

  const exempted = (h: { rel: string; text: string }) =>
    EXEMPT.some((e) => e.rel === h.rel && h.text.includes(e.contains.trim()));

  it("every exemption still matches a real line — a stale one is a failure", () => {
    // Without this, an exemption outlives the code it was written for and starts
    // forgiving something nobody reviewed.
    const stale = EXEMPT.filter(
      (e) => !SOURCES.find((s) => s.rel === e.rel)?.text.includes(e.contains),
    );
    expect(
      stale.map((e) => `${e.rel} no longer contains: ${e.contains}`),
      "re-read the site and either delete the exemption or restate its reason",
    ).toEqual([]);
  });

  it("has no text use of --amber / the raw amber hex anywhere under src/", () => {
    const found = scanTextColorUses(SOURCES, AMBER, allow).filter((h) => !exempted(h));
    expect(
      found.map((h) => `${h.rel}:${h.line}  [${h.spelling}]  ${h.text}`),
      "use --amber-text (#8A5310). --amber is 3.65:1 on --amber-soft, 4.11:1 on\n" +
        "white and 3.83:1 on --bg: it fails the 4.5:1 text floor on every light\n" +
        "surface this app has. It stays legal for dots, borders, strokes and fills.",
    ).toEqual([]);
  });

  it("the exemptions are load-bearing — each one really is being forgiven", () => {
    // If the scanner quietly stopped finding these sites, EXEMPT would be
    // forgiving nothing, the assertion above would pass for the wrong reason,
    // and the next person would trust a rule that had stopped working. Asserting
    // that the unfiltered scan finds EXACTLY the exempted sites pins both halves:
    // the scanner still fires on them, and nothing else is hiding behind them.
    const raw = scanTextColorUses(SOURCES, AMBER, allow);
    expect(raw.every((h) => exempted(h))).toBe(true);
    expect(raw.length).toBe(EXEMPT.length);
  });

  it("scans a tree big enough for that to mean something", () => {
    // A pass over an empty file list is the classic vacuous green. The repo has
    // ~400 source files; if this collapses, the assertion above proves nothing.
    expect(SOURCES.length).toBeGreaterThan(300);
    expect(SOURCES.filter((s) => s.rel.endsWith(".css")).length).toBeGreaterThan(0);
  });
});

/**
 * The GREEN family — the second systemic cause, and the one nobody had named.
 *
 * `--brand-green` `#2E8E3A` is to green what `--amber` is to amber: the NON-TEXT
 * member. 4.1613:1 on white, 3.8846:1 on `--bg`. globals.css had already learned
 * this lesson once and shipped `--amber-text`; nothing had drawn the conclusion
 * for green, so ~20 sites were painting copy in it. `--brand-green-deep`
 * `#1E6D29` already existed and is the answer — no new token.
 *
 * THE SCOPE IS NARROWER THAN THE AMBER RULE, DELIBERATELY, and saying why is the
 * point of this comment. `src/components/**` (plus `src/mdx-components.tsx`) is
 * the region this packet AUDITED and swept. `src/app/**` was not: a probe run for
 * this round found green text sites in `(home)/page.tsx`, `one-pager`,
 * `global-error.tsx`, `not-found.tsx` and `AnimatedPipelinePanel.tsx` that nobody
 * has measured. Turning the rule on there would either fail CI or force a sweep
 * this change is not doing.
 *
 * So it is a RATCHET, in the same shape as check-tokens.mjs's baseline: the swept
 * region cannot regress, the unswept region is named out loud rather than
 * silently included. What it must never be read as is "green text is fine in
 * src/app" — round 2 was refuted for exactly that move, treating a region the
 * ledger did not cover as a region the ledger absolved.
 */
const GREEN: BannedValue = {
  hex: ["#2E", "8E", "3A"].join(""),
  cssVar: "--brand-green",
  utility: "brand-green",
};

describe("the real tree — the green family", () => {
  /** The region this packet audited. See the note above for why it is not all of src/. */
  const SWEPT = (rel: string) =>
    rel.startsWith("src/components/") || rel === "src/mdx-components.tsx";
  const IN_SCOPE = SOURCES.filter((s) => SWEPT(s.rel));

  /**
   * CommandPalette is exempt at FILE level, and the thing that makes that safe is
   * asserted separately below rather than asserted here.
   *
   * Every `color` in it is a `CmdItem` FILL: it is painted as `${item.color}18`,
   * a 9.4%-alpha chip tint (non-text, 3:1), and the glyph on top of it goes
   * through `glyphColor()`, which maps each fill to its AA-legible text sibling.
   * Four separate `contains` entries would be four copies of one fact, and a list
   * that repeats itself is a list nobody re-reads. The file-level exemption is
   * paired with a test that the MAPPING IS STILL WIRED — if `glyphColor` is
   * removed from the glyph, the exemption stops being true and the suite says so.
   */
  const allow = (rel: string) => rel === "src/components/bridge/CommandPalette.tsx";

  /**
   * Same blind spot as the amber list, and the same shape of entry: a `color:`
   * that is really an icon stroke or a fill.
   *
   * A STRUCTURAL SHORTCUT WAS CONSIDERED AND REJECTED. Every icon case here is a
   * SELF-CLOSING JSX element, which renders no text of its own, so "skip `color:`
   * inside a self-closing tag" would delete most of this list. It was not taken:
   * a self-closing CUSTOM component can render text internally and inherit that
   * `color`, so the shortcut would create a silent blind spot — and a silent
   * blind spot is precisely the class of defect this packet has now been refuted
   * for twice. Ten reviewable lines that each state a checked fact are the
   * cheaper mistake.
   */
  const EXEMPT: Exemption[] = [
    {
      rel: "src/components/bridge/BridgeDashboard.tsx",
      contains: `{ key: "delivered", label: "Delivered",     value: countDelivered, color: GREEN },`,
      reason: "stat-row RECORD field, consumed as `background: s.color` on an 8×8px dot.",
    },
    {
      rel: "src/components/bridge/BridgeDashboard.tsx",
      contains: `{ label: "Delivered",    value: countDelivered, color: GREEN },`,
      reason: "proportion-bar SEGMENT field, consumed as `background` on the bar and legend square.",
    },
    {
      rel: "src/components/bridge/BridgeDashboard.tsx",
      contains: `<CheckCircle2 size={22} strokeWidth={2} style={{ color: GREEN }} aria-hidden />`,
      reason: "lucide icon — currentColor STROKE, aria-hidden, non-text 3:1 floor.",
    },
    {
      rel: "src/components/bridge/ConnectorRequirementsPanel.tsx",
      contains: `<Info size={13} style={{ color: "#2E8E3A", flexShrink: 0 }} aria-hidden="true" />`,
      reason: "lucide icon — currentColor STROKE, aria-hidden, non-text 3:1 floor.",
    },
    {
      rel: "src/components/bridge/OrgSwitcher.tsx",
      contains: `<Check size={15} strokeWidth={2.4} style={{ color: "#2E8E3A", flexShrink: 0 }}`,
      reason: "lucide icon — currentColor STROKE, non-text 3:1 floor.",
    },
    {
      rel: "src/components/bridge/OrderPassport.tsx",
      contains: `fontSize: 9, fontWeight: 800, color: n.state === "current" ? s.ring : "#FFFFFF",`,
      reason:
        "the scanner's documented map-index blind spot showing up as a FALSE POSITIVE " +
        "rather than a miss: it matched `s.ring` because STATE_STYLE binds a `ring` key " +
        "to #2E8E3A, but this branch only reads `ring` when state is `current`, where " +
        "ring is #1E66C9 on a #FFFFFF fill (5.5275:1). The genuinely tight pair here was " +
        "the OTHER branch — white on `done.fill` at 4.1613:1 — and that fill is now " +
        "--brand-green-btn #297F34, 5.0244:1. Left as an exemption rather than worked " +
        "around, because the limitation is real and pretending otherwise is the bug.",
    },
  ];

  /** The assertion that earns CommandPalette its file-level exemption. */
  it("CommandPalette still routes the glyph through glyphColor", () => {
    const src = SOURCES.find((s) => s.rel === "src/components/bridge/CommandPalette.tsx");
    expect(src, "CommandPalette.tsx not found — the exemption above is now blind").toBeDefined();
    // The chip fill stays on the raw value; the GLYPH must not.
    expect(src!.text).toContain("background: `${item.color ?? \"#2E8E3A\"}18`");
    expect(src!.text).toContain('color: glyphColor(item.color ?? "#2E8E3A"),');
    // And the map must cover all three families the palette actually paints —
    // green was the one the sweep was scoped to, amber was 3.6662:1 and blue
    // 4.4231:1 on the active row.
    for (const pair of ['"#2E8E3A": "#1E6D29"', '"#B36D14": "#8A5310"', '"#1E66C9": "#0F4FA8"']) {
      expect(src!.text, `glyphColor no longer maps ${pair}`).toContain(pair);
    }
  });

  const exempted = (h: { rel: string; text: string }) =>
    EXEMPT.some((e) => e.rel === h.rel && h.text.includes(e.contains.trim()));

  it("every exemption still matches a real line — a stale one is a failure", () => {
    const stale = EXEMPT.filter(
      (e) => !SOURCES.find((s) => s.rel === e.rel)?.text.includes(e.contains),
    );
    expect(
      stale.map((e) => `${e.rel} no longer contains: ${e.contains}`),
      "re-read the site and either delete the exemption or restate its reason",
    ).toEqual([]);
  });

  it("has no text use of --brand-green in the swept region", () => {
    const found = scanTextColorUses(IN_SCOPE, GREEN, allow).filter((h) => !exempted(h));
    expect(
      found.map((h) => `${h.rel}:${h.line}  [${h.spelling}]  ${h.text}`),
      "use --brand-green-deep (#1E6D29, 6.4128:1 on white). --brand-green is\n" +
        "4.1613:1 on white and 3.8846:1 on --bg — under the 4.5:1 text floor on\n" +
        "both. It stays legal for dots, borders, strokes, fills and icons.",
    ).toEqual([]);
  });

  it("the exemptions are load-bearing — each one really is being forgiven", () => {
    const raw = scanTextColorUses(IN_SCOPE, GREEN, allow);
    expect(raw.every((h) => exempted(h))).toBe(true);
    expect(raw.length).toBe(EXEMPT.length);
  });

  it("the swept region is big enough for that pass to mean something", () => {
    expect(IN_SCOPE.length).toBeGreaterThan(100);
  });
});
