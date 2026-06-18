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
  type MappingSuggestion,
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
 * Normalize a field name for dedupe: lowercase, strip every non-alphanumeric character. So
 * "PO Number", "po_number", "PO_NUMBER" and "po-number" all collapse to "ponumber". This is what
 * lets a raw extra `po_number` be recognised as a duplicate of the promoted `PoNumber` /
 * "PO Number" canonical field (founder bug 2: `PO_NUMBER/po_number` was showing next to the real
 * `PO NUMBER`, bloating the pane to 34 rows). Also normalizes a raw token id like `cell:po_number`.
 */
function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Normalize a value for dedupe (trim + lowercase) — a raw extra whose VALUE equals a promoted
 *  field's value is a duplicate even when its label differs. */
function normValue(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Map the optional raw-extra SourceToken bag (the Phase-1 SourceCapture overflow) into
 * SourceFields, EXCLUDING any token that duplicates a canonical field we already built from
 * the Order. These render under a collapsed "Extra raw fields" group and are NEVER the sole
 * source. A raw token keeps its own stable id.
 *
 * Dedupe (founder bug 2 — raw extras duplicating promoted fields bloated the pane):
 *   • NAME match — the token's NORMALIZED name (label or id; non-alphanumerics stripped) equals a
 *     promoted field's normalized id OR label. Catches `po_number`/`PO_NUMBER`/`po-number` ≡
 *     `PoNumber` / "PO Number", which the old exact-lowercase compare missed.
 *   • VALUE match — the token's non-empty value equals a promoted field's value (a raw mirror of a
 *     promoted column under a different header).
 * Either match drops the token. Genuine extra columns (a name AND value the spine doesn't carry)
 * always survive — lossless for real extras, dedup for duplicates.
 */
export function rawExtraFieldsFromTokens(
  tokens: ReadonlyArray<SourceToken> | null | undefined,
  canonicalFields: ReadonlyArray<SourceField>,
): SourceField[] {
  if (!tokens || tokens.length === 0) return [];
  const haveNames = new Set<string>();
  const haveValues = new Set<string>();
  for (const f of canonicalFields) {
    const nl = normName(f.label);
    const ni = normName(f.id);
    if (nl) haveNames.add(nl);
    if (ni) haveNames.add(ni);
    const nv = normValue(f.value);
    if (nv) haveValues.add(nv);
  }
  const out: SourceField[] = [];
  const seenNames = new Set<string>();
  for (const t of tokens) {
    const label = (t.label ?? "").trim();
    const name = normName(label) || normName(t.id);
    // Duplicate of a promoted canonical field (by name) → drop.
    if (name && haveNames.has(name)) continue;
    // Duplicate of a promoted field's value → drop (a raw mirror under a different header).
    const nv = normValue(t.value);
    if (nv && haveValues.has(nv)) continue;
    // Duplicate of an earlier raw token in THIS bag (same normalized name) → drop the repeat.
    if (name) {
      if (seenNames.has(name)) continue;
      seenNames.add(name);
    }
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

/**
 * Drop AI suggestions whose RAW source was deduped away (it duplicates a promoted canonical field),
 * so a duplicate raw token can never seed a ghost wire — least of all to an unrelated output
 * (founder bug 1: a raw `po_number`, a duplicate of the promoted PoNumber, was proposed for the
 * BuyerName output). The canonical/promoted field is already the source; suggesting its raw mirror
 * is pure noise. Canonical-source suggestions always survive (they ARE the promoted source).
 *
 *   • `keptRawExtraIds` — the raw-extra token ids that SURVIVED rawExtraFieldsFromTokens.
 *   • `hasPromotedSpine` — false on the legacy token-only path (no Order to promote against); then
 *     every token is a legitimate source and nothing is filtered.
 */
export function cleanSuggestionsAgainstDedup(
  suggestions: ReadonlyArray<MappingSuggestion>,
  keptRawExtraIds: ReadonlySet<string>,
  hasPromotedSpine: boolean,
): MappingSuggestion[] {
  if (!hasPromotedSpine) return [...suggestions];
  return suggestions.filter((s) => s.sourceKind === "canonical" || keptRawExtraIds.has(s.sourceId));
}

/** sourceTokenId/canonicalKey → value, for the OutgoingPane preview (built once, never throws). */
export function incomingValueIndex(fields: ReadonlyArray<SourceField>): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fields) if (!m.has(f.id)) m.set(f.id, f.value);
  return m;
}
