import { describe, it, expect } from "vitest";
import {
  buildIncomingFromOrder,
  rawExtraFieldsFromTokens,
  incomingValueIndex,
  type IncomingOrderShape,
} from "./incomingFromOrder";
import type { SourceToken } from "@/lib/api/types";

const FULL_ORDER: IncomingOrderShape = {
  poNumber: "PO-2026-001",
  orderDate: "2026-01-10",
  buyerName: "Acme Manufacturing",
  currency: "EUR",
  supplierName: "Northwind Trading OÜ",
  documentSupplierName: "Northwind Trading",
  lines: [
    { lineNumber: 1, buyerItemCode: "ACM-BOLT-001", description: "Hex bolt M8", quantity: 500, unit: "EA", unitPrice: 0.42, lineAmount: 210 },
    { lineNumber: 2, buyerItemCode: "ACM-NUT-002", description: "Hex nut M8", quantity: 500, unit: "EA", unitPrice: 0.18, lineAmount: 90 },
  ],
};

describe("buildIncomingFromOrder", () => {
  it("builds canonical fields with real values for a full order (no tokenization needed)", () => {
    const fields = buildIncomingFromOrder(FULL_ORDER);
    const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
    // Header
    expect(byId.PoNumber?.value).toBe("PO-2026-001");
    expect(byId.OrderDate?.value).toBe("2026-01-10");
    expect(byId.Currency?.value).toBe("EUR");
    expect(byId.PoNumber?.group).toBe("header");
    // Parties
    expect(byId.BuyerName?.value).toBe("Acme Manufacturing");
    expect(byId.SupplierName?.value).toBe("Northwind Trading OÜ");
    expect(byId.BuyerName?.group).toBe("parties");
    // Lines (first-line representative value)
    expect(byId.BuyerItemCode?.value).toBe("ACM-BOLT-001");
    expect(byId.Quantity?.value).toBe("500");
    expect(byId.UnitPrice?.value).toBe("0.42");
    expect(byId.BuyerItemCode?.group).toBe("line");
  });

  it("each row id IS its canonical key (so wiring => withTargetConnect(key, outputPath))", () => {
    const fields = buildIncomingFromOrder(FULL_ORDER);
    expect(fields.find((f) => f.label.startsWith("PO"))?.id).toBe("PoNumber");
    // Ids are stable canonical keys, never cell addresses.
    for (const f of fields) expect(f.id).toMatch(/^[A-Za-z]/);
  });

  it("annotates multi-line fields with the line count", () => {
    const fields = buildIncomingFromOrder(FULL_ORDER);
    const qty = fields.find((f) => f.id === "Quantity");
    expect(qty?.label).toContain("2 lines");
  });

  it("populates a PDF-style order with NO line tokenization (the bug class)", () => {
    // A PDF order: backend getSourceTokens returns [], but the parsed Order has values.
    const pdfOrder: IncomingOrderShape = {
      poNumber: "4500-PDF-9",
      orderDate: "2026-02-02",
      buyerName: "Voestalpine",
      currency: "EUR",
      supplierName: "Some Supplier",
      lines: [{ lineNumber: 1, buyerItemCode: "X-1", quantity: 10, unitPrice: 5 }],
    };
    const fields = buildIncomingFromOrder(pdfOrder);
    expect(fields.length).toBeGreaterThan(3);
    expect(fields.find((f) => f.id === "PoNumber")?.value).toBe("4500-PDF-9");
    expect(fields.find((f) => f.id === "BuyerItemCode")?.value).toBe("X-1");
  });

  it("omits header/party fields that have no value (honest, never blank rows)", () => {
    const sparse: IncomingOrderShape = { poNumber: "P1", currency: "", buyerName: null, lines: [] };
    const fields = buildIncomingFromOrder(sparse);
    const ids = fields.map((f) => f.id);
    expect(ids).toContain("PoNumber");
    expect(ids).not.toContain("Currency");
    expect(ids).not.toContain("BuyerName");
    expect(ids).not.toContain("Quantity"); // no lines
  });

  it("returns [] for a null order", () => {
    expect(buildIncomingFromOrder(null)).toEqual([]);
    expect(buildIncomingFromOrder(undefined)).toEqual([]);
  });
});

describe("rawExtraFieldsFromTokens", () => {
  const canonical = buildIncomingFromOrder(FULL_ORDER);

  it("keeps tokens that don't duplicate a canonical field", () => {
    const tokens: SourceToken[] = [
      { id: "cell:r1c9", label: "Cost Centre", value: "CC-42", group: "header" },
      { id: "cell:r1c10", label: "Internal Ref", value: "REF-9", group: "header" },
    ];
    const extras = rawExtraFieldsFromTokens(tokens, canonical);
    expect(extras.map((e) => e.label)).toEqual(["Cost Centre", "Internal Ref"]);
    expect(extras.every((e) => e.group === "raw")).toBe(true);
    // Raw tokens keep their own id (not a canonical key).
    expect(extras[0].id).toBe("cell:r1c9");
  });

  it("drops a raw token that duplicates a canonical label (case-insensitive)", () => {
    const tokens: SourceToken[] = [
      { id: "cell:x", label: "po number", value: "PO-2026-001", group: "header" },
      { id: "cell:y", label: "Warehouse", value: "WH-1", group: "header" },
    ];
    const extras = rawExtraFieldsFromTokens(tokens, canonical);
    expect(extras.map((e) => e.label)).toEqual(["Warehouse"]);
  });

  it("returns [] when there are no tokens", () => {
    expect(rawExtraFieldsFromTokens([], canonical)).toEqual([]);
    expect(rawExtraFieldsFromTokens(null, canonical)).toEqual([]);
  });
});

describe("incomingValueIndex", () => {
  it("maps id → value, first-wins", () => {
    const idx = incomingValueIndex(buildIncomingFromOrder(FULL_ORDER));
    expect(idx.get("PoNumber")).toBe("PO-2026-001");
    expect(idx.get("Quantity")).toBe("500");
  });
});
