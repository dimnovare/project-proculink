import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The in-app standards screen may not offer a gated format with no tier on it.
//
// THE DEFECT THIS PINS, verbatim. The direction line read:
//
//   ProcuLink produces {asList(EMITTED_LABELS)}.
//
// which rendered "ProcuLink produces cXML 1.2, UBL 2.1 and X12." — flat, on a page that
// names no tier anywhere else. `EMITTED_LABELS` derives from `catalog.ts.transform ===
// "supported"`, an honest TECHNICAL filter: can ProcuLink build this document? It carries
// no COMMERCIAL one. cXML output is refused below Operations
// (`BillingGateErrors.RequiredFeatures`, mirrored in MINIMUM_PLAN.cxml), so the sentence
// offered a Growth org a capability the API declines when they save the delivery config.
// The chooser bullet above it had the same hole.
//
// ── Why this test renders the page instead of scanning it ────────────────────
//
// `gatedCapabilityClaims.test.ts` already owns the scan-based guards, and they could not
// have caught this at any corpus width. Their matcher works on literal text in a single
// source line, and neither offending string exists in this file: the direction line is
// assembled from `asList(EMITTED_LABELS)` at render time and contains no format's name in
// the source, while the chooser bullet names cXML but carries no output verb within reach
// and is not a markdown table row. Widening that corpus to `src/app/(app)` would have
// added six false positives on delivery-protocol label maps and still found this defect
// zero times — the guard's blind spot is its EXTRACTOR, not its directory list.
//
// So this asks the rendered screen, which is the only place the sentence exists.

import StandardsPage from "./page";
import {
  EMITTED_COLUMNS as EMITTED,
  GATED_EMITTED_COLUMNS as EMITTED_AND_GATED,
  READ_ONLY_COLUMNS,
  REF_COLUMNS,
  UNGATED_EMITTED_COLUMNS as EMITTED_AND_FREE,
  emits,
  gateFor,
  gateIsMirrored,
} from "./refColumns";
import { MINIMUM_PLAN, requiresPlan } from "@/lib/gatedCapabilities";

afterEach(cleanup);

const PAGE_REL = "src/app/(app)/library/standards/page.tsx";
const COLUMNS_REL = "src/app/(app)/library/standards/refColumns.ts";

/** Everything the screen says, as one string — the copy is split across several elements. */
function renderedText(): string {
  render(<StandardsPage />);
  return document.body.textContent ?? "";
}

// ── Anti-vacuity ─────────────────────────────────────────────────────────────
//
// Every sweep below iterates a filtered column list. An empty list satisfies each of them
// for free, and both filters read registries this file does not own — so if the catalog
// flipped cXML to unsupported, or the gate table dropped it, the sweeps would go quietly
// green while proving nothing.

describe("the sets being swept are real", () => {
  it("has emitted formats, at least one of them gated", () => {
    expect(EMITTED.length, "the page presents no emitted format at all").toBeGreaterThan(2);
    expect(
      EMITTED_AND_GATED.length,
      "no emitted column carries a gate — the disclosure sweep below would pass vacuously",
    ).toBeGreaterThan(0);
    expect(
      EMITTED_AND_FREE.length,
      "every emitted column is gated — the over-disclosure sweep below would pass vacuously",
    ).toBeGreaterThan(0);
  });

  it("is gated on cXML specifically, which is the format that shipped untiered", () => {
    const cxml = REF_COLUMNS.find((c) => c.catalogId === "cxml-1-2");
    expect(cxml, "the cXML column disappeared from the matrix").toBeDefined();
    expect(emits(cxml!.catalogId), "the catalog no longer says ProcuLink emits cXML").toBe(true);
    expect(gateFor(cxml!.catalogId), "the cXML column no longer names its gate").toBe("cxml");
    expect(MINIMUM_PLAN.cxml, "cXML is no longer gated at Operations").toBe("operations");
  });

  it("every gate it names is one the mirrored table really carries", () => {
    // A capability with no row in MINIMUM_PLAN would make `requiresPlan()` throw at render,
    // or — worse — resolve to undefined and print a tierless sentence again.
    for (const column of EMITTED_AND_GATED) {
      expect(
        gateIsMirrored(gateFor(column.catalogId)!),
        `${column.label} names a gate src/lib/gatedCapabilities.ts does not mirror`,
      ).toBe(true);
    }
  });

  it("renders the copy this test reads", () => {
    // Guards every assertion below against a render that produced nothing at all.
    const text = renderedText();
    expect(text).toContain("ProcuLink produces");
    for (const column of EMITTED) expect(text).toContain(column.label);
  });
});

// ── The defect itself ────────────────────────────────────────────────────────

describe("every gated format it offers carries its tier", () => {
  it.each(EMITTED_AND_GATED)("$label states the plan it starts on", (column) => {
    const text = renderedText();
    const disclosure = requiresPlan(gateFor(column.catalogId)!);

    expect(
      text,
      `the screen offers ${column.label} as a format ProcuLink produces and never says it ` +
        `needs ${disclosure}. On a page that names no tier anywhere, that reads as included ` +
        "on every plan — and the API refuses the delivery config.",
    ).toContain(disclosure);
  });

  it("says it where the format is chosen, not only once on the page", () => {
    // The "which format?" list is where a reader decides. Its other options are on every
    // plan, so cXML sitting among them untiered is a recommendation to pick it.
    render(<StandardsPage />);
    const chooserItem = screen
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("punchout"));
    expect(chooserItem, "the cXML chooser bullet is gone").toBeDefined();
    expect(chooserItem!.textContent).toContain(requiresPlan("cxml"));
  });

  it("derives the tier rather than spelling it out", () => {
    // A tier typed into these files rots the day cXML is re-tiered — the defect one level up,
    // and the reason `requiresPlan()` exists at all. Pinned by MECHANISM, the same way the
    // direction marker is pinned in gatedCapabilityClaims.test.ts: the tier must come from the
    // mirrored gate table, so re-tiering moves this copy without anyone editing the screen.
    const page = readFileSync(join(process.cwd(), PAGE_REL), "utf8");
    const columns = readFileSync(join(process.cwd(), COLUMNS_REL), "utf8");

    expect(page, `${PAGE_REL} must import the gate table to name a tier`).toMatch(
      /import\s*\{[^}]*\brequiresPlan\b[^}]*\}\s*from\s*"@\/lib\/gatedCapabilities"/,
    );
    expect(columns, "and the gated columns must say which capability gates them").toMatch(
      /GATED_STANDARD_OUTPUT[\s\S]{0,200}"cxml-1-2":\s*"cxml"/,
    );
    // No tier name may be typed into either file's copy — it has to be computed.
    expect(
      page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
      `${PAGE_REL} spells a tier out instead of deriving it`,
    ).not.toMatch(/"[^"]*\b(?:Growth|Operations|Integration|Distributor|Enterprise) plan\b/);

    // And the rendered words really are the mirror's, not a coincidence.
    expect(renderedText()).toContain(requiresPlan("cxml"));
  });
});

describe("it does not invent a tier for a format nothing gates", () => {
  it.each(EMITTED_AND_FREE)("$label is not sold behind a plan", (column) => {
    // The other direction, and the reason this cannot simply be "every format names a tier".
    // UBL and X12 are on every plan; attaching one would sell an upgrade nobody needs — the
    // same failure WP-11 fixed on the server, mirrored.
    render(<StandardsPage />);
    const sentence = screen.getByText(/ProcuLink produces/).textContent ?? "";
    const clause = new RegExp(`${column.label}[^.]{0,40}?\\bplan\\b`, "i");
    expect(
      clause.test(sentence),
      `the direction line ties ${column.label} to a plan, but nothing gates it`,
    ).toBe(false);
  });

  it("still tells the reader which formats are read-only", () => {
    // The pre-existing claim on this screen, kept honest by the same sentence.
    const text = renderedText();
    expect(READ_ONLY_COLUMNS.length).toBeGreaterThan(0);
    expect(text).toContain("read only");
    for (const column of READ_ONLY_COLUMNS) expect(text).toContain(column.label);
  });
});
