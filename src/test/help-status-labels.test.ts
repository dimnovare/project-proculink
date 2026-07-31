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

/** `status: "…"` → `label: "…"` pairs, so a doc claim can be derived FROM A STATUS. */
function labelByStatus(src: string, name: string): Map<string, string> {
  const body = blockBody(src, name);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(\w+):\s*\{[^{}]*\blabel:\s*"([^"]+)"/g)) out.set(m[1], m[2]);
  return out;
}

const INBOX = read("src", "components", "bridge", "InboxView.tsx");
const BADGE = read("src", "components", "bridge", "UnifiedStatusBadge.tsx");
const SEND = read("src", "components", "bridge", "inboxSend.ts");

/** Every word a row's status pill can print — the collapsed set and the raw-status set. */
const STATUS_LABEL_BY_RAW = labelByStatus(BADGE, "STATUS_META");
const PRODUCT_STATUS_LABELS = new Set([
  ...labelsIn(INBOX, "STATUS_PRESENTATION"),
  ...STATUS_LABEL_BY_RAW.values(),
]);

/** The inbox filter chips, in the order the toolbar renders them. */
const CHIP_LABELS = labelsIn(INBOX, "FILTER_CHIPS");

/** Raw statuses the bulk bar may select — mirrors the backend's ClaimableForRetryFrom. */
const BULK_SELECTABLE = [...blockBody(SEND, "BULK_SELECTABLE_STATUSES").matchAll(/"([^"]+)"/g)].map(
  (m) => m[1],
);

const DASHBOARD_MDX = read("src", "app", "(marketing)", "help", "dashboard-and-statuses", "page.mdx");
const INBOX_MDX = read("src", "app", "(marketing)", "help", "inbox-basics", "page.mdx");
const HELP_ARTICLES = read("src", "lib", "help-articles.ts");

/** The first cell of every markdown table row, when that cell is a bolded label. */
function tableLabels(mdx: string, afterHeading: string, untilHeading: string): string[] {
  const start = mdx.indexOf(afterHeading);
  expect(start, `heading "${afterHeading}" not found`).toBeGreaterThan(-1);
  const rest = mdx.slice(start + afterHeading.length);
  const endAt = rest.indexOf(untilHeading);
  const section = endAt === -1 ? rest : rest.slice(0, endAt);
  return [...section.matchAll(/^\|\s*\*\*([^*]+)\*\*\s*\|/gm)].map((m) => m[1].trim());
}

describe("the registries this guard reads are really there", () => {
  // A scan that silently returns nothing would make every assertion below vacuous.
  it("finds a plausible number of product status labels and chips", () => {
    expect(PRODUCT_STATUS_LABELS.size).toBeGreaterThanOrEqual(12);
    expect(CHIP_LABELS.length).toBeGreaterThanOrEqual(5);
    expect(CHIP_LABELS[0]).toBe("All orders");
    expect(BULK_SELECTABLE).toContain("ready_to_deliver");
  });
});

describe("help/dashboard-and-statuses names only statuses the product renders", () => {
  const happy = tableLabels(DASHBOARD_MDX, "## The happy path", "## The failure states");
  const failures = tableLabels(DASHBOARD_MDX, "## The failure states", "## Delivered");

  it("every happy-path row is a label a status pill actually prints", () => {
    expect(happy.length).toBeGreaterThan(5);
    for (const label of happy) {
      expect(PRODUCT_STATUS_LABELS.has(label), `"${label}" is taught but never rendered`).toBe(true);
    }
  });

  it("every failure row is a label a status pill actually prints", () => {
    expect(failures.length).toBeGreaterThan(4);
    for (const label of failures) {
      expect(PRODUCT_STATUS_LABELS.has(label), `"${label}" is taught but never rendered`).toBe(true);
    }
  });

  it("teaches the ready ⇄ ready_to_deliver distinction the RIGHT way round", () => {
    // The two labels the product loads with opposite meanings. `ready` = checks passed,
    // NOTHING built (the human's turn); `ready_to_deliver` = output built, send pending
    // (our turn). The article inverted them, so pin the derivation, not the sentence.
    const readyLabel = STATUS_LABEL_BY_RAW.get("ready")!;
    const queuedLabel = STATUS_LABEL_BY_RAW.get("ready_to_deliver")!;
    expect(readyLabel).not.toBe(queuedLabel);
    const readyRow = new RegExp(`^\\|\\s*\\*\\*${readyLabel}\\*\\*\\s*\\|(.*)$`, "m").exec(DASHBOARD_MDX);
    const queuedRow = new RegExp(`^\\|\\s*\\*\\*${queuedLabel}\\*\\*\\s*\\|(.*)$`, "m").exec(DASHBOARD_MDX);
    expect(readyRow, `no glossary row for "${readyLabel}"`).not.toBeNull();
    expect(queuedRow, `no glossary row for "${queuedLabel}"`).not.toBeNull();
    // The output file exists on ONE side of that line and not the other.
    expect(readyRow![1]).not.toMatch(/output (file|document|artifact) exists/i);
    expect(queuedRow![1]).toMatch(/output file exists/i);
  });
});

describe("help/inbox-basics matches the queue it documents", () => {
  it("the chip table lists exactly the chips the toolbar renders, in order", () => {
    const documented = tableLabels(INBOX_MDX, "## The status filters", "## Finding an order");
    expect(documented).toEqual(CHIP_LABELS);
  });

  it("the row status-pill list names only labels a pill prints", () => {
    const listed = /Rows also carry a status pill of their own \(([^)]+)\)/.exec(INBOX_MDX);
    expect(listed, "the status-pill sentence moved").not.toBeNull();
    for (const label of listed![1].split(",").map((s) => s.trim())) {
      expect(PRODUCT_STATUS_LABELS.has(label), `"${label}" is listed but never rendered`).toBe(true);
    }
  });

  it("every 'where each status leads next' row is a real label", () => {
    const rows = tableLabels(INBOX_MDX, "## Where each status leads next", "## An empty inbox");
    expect(rows.length).toBeGreaterThan(3);
    for (const label of rows) {
      expect(PRODUCT_STATUS_LABELS.has(label), `"${label}" is taught but never rendered`).toBe(true);
    }
  });

  it("the bulk-send rule names a bulk-selectable status, never `ready`", () => {
    // Derived from BULK_SELECTABLE_STATUSES (= the backend's ClaimableForRetryFrom), so if
    // the set ever widens the doc has to follow. `ready` is NOT in it: the bulk bar posts
    // /redeliver, whose guard set does not contain `ready`, so telling an operator to
    // "Select and Send selected" a Ready to send row instructs them to do something the
    // checkbox refuses.
    const para = /## Bulk send([\s\S]*?)## Where each status/.exec(INBOX_MDX)![1];
    expect(BULK_SELECTABLE).not.toContain("ready");
    expect(para).toContain(STATUS_LABEL_BY_RAW.get("ready_to_deliver"));
    expect(para).not.toContain(STATUS_LABEL_BY_RAW.get("ready"));

    const leads = /## Where each status leads next([\s\S]*?)## An empty inbox/.exec(INBOX_MDX)![1];
    const readyRow = new RegExp(`\\*\\*${STATUS_LABEL_BY_RAW.get("ready")}\\*\\*\\s*\\|([^|]*)\\|`).exec(leads);
    expect(readyRow, "no next-step row for the ready state").not.toBeNull();
    expect(readyRow![1], "a `ready` row is not bulk-selectable").not.toMatch(/Send selected/);
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
