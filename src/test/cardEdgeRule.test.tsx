/**
 * cardEdgeRule.test.tsx — the rule the card edge is applied by.
 *
 * scripts/check-cards.mjs pins the SHAPE (one card component, no new hand-rolled
 * card divs). It cannot pin the MEANING: a source scanner has no idea whether a
 * given card is about the buyer or the supplier. This file pins the meaning.
 *
 * Four things are asserted, and the fourth is the one that catches a real drift.
 *
 *  1. THE PAINT. Card renders exactly one 3px strip, in the token for its edge,
 *     and renders none at all for `none`. Catches someone rewiring EDGE_COLOR.
 *  2. THE VOCABULARY. `edge` only ever takes blue / green / bridge / none across
 *     the whole tree. Catches `edge="amber"` coming back — the tone-as-edge
 *     mistake that made this signature meaningless the first time (BOTH real
 *     XCard call sites in the tree before the migration passed color="amber").
 *  3. THE PROPORTION. A large share of cards carry NO edge. This is the
 *     founder's rule stated as an invariant: "an edge that appears everywhere
 *     carries no information." If someone edges every card to make the app look
 *     busier, this fails.
 *  4. THE ANCHORS. A handful of cards whose side is not debatable are pinned to
 *     their edge — keyed by the USER-VISIBLE COPY inside them, never by line
 *     number or ordinal. Copy is the thing that makes the verdict obvious to a
 *     reader, so it is also the right key: it survives refactors, and if the
 *     copy changes so much that the anchor stops matching, the anchor SHOULD be
 *     re-derived rather than silently passing.
 *
 * ANTI-VACUITY. Every sweep below asserts a floor on what it EXTRACTED, not on
 * files it listed. `all()` over an empty set is true, and a scanner that walks
 * the tree and matches nothing is indistinguishable from a compliant tree.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { Card } from "@/components/bridge/layout/Card";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const EDGES = ["blue", "green", "bridge", "none"] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e !== "node_modules" && e !== ".next") out.push(...walk(full));
    } else if (/\.tsx$/.test(e) && !/\.test\.tsx$/.test(e)) out.push(full);
  }
  return out;
}

/**
 * Every `<Card …>` opening tag, brace- and quote-aware. A naive `<Card[^>]*>`
 * ends at the first `>` inside a JSX expression or a quoted aria-label and never
 * reaches the edge prop — the same failure check-tokens.mjs documents for
 * `<button`, so the same technique is used.
 */
function cardTags(src: string): string[] {
  const out: string[] = [];
  const re = /<Card\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let i = m.index; i < src.length; i += 1) {
      const ch = src[i];
      if (quote !== null) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) continue;
    out.push(src.slice(m.index, end + 1));
  }
  return out;
}

const FILES = walk(SRC);
const ALL_TAGS: { rel: string; tag: string }[] = [];
for (const f of FILES) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  if (rel.endsWith("src/components/bridge/layout/Card.tsx")) continue; // the definition
  for (const tag of cardTags(readFileSync(f, "utf8"))) ALL_TAGS.push({ rel, tag });
}
const edgeOf = (tag: string): string => {
  const m = /\bedge\s*=\s*"([a-z]+)"/.exec(tag);
  return m ? m[1] : "none";
};

describe("the card edge is painted from the token, per edge", () => {
  it("renders one strip in the right colour, and none for `none`", () => {
    for (const edge of ["blue", "green", "bridge"] as const) {
      const { container, unmount } = render(<Card edge={edge}>x</Card>);
      const strips = container.querySelectorAll("span[aria-hidden]");
      expect(strips, `edge="${edge}" paints exactly one strip`).toHaveLength(1);
      // Read the INLINE STYLE ATTRIBUTE, not the parsed CSSOM: jsdom's
      // CSSStyleDeclaration drops any value containing var(), so
      // `.style.width` comes back as "" and an assertion against it would
      // pass or fail for a reason that has nothing to do with the component.
      const style = (strips[0] as HTMLElement).getAttribute("style") ?? "";
      expect(style, "the strip width comes from --card-edge").toContain("width: var(--card-edge)");
      expect(style).toContain(
        edge === "bridge" ? "--gradient-link-spine" : edge === "blue" ? "--brand-blue" : "--brand-green",
      );
      unmount();
    }
    const { container } = render(<Card>x</Card>);
    expect(container.querySelectorAll("span[aria-hidden]")).toHaveLength(0);
  });

  it("the edge never changes the content box — it is paint, not layout", () => {
    // The whole migration rests on this: adding an edge to ~40 existing cards
    // had to be a zero-reflow change.
    const plain = render(<Card pad={12}>x</Card>);
    const edged = render(
      <Card pad={12} edge="green">
        x
      </Card>,
    );
    const p = (plain.container.firstChild as HTMLElement).style;
    const e = (edged.container.firstChild as HTMLElement).style;
    expect(e.padding).toBe(p.padding);
    expect(e.paddingLeft).toBe(p.paddingLeft);
  });
});

describe("the edge vocabulary is exactly four values", () => {
  it("extracted a real corpus of Card usages", () => {
    // The floor. Without this every assertion below passes on an empty sweep.
    expect(ALL_TAGS.length, "Card call sites found across src/**").toBeGreaterThan(40);
  });

  it("no card carries a tone as an edge", () => {
    const bad = ALL_TAGS.filter((t) => !EDGES.includes(edgeOf(t.tag) as (typeof EDGES)[number]));
    expect(
      bad.map((b) => `${b.rel}: ${b.tag.slice(0, 90)}`),
      "edge is semantic (buyer/supplier/bridge/none). Tone belongs to <StatusNotice>.",
    ).toEqual([]);
  });

  it("Card itself defines no tone colours", () => {
    const src = readFileSync(join(SRC, "components/bridge/layout/Card.tsx"), "utf8");
    for (const tone of ["amber", "danger", "ai"]) {
      expect(src, `"${tone}" is a tone, not a side — it must not be an edge value`).not.toMatch(
        new RegExp(`^\\s*${tone}:\\s*"var\\(--`, "m"),
      );
    }
  });
});

describe("the edge means something because it is not everywhere", () => {
  it("a substantial share of cards carry no edge at all", () => {
    const edged = ALL_TAGS.filter((t) => edgeOf(t.tag) !== "none").length;
    const total = ALL_TAGS.length;
    expect(total).toBeGreaterThan(40); // floor again — this block must not pass vacuously
    // "A card whose side you cannot determine gets no edge." If this ratio ever
    // climbs past half, the edge has stopped being a claim and become decoration.
    expect(
      edged / total,
      `${edged}/${total} cards are edged — an edge on every card carries no information`,
    ).toBeLessThan(0.5);
  });

  it("all three side values are actually used — the rule is not blue-only in practice", () => {
    const used = new Set(ALL_TAGS.map((t) => edgeOf(t.tag)));
    for (const edge of ["blue", "green", "bridge"]) {
      expect(used.has(edge), `no card in the tree claims edge="${edge}"`).toBe(true);
    }
  });
});

/**
 * ANCHORS — keyed by the copy a user reads, never by line number.
 *
 * Each entry names a card whose side is not arguable, quotes the copy that makes
 * it unarguable, and pins the edge that copy demands. These are the mutation
 * targets: flip one of these edges and this file goes red.
 */
const ANCHORS: { file: string; copy: string; edge: string; why: string }[] = [
  {
    file: "src/components/connections/ConnectionDetail.tsx",
    copy: "What this supplier receives for new orders today",
    edge: "green",
    why: "the card's own subtitle says it is what goes OUT to the supplier",
  },
  {
    file: "src/components/connections/ReplayPanel.tsx",
    copy: "Test a version against recent orders",
    edge: "blue",
    why: "it replays orders that came IN; the card is about received orders",
  },
];

describe("cards whose side is unarguable carry the edge their copy demands", () => {
  it.each(ANCHORS)("$file — $why", ({ file, copy, edge }) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(src, `anchor copy not found — re-derive this anchor, do not delete it`).toContain(copy);
    const tag = cardTags(src).find((t) => t.includes(copy));
    expect(tag, `the copy is not on a <Card> tag any more — re-derive this anchor`).toBeTruthy();
    expect(edgeOf(tag as string), `"${copy}" is ${edge}-side`).toBe(edge);
  });
});
