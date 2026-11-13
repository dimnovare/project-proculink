// The help centre's status glossary must name the statuses the PRODUCT renders.
//
// WHY THIS EXISTS. Two help articles teach the order lifecycle — `dashboard-and-statuses`
// (the reference) and `inbox-basics` (the queue) — and both were written against an older
// label set. The product renamed `ready` to "Ready to send" and `ready_to_deliver` to
// "Queued to send"; the articles kept teaching "Normalized" for the first and reused
// "Ready to send" for the second. An operator who read the reference learned the OPPOSITE
// of what the badge on their screen means.
//
// Nothing caught it, and nothing should have: this is CONTENT DRIFT, not an enforcement
// gap. `scripts/check-vocabulary.mjs` is green on this copy and is right to be — it polices
// the WORDS a customer may be taught, and "Normalized" is a GLOSS-tier word (legitimate
// prose, gloss on first use), not a blocked one. No gate can know that a legitimate English
// word stopped being a status name; only a comparison against the product's own registries
// can. That comparison is this file.
//
// HOW IT READS THE PRODUCT. By scanning the registry source, not by importing it. The three
// registries live in `.tsx` component modules whose import graph pulls in next/navigation,
// TanStack Table and the api client; a doc guard should not need any of that to answer
// "what words does a row print?". The scan is the same technique the vocabulary gate uses on
// the same declarations (`blockBody`, scripts/check-vocabulary.mjs), and the positive
// assertions below (every registry must yield a plausible number of labels, and the known
// labels must be present) are what keep a silently-empty scan from passing everything.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(REPO_ROOT, ...p), "utf8");

/**
 * The balanced body of `const NAME … = { … }` / `= [ … ]`. Starts AFTER the `=` because a
 * type annotation legitimately carries brackets (`const CHIPS: Array<{…}> = [`).
 */
function blockBody(src: string, name: string): string {
  const decl = new RegExp(`\\bconst\\s+${name}\\b`).exec(src);
  if (!decl) throw new Error(`${name} not found — the registry moved`);
  let i = decl.index;
  while (i < src.length && !(src[i] === "=" && src[i + 1] !== "=" && src[i + 1] !== ">")) i += 1;
  while (i < src.length && src[i] !== "{" && src[i] !== "[") i += 1;
  const open = src[i];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === open) depth += 1;
    else if (src[j] === close && (depth -= 1) === 0) return src.slice(i + 1, j);
  }
  throw new Error(`${name}: unbalanced body`);
}

/** Every `label: "…"` literal in a registry block. */
function labelsIn(src: string, name: string): string[] {
  return [...blockBody(src, name).matchAll(/\blabel:\s*"([^"]+)"/g)].map((m) => m[1]);
}

// 2026-11-13: the inbox (FILTER_CHIPS, the bulk bar) and the raw-status badge
// (STATUS_META) went with the order screens, and so did the describes that compared
// the two status articles against them. The archive's collapsed set is what renders.
const STATUS_SRC = read("src", "lib", "orderArchiveStatus.ts");

/** Every word an archive row's status pill can print. */
const PRODUCT_STATUS_LABELS = new Set(labelsIn(STATUS_SRC, "STATUS_PRESENTATION"));

const DASHBOARD_MDX = read("src", "app", "(marketing)", "help", "dashboard-and-statuses", "page.mdx");
const INBOX_MDX = read("src", "app", "(marketing)", "help", "inbox-basics", "page.mdx");
const HELP_ARTICLES = read("src", "lib", "help-articles.ts");

describe("the registries this guard reads are really there", () => {
  // A scan that silently returns nothing would make every assertion below vacuous.
  it("finds a plausible number of product status labels", () => {
    expect(PRODUCT_STATUS_LABELS.size).toBeGreaterThanOrEqual(12);
  });
});

describe("no help surface teaches a status name the product retired", () => {
  // "Normalized" was `ready`'s label before the rename. It is ordinary English, so no
  // blocklist can catch it — but it is no longer a status, and the help index card is the
  // most-read place it survived.
  const RETIRED = "Normalized";

  it("the help index blurb for the status article names only live labels", () => {
    const entry = /\{\s*slug:\s*"dashboard-and-statuses"[\s\S]*?\n\s*\}/.exec(HELP_ARTICLES);
    expect(entry, "the dashboard-and-statuses entry moved").not.toBeNull();
    const blurb = /blurb:\s*"([^"]+)"/.exec(entry![0])![1];
    expect(blurb).not.toContain(RETIRED);
    // Whatever it does name must be a label a pill prints.
    for (const word of blurb.split(/,\s*|\s+and\s+/)) {
      const t = word.trim().replace(/^What\s+/, "");
      if (PRODUCT_STATUS_LABELS.has(t)) continue;
      expect(t).not.toMatch(/^[A-Z][a-z]+( to [a-z]+)?$/);
    }
  });

  it("neither status article still uses it", () => {
    expect(DASHBOARD_MDX).not.toContain(RETIRED);
    expect(INBOX_MDX).not.toContain(RETIRED);
  });
});
