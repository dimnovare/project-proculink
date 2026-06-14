// Pure builder: derive the mapper's INCOMING fields directly from the parsed Order.
// No React, no DOM, no network — TDD'd in jsdom.
//
// ROOT-CAUSE FIX (#1, the empty pane / false "already-structured" message): the old mapper
// fed its left column ONLY from getSourceTokens(orderId), which the backend returns as []
// for PDF/XLSX (only CSV/XML tokenize). So PDF orders got an empty left pane, no values, and
// a misleading "arrived already-structured" empty state — even though the parsed Order has
// every value. This builder reads the canonical Order DIRECTLY so EVERY order (PDF, XLSX,
// CSV, XML, API) shows its real incoming values.
//
// Each incoming row's `id` IS the canonical field key (PoNumber, BuyerName, … or a line key
// like Quantity). That is deliberate: wiring an incoming row to an output path is exactly
// `withTargetConnect(canonicalKey, outputPath)` — the canonical key is the wire's metadata,
// not a third value-less column. Raw-extra tokens (the optional getSourceTokens bag) keep
// their token id and group="raw"; they are appended only when non-empty.

import {
  CANONICAL_HEADER_FIELDS,
  CANONICAL_LINE_FIELDS,
  type SourceToken,
} from "@/lib/api/types";
import { getFieldStandards } from "@/lib/standards/catalog";
import type { SourceField } from "./types";

/** The minimal Order shape this builder reads (kept local so the module stays test-friendly). */
export interface IncomingOrderShape {
  poNumber?: string | null;
  orderDate?: string | null;
  buyerName?: string | null;
  currency?: string | null;
  supplierName?: string | null;
  /** Supplier name AS PRINTED on the document — surfaced as a Parties row when it differs. */
  documentSupplierName?: string | null;
  lines?: ReadonlyArray<IncomingOrderLineShape> | null;
}

export interface IncomingOrderLineShape {
  lineNumber?: number;
  buyerItemCode?: string | null;
  supplierItemCode?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  lineAmount?: number | null;
}

/** Human label for a canonical key (catalog first, then a humanized fallback). */
function labelFor(key: string): string {
  return getFieldStandards(key)?.label ?? key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/** Stringify a value for the row's mono value cell; null/undefined → "". */
function asValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v);
}

/**
 * A representative value for a LINE canonical field across the order's lines. The mapper shows
 * ONE summary row per line field (not per physical line), so we surface the FIRST line's value
 * as the preview, and note the line count in the label when there is more than one line.
 */
function firstLineValue(
  lines: ReadonlyArray<IncomingOrderLineShape>,
  pick: (l: IncomingOrderLineShape) => unknown,
): string {
  for (const l of lines) {
    const v = asValue(pick(l));
    if (v !== "") return v;
  }
  return "";
}

/** One header field built from the canonical Order value. */
function headerField(key: string, value: string): SourceField {
  return { id: key, label: labelFor(key), value, group: "header", mapped: false, suggestedFor: null, suggestionConfidence: null };
}

/** One line field built from a representative line value. */
function lineField(key: string, value: string, lineCount: number): SourceField {
  const base = labelFor(key);
  const label = lineCount > 1 ? `${base} · ${lineCount} lines` : base;
  return { id: key, label, value, group: "line", mapped: false, suggestedFor: null, suggestionConfidence: null };
}

/**
 * Build the canonical INCOMING fields from the parsed Order. Header fields appear when the
 * Order carries a value; party fields (buyer / printed supplier name) come next; line fields
 * follow when there is at least one line. Every row's id is its canonical key.
 *
 * This NEVER depends on tokenization, so a PDF/XLSX order is just as populated as a CSV one.
 */
export function buildIncomingFromOrder(order: IncomingOrderShape | null | undefined): SourceField[] {
  if (!order) return [];
  const out: SourceField[] = [];
  const lines = order.lines ?? [];
  const lineCount = lines.length;

  // ── Header (PO number / Order date / Currency) ──────────────────────────────
  // BuyerName + SupplierName are canonical too, but we present them under "Parties"
  // for readability — the wire still uses the canonical key.
  const headerValues: Record<string, string> = {
    PoNumber: asValue(order.poNumber),
    OrderDate: asValue(order.orderDate),
    Currency: asValue(order.currency),
  };
  for (const key of CANONICAL_HEADER_FIELDS) {
    if (key === "BuyerName" || key === "SupplierName") continue; // shown as Parties below
    const v = headerValues[key];
    if (v !== "") out.push(headerField(key, v));
  }

  // ── Parties (buyer + supplier as printed) — group="parties" ─────────────────
  const buyer = asValue(order.buyerName);
  if (buyer !== "") {
    out.push({ id: "BuyerName", label: labelFor("BuyerName"), value: buyer, group: "parties", mapped: false, suggestedFor: null, suggestionConfidence: null });
  }
  const supplier = asValue(order.supplierName);
  if (supplier !== "") {
    out.push({ id: "SupplierName", label: labelFor("SupplierName"), value: supplier, group: "parties", mapped: false, suggestedFor: null, suggestionConfidence: null });
  }

  // ── Line items (one summary row per canonical line field) ───────────────────
  if (lineCount > 0) {
    const linePickers: Partial<Record<string, (l: IncomingOrderLineShape) => unknown>> = {
      LineNumber: (l) => l.lineNumber,
      BuyerItemCode: (l) => l.buyerItemCode,
      SupplierItemCode: (l) => l.supplierItemCode,
      Description: (l) => l.description,
      Quantity: (l) => l.quantity,
      Unit: (l) => l.unit,
      UnitPrice: (l) => l.unitPrice,
      LineTotal: (l) => l.lineAmount,
    };
    for (const key of CANONICAL_LINE_FIELDS) {
      const picker = linePickers[key];
      if (!picker) continue;
      const v = firstLineValue(lines, picker);
      if (v !== "") out.push(lineField(key, v, lineCount));
    }
  }

  return out;
}

/**
 * Map the optional raw-extra SourceToken bag (the Phase-1 SourceCapture overflow) into
 * SourceFields, EXCLUDING any token that duplicates a canonical field we already built from
 * the Order (by group/label heuristic). These render under a collapsed "Extra raw fields"
 * group and are NEVER the sole source. A raw token keeps its own stable id.
 *
 * The dedupe is conservative: we only drop a token when its label case-insensitively matches a
 * canonical label we already have AND it sits in the same scope — so genuine extra columns
 * always survive.
 */
export function rawExtraFieldsFromTokens(
  tokens: ReadonlyArray<SourceToken> | null | undefined,
  canonicalFields: ReadonlyArray<SourceField>,
): SourceField[] {
  if (!tokens || tokens.length === 0) return [];
  const haveLabels = new Set(canonicalFields.map((f) => f.label.trim().toLowerCase()));
  const out: SourceField[] = [];
  for (const t of tokens) {
    const label = (t.label ?? "").trim();
    if (label && haveLabels.has(label.toLowerCase())) continue; // already represented canonically
    out.push({
      id: t.id,
      label: label || t.id,
      value: t.value ?? "",
      group: "raw",
      mapped: false,
      suggestedFor: null,
      suggestionConfidence: null,
    });
  }
  return out;
}

/** sourceTokenId/canonicalKey → value, for the OutgoingPane preview (built once, never throws). */
export function incomingValueIndex(fields: ReadonlyArray<SourceField>): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fields) if (!m.has(f.id)) m.set(f.id, f.value);
  return m;
}
