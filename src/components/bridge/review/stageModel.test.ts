// stageModel unit tests — batch 9 Phase C. Covers the Context Stage pure
// helpers: zone resolution, source-snippet honesty (gate G6), the ?fix= deep
// link alias, the responsive band boundaries, the per-line rules strip
// derivations, and the mini-wire geometry contract (gate G5: anchors come from
// the EXPORTED SpineConnectors fns and can never fly to (0,0)).

import { describe, it, expect } from "vitest";
import {
  sourceZoneForCard,
  outputHeaderIdForCard,
  snippetKindForSource,
  sourceIngestLabel,
  parseFixLineParam,
  bandForWidth,
  rulesAffectingLine,
  acceptanceSummary,
  computeStageWires,
  NODE_TO_FIELD,
  type StageBox,
} from "./stageModel";
import type { OrderValidationResult, AcceptanceRule } from "@/types/procurement";

// ── Factories ────────────────────────────────────────────────────────────────

const rule = (fieldPath: string): AcceptanceRule => ({
  scope: "order",
  fieldPath,
  operator: "required",
  severity: "error",
  blockOnFail: true,
});

function validation(
  rows: Array<{ fieldPath: string; lineNumber?: number; passed?: boolean; severity?: "error" | "warning" }>,
): OrderValidationResult {
  return {
    orderId: "o1",
    passed: rows.every(r => r.passed === true),
    results: rows.map(r => ({
      rule: rule(r.fieldPath),
      passed: r.passed ?? false,
      message: `msg ${r.fieldPath}`,
      lineNumber: r.lineNumber,
      severity: r.severity ?? "error",
    })),
  };
}

// ── sourceZoneForCard / outputHeaderIdForCard ────────────────────────────────

describe("sourceZoneForCard", () => {
  it("maps every line-scoped card to the lines zone", () => {
    expect(sourceZoneForCard({ kind: "ai-suggestion", lineNumber: 2, title: "AI suggestion to review" })).toBe("lines");
    expect(sourceZoneForCard({ kind: "manual-code", lineNumber: 4, title: "Needs a supplier code" })).toBe("lines");
    expect(sourceZoneForCard({ kind: "rule-failure", lineNumber: 3, title: "quantity" })).toBe("lines");
  });

  it("maps header-level rule failures by fieldPath heuristics", () => {
    expect(sourceZoneForCard({ kind: "rule-failure", title: "currency" })).toBe("terms");
    expect(sourceZoneForCard({ kind: "rule-failure", title: "grandTotal" })).toBe("totals");
    expect(sourceZoneForCard({ kind: "rule-failure", title: "buyerName" })).toBe("parties");
    expect(sourceZoneForCard({ kind: "rule-failure", title: "supplierName" })).toBe("parties");
    expect(sourceZoneForCard({ kind: "rule-failure", title: "poNumber" })).toBe("header-meta");
    expect(sourceZoneForCard({ kind: "rule-failure", title: "orderDate" })).toBe("header-meta");
    expect(sourceZoneForCard({ kind: "rule-failure", title: "somethingElse" })).toBe("header");
  });
});

describe("outputHeaderIdForCard", () => {
  it("is null for line-scoped cards (they use the line fragment)", () => {
    expect(outputHeaderIdForCard({ kind: "ai-suggestion", lineNumber: 1, title: "x" })).toBeNull();
    expect(outputHeaderIdForCard({ kind: "rule-failure", lineNumber: 1, title: "currency" })).toBeNull();
  });

  it("maps header-level rule fieldPaths to output header fragments", () => {
    expect(outputHeaderIdForCard({ kind: "rule-failure", title: "currency" })).toBe("currency");
    expect(outputHeaderIdForCard({ kind: "rule-failure", title: "grandTotal" })).toBe("totals");
    expect(outputHeaderIdForCard({ kind: "rule-failure", title: "buyerName" })).toBe("buyer");
    expect(outputHeaderIdForCard({ kind: "rule-failure", title: "poNumber" })).toBe("po");
    expect(outputHeaderIdForCard({ kind: "rule-failure", title: "orderDate" })).toBe("date");
    expect(outputHeaderIdForCard({ kind: "rule-failure", title: "weird" })).toBeNull();
  });
});

// ── Source-snippet honesty (gate G6) ─────────────────────────────────────────

describe("snippetKindForSource", () => {
  it("treats document uploads as croppable", () => {
    expect(snippetKindForSource("orgs/x/orders/po.csv")).toBe("document");
    expect(snippetKindForSource("orgs/x/orders/po.XLSX")).toBe("document");
    expect(snippetKindForSource("orgs/x/orders/po.pdf")).toBe("document");
  });

  it("gives API/EDI-ingested orders the honest no-snippet fallback", () => {
    expect(snippetKindForSource(null)).toBe("none");
    expect(snippetKindForSource(undefined)).toBe("none");
    expect(snippetKindForSource("orgs/x/orders/po.xml")).toBe("none");
    expect(snippetKindForSource("orgs/x/orders/po.edi")).toBe("none");
    expect(snippetKindForSource("orgs/x/orders/po.x12")).toBe("none");
    expect(snippetKindForSource("orgs/x/orders/po.json")).toBe("none");
  });

  it("labels the ingestion path for the fallback copy", () => {
    expect(sourceIngestLabel(null)).toBe("the API");
    expect(sourceIngestLabel("a/b.xml")).toBe("an XML feed");
    expect(sourceIngestLabel("a/b.edi")).toBe("an EDI feed");
    expect(sourceIngestLabel("a/b.json")).toBe("a JSON feed");
    expect(sourceIngestLabel("a/b.weird")).toBe("a structured feed");
  });
});

// ── ?fix= deep-link alias ────────────────────────────────────────────────────

describe("parseFixLineParam", () => {
  const params = (m: Record<string, string>) => (k: string) => m[k] ?? null;

  it("reads &line=", () => {
    expect(parseFixLineParam(params({ line: "4" }))).toBe(4);
  });

  it("reads ?fix= as an alias", () => {
    expect(parseFixLineParam(params({ fix: "7" }))).toBe(7);
  });

  it("prefers line over fix when both are present", () => {
    expect(parseFixLineParam(params({ line: "2", fix: "9" }))).toBe(2);
  });

  it("returns null for absent or non-numeric values", () => {
    expect(parseFixLineParam(params({}))).toBeNull();
    expect(parseFixLineParam(params({ fix: "abc" }))).toBeNull();
  });
});

// ── Responsive bands ─────────────────────────────────────────────────────────

describe("bandForWidth", () => {
  it("matches the spec boundaries exactly", () => {
    expect(bandForWidth(767)).toBe("sm");
    expect(bandForWidth(768)).toBe("md");
    expect(bandForWidth(1023)).toBe("md");
    expect(bandForWidth(1024)).toBe("lg");
    expect(bandForWidth(1279)).toBe("lg");
    expect(bandForWidth(1280)).toBe("xl");
    expect(bandForWidth(1919)).toBe("xl");
    expect(bandForWidth(1920)).toBe("xxl");
  });
});

// ── Rules strip + acceptance summary ─────────────────────────────────────────

describe("rulesAffectingLine", () => {
  const v = validation([
    { fieldPath: "quantity", lineNumber: 2, passed: false },
    { fieldPath: "unitPrice", lineNumber: 2, passed: true },
    { fieldPath: "quantity", lineNumber: 3, passed: false },
    { fieldPath: "currency", passed: false }, // header-level — excluded
  ]);

  it("returns only the given line's results (header rules excluded)", () => {
    const rows = rulesAffectingLine(v, 2);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.fieldPath)).toEqual(["quantity", "unitPrice"]);
    expect(rows[0].passed).toBe(false);
    expect(rows[1].passed).toBe(true);
  });

  it("is empty without a validation run or a line number", () => {
    expect(rulesAffectingLine(null, 2)).toEqual([]);
    expect(rulesAffectingLine(v, null)).toEqual([]);
    expect(rulesAffectingLine(v, 99)).toEqual([]);
  });
});

describe("acceptanceSummary", () => {
  it("is null before any validation run (never fabricates a pass)", () => {
    expect(acceptanceSummary(null)).toBeNull();
    expect(acceptanceSummary(undefined)).toBeNull();
  });

  it("counts passed/failed/total from the real result", () => {
    const v = validation([
      { fieldPath: "a", passed: true },
      { fieldPath: "b", passed: false },
      { fieldPath: "c", passed: false },
    ]);
    expect(acceptanceSummary(v)).toEqual({ passed: 1, failed: 2, total: 3 });
  });
});

// ── Mini-wire geometry (gate G5 contract) ────────────────────────────────────

const box = (top: number, bottom: number, left: number, right: number): StageBox => ({ top, bottom, left, right });

describe("computeStageWires", () => {
  it("draws src + out wires anchored INSIDE the upstream panels (never (0,0))", () => {
    // Side-by-side panels (xxl layout): source 0–200px, canonical 250–450, output 500–700.
    const wires = computeStageWires(
      { source: box(10, 110, 0, 200), canonical: box(10, 160, 250, 450), output: box(10, 130, 500, 700) },
      26, // canonical anchor y
    );
    expect(wires.map(w => w.wire.id)).toEqual(["src", "out"]);

    const src = wires[0].wire;
    // fallbackSourceAnchor contract: pinned to the upstream panel's right edge,
    // level with the downstream anchor, clamped inside the panel.
    expect(src.sx).toBe(200);
    expect(src.sy).toBe(26);
    expect(src.tx).toBe(250);
    expect(src.ty).toBe(26);

    const out = wires[1].wire;
    expect(out.sx).toBe(450);
    // The out-wire now shares the canonical-row anchorY (26) with the src-wire, NOT the output
    // panel's centre (70) — so source → canonical-row → output reads at a single height.
    expect(out.sy).toBe(26);
    expect(out.tx).toBe(500);
    expect(out.ty).toBe(26);
    // Both wires meet the canonical box at exactly ONE height (no dead vertical space).
    expect(out.sy).toBe(src.ty);
  });

  it("clamps the anchor to the panel edge when the target y is outside it (stacked)", () => {
    // Stacked: canonical sits BELOW the source panel; anchor y 300 > source.bottom 110.
    const wires = computeStageWires(
      { source: box(10, 110, 11, 11), canonical: box(284, 400, 11, 11) },
      300,
    );
    expect(wires).toHaveLength(1);
    const src = wires[0].wire;
    expect(src.sy).toBe(110); // clamped to the source panel's bottom — never 0
    expect(src.sx).toBe(11);
  });

  it("skips wires for missing or zero-area panels instead of drawing to (0,0)", () => {
    expect(computeStageWires({ source: null, canonical: box(0, 100, 0, 100), output: null }, 50)).toHaveLength(0);
    expect(
      computeStageWires(
        { source: box(0, 0, 0, 0), canonical: box(0, 100, 0, 100), output: box(120, 200, 0, 100) },
        50,
      ).map(w => w.wire.id),
    ).toEqual(["out"]);
  });

  it("paints the hovered wire last (orderWiresForRender contract)", () => {
    const wires = computeStageWires(
      { source: box(10, 110, 0, 200), canonical: box(10, 160, 250, 450), output: box(10, 130, 500, 700) },
      26,
      "src",
    );
    expect(wires.map(w => w.wire.id)).toEqual(["out", "src"]);
    // Original indices preserved for stable animation timing.
    expect(wires.find(w => w.wire.id === "src")?.oi).toBe(0);
  });
});

// ── NODE_TO_FIELD (moved from SpineReview — guard the join keys) ─────────────

describe("NODE_TO_FIELD", () => {
  it("keeps the canonical-field join keys the classic spine relies on", () => {
    expect(NODE_TO_FIELD).toEqual({
      po: "PoNumber",
      date: "OrderDate",
      buyer: "BuyerName",
      currency: "Currency",
      lines: "Lines",
    });
  });
});
