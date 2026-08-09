import type { PoMappingConfig } from "./types";
import { isApiMockMode } from "@/lib/api-client";
// D-2 fix: use the canonical authHeader (it waits up to 5s for Clerk.loaded — the
// 48cea6e cold-mount fix) + the normalized base URL, instead of a local copy that
// read the token BEFORE Clerk finished loading → unauthenticated request → 401 on a
// cold/hard page load (the magic auto-map then silently degraded to empty).
import { authHeader, API_BASE_URL } from "./core";
import { serverReason } from "@/lib/serverText";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...auth, ...init?.headers },
  });
  if (res.status === 204) return null as T;
  if (!res.ok) {
    // Rendered by PoMappingEditor's "Couldn't save — …" line; a gateway answers with a page.
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ` + serverReason(text, res.statusText || `HTTP ${res.status}`));
  }
  return res.json() as Promise<T>;
}

/**
 * This supplier's SAVED order layout, or `null` when it has none.
 *
 * `GET /api/suppliers/{id}/po-mapping` has existed on the backend the whole
 * time; the frontend simply never called it, so `SupplierDockProfile` seeded the
 * editor from an in-session `useState` and a supplier with a layout saved months
 * ago got a blank editor on every fresh load. The endpoint answers 204 when
 * nothing is saved, which `apiFetch` above turns into `null` — a real answer,
 * distinct from a failure, which throws.
 */
export async function getPoMapping(supplierId: string): Promise<PoMappingConfig | null> {
  return apiFetch<PoMappingConfig | null>(`/suppliers/${supplierId}/po-mapping`);
}

export async function upsertPoMapping(
  supplierId: string,
  config: PoMappingConfig
): Promise<PoMappingConfig> {
  return apiFetch<PoMappingConfig>(`/suppliers/${supplierId}/po-mapping`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export async function deletePoMapping(supplierId: string): Promise<void> {
  return apiFetch<void>(`/suppliers/${supplierId}/po-mapping`, { method: "DELETE" });
}

// ───────────────────────────────────────────────────────────────────────────
// Magic auto-map — source-column detection + canonical-field suggestion
//
// Two backend endpoints power "auto-map":
//   GET  /api/suppliers/{id}/mapping/source-columns  → detected columns
//   POST /api/suppliers/{id}/mapping/suggest-fields   → canonical suggestions
//
// Both are being added backend-side and may not be deployed yet, so every path
// degrades gracefully and never throws to the caller:
//   • source-columns: 404 / non-OK / network / parse failure all resolve to an
//     empty column set + a human hint → the editor drops to manual entry.
//   • suggest-fields: 404 / non-OK / network / parse failure all fall back to
//     the client-side heuristic matcher below → auto-map still works offline.
// ───────────────────────────────────────────────────────────────────────────

/** Detected source columns for a supplier's most recent sample document. */
export interface MappingSourceColumns {
  /** Detected source format, e.g. "csv" | "xlsx" | "pdf" | "cxml" | "edi". "" when unknown. */
  format: string;
  /** Column / field names found in the sample. Empty when nothing was detected. */
  columns: string[];
  /** The order the sample was taken from, when available. */
  sourceOrderId: string | null;
  /** Human-readable note shown when detection is unavailable or empty. */
  hint?: string;
  /**
   * Optional one-row sample keyed by column name, used to render the live
   * preview. Not part of the guaranteed backend contract — the preview falls
   * back to showing the mapped column token when this is absent.
   */
  sample?: Record<string, string>;
}

/** A single canonical-field suggestion produced by auto-map. */
export interface FieldSuggestion {
  /** Canonical field name, e.g. "PoNumber" | "Quantity". */
  canonicalField: string;
  /** Best source column for this field, or null when nothing matched. */
  suggestedColumn: string | null;
  /** 0..1 match confidence. */
  confidence: number;
  /** Why this column was chosen — surfaced on hover. */
  reason: string;
  /** Origin of the suggestion: "ai" | "exact" | "heuristic" | … */
  source: string;
}

const MAGIC_TIMEOUT_MS = 8000;
const mapDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Like apiFetch, but returns the raw Response so callers can branch on status. */
async function magicFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = await authHeader();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAGIC_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE_URL}/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...auth, ...init?.headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Canonical fields auto-map can populate (header + line). */
const SUGGESTABLE_FIELDS = [
  "PoNumber", "OrderDate", "BuyerName", "Currency",
  "LineNumber", "BuyerItemCode", "Description", "Quantity", "Unit", "UnitPrice",
] as const;

/** Known column aliases per canonical field (lowercase, de-punctuated). */
const FIELD_ALIASES: Record<string, string[]> = {
  PoNumber:      ["ponumber", "po", "pono", "ponr", "ponum", "orderid", "ordernumber", "orderno", "ordernum", "purchaseorder", "purchaseorderno", "orderref", "orderreference", "docnumber", "documentnumber", "ordernr"],
  OrderDate:     ["orderdate", "date", "podate", "documentdate", "docdate", "createddate", "issuedate", "orderdatetime", "datetime"],
  BuyerName:     ["buyer", "buyername", "customer", "customername", "company", "companyname", "soldto", "account", "accountname", "client", "clientname", "billto", "orderingparty"],
  Currency:      ["currency", "currencycode", "curr", "ccy", "cur"],
  LineNumber:    ["linenumber", "line", "lineno", "lineid", "row", "rownumber", "pos", "position", "seq", "sequence", "linenum"],
  BuyerItemCode: ["buyeritemcode", "itemcode", "item", "sku", "partno", "partnumber", "part", "materialnumber", "material", "article", "articleno", "articlenumber", "productcode", "product", "itemid", "itemnumber", "mpn"],
  Description:   ["description", "desc", "itemdescription", "productname", "productdescription", "name", "text", "itemname", "details"],
  Quantity:      ["quantity", "qty", "qnt", "orderqty", "qtyordered", "quantityordered", "orderedqty", "count"],
  Unit:          ["unit", "uom", "unitofmeasure", "measure", "unitmeasure", "unitofmeasurement", "baseunit", "units"],
  UnitPrice:     ["unitprice", "price", "priceperunit", "rate", "netprice", "unitcost", "listprice", "priceeach", "ppu", "cost"],
};

function normalizeColumn(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Score how well a source column matches a canonical field (0..1). */
function scoreColumn(column: string, field: string): number {
  const c = normalizeColumn(column);
  if (!c) return 0;
  const normField = normalizeColumn(field);
  const aliases = [normField, ...(FIELD_ALIASES[field] ?? [])];
  let best = 0;
  for (const a of aliases) {
    if (!a) continue;
    if (c === a) {
      best = Math.max(best, a === normField ? 0.99 : 0.95);
    } else if (c.includes(a) || a.includes(c)) {
      const ratio = Math.min(c.length, a.length) / Math.max(c.length, a.length);
      best = Math.max(best, 0.55 + 0.34 * ratio); // 0.55..0.89, graded by overlap
    }
  }
  return best;
}

/**
 * Client-side fuzzy matcher — the fallback when suggest-fields isn't deployed.
 * Greedily assigns the highest-scoring column to each canonical field so two
 * fields never claim the same column.
 */
export function heuristicSuggestFields(columns: string[]): FieldSuggestion[] {
  const candidates: Array<{ field: string; column: string; score: number }> = [];
  for (const field of SUGGESTABLE_FIELDS) {
    for (const column of columns) {
      const score = scoreColumn(column, field);
      if (score >= 0.5) candidates.push({ field, column, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedColumns = new Set<string>();
  const assigned: Record<string, { column: string; score: number }> = {};
  for (const cand of candidates) {
    if (assigned[cand.field] || usedColumns.has(cand.column)) continue;
    assigned[cand.field] = { column: cand.column, score: cand.score };
    usedColumns.add(cand.column);
  }

  return SUGGESTABLE_FIELDS.map((field) => {
    const hit = assigned[field];
    if (!hit) {
      return {
        canonicalField: field,
        suggestedColumn: null,
        confidence: 0,
        reason: "No close column match — map this field manually.",
        source: "heuristic",
      };
    }
    const exact = hit.score >= 0.95;
    return {
      canonicalField: field,
      suggestedColumn: hit.column,
      confidence: Math.round(hit.score * 100) / 100,
      reason: exact
        ? `“${hit.column}” is an exact name match for ${field}.`
        : `“${hit.column}” closely matches ${field}.`,
      source: "heuristic",
    };
  });
}

/** Normalize an unknown backend payload into FieldSuggestion[]. */
function coerceSuggestions(data: unknown): FieldSuggestion[] | null {
  if (!Array.isArray(data)) return null;
  return data
    .map((d) => {
      const o = (d ?? {}) as Record<string, unknown>;
      return {
        canonicalField: String(o.canonicalField ?? ""),
        suggestedColumn: o.suggestedColumn == null ? null : String(o.suggestedColumn),
        confidence: typeof o.confidence === "number" ? o.confidence : Number(o.confidence) || 0,
        reason: String(o.reason ?? ""),
        source: String(o.source ?? "ai"),
      };
    })
    .filter((s) => s.canonicalField);
}

const NO_SAMPLE_HINT =
  "No sample document found for this supplier yet. Upload a PO, or type the source column names below.";
const OFFLINE_HINT =
  "Couldn't reach column detection. Retry, or type the source column names below.";

// ── source-columns ──────────────────────────────────────────────────────────

async function mockGetMappingSourceColumns(_supplierId: string): Promise<MappingSourceColumns> {
  await mapDelay(280);
  return {
    format: "csv",
    columns: [
      "po_number", "order_date", "buyer_name", "currency",
      "line_no", "item_code", "description", "qty", "uom", "unit_price", "line_total",
    ],
    sourceOrderId: "ord-1042",
    sample: {
      po_number: "PO-48817",
      order_date: "2026-05-22",
      buyer_name: "Heinrich Industries GmbH",
      currency: "EUR",
      line_no: "1",
      item_code: "BUY-7741",
      description: "M8 Hex Bolt, Zinc-plated",
      qty: "500",
      uom: "EA",
      unit_price: "0.184",
      line_total: "92.00",
    },
  };
}

async function realGetMappingSourceColumns(supplierId: string): Promise<MappingSourceColumns> {
  let res: Response;
  try {
    res = await magicFetch(`/suppliers/${supplierId}/mapping/source-columns`);
  } catch {
    return { format: "", columns: [], sourceOrderId: null, hint: OFFLINE_HINT };
  }
  // Endpoint not deployed yet, or no sample on file → manual entry.
  if (res.status === 404) {
    return { format: "", columns: [], sourceOrderId: null, hint: NO_SAMPLE_HINT };
  }
  if (!res.ok) {
    return {
      format: "",
      columns: [],
      sourceOrderId: null,
      hint: `Column detection unavailable (HTTP ${res.status}). Type column names below.`,
    };
  }
  try {
    const data = (await res.json()) as Partial<MappingSourceColumns> | null;
    const columns = Array.isArray(data?.columns)
      ? data!.columns.filter((c): c is string => typeof c === "string")
      : [];
    return {
      format: typeof data?.format === "string" ? data!.format : "",
      columns,
      sourceOrderId: typeof data?.sourceOrderId === "string" ? data!.sourceOrderId : null,
      hint:
        typeof data?.hint === "string"
          ? data!.hint
          : columns.length === 0
            ? NO_SAMPLE_HINT
            : undefined,
      sample:
        data?.sample && typeof data.sample === "object"
          ? (data.sample as Record<string, string>)
          : undefined,
    };
  } catch {
    return { format: "", columns: [], sourceOrderId: null, hint: OFFLINE_HINT };
  }
}

// ── suggest-fields ───────────────────────────────────────────────────────────

async function mockSuggestMappingFields(
  _supplierId: string,
  columns: string[]
): Promise<FieldSuggestion[]> {
  await mapDelay(220);
  return heuristicSuggestFields(columns);
}

async function realSuggestMappingFields(
  supplierId: string,
  columns: string[]
): Promise<FieldSuggestion[]> {
  if (columns.length === 0) return [];
  let res: Response;
  try {
    res = await magicFetch(`/suppliers/${supplierId}/mapping/suggest-fields`, {
      method: "POST",
      body: JSON.stringify({ columns }),
    });
  } catch {
    return heuristicSuggestFields(columns); // network / timeout → client-side
  }
  if (res.status === 404 || !res.ok) {
    return heuristicSuggestFields(columns); // endpoint not deployed → client-side
  }
  try {
    const parsed = coerceSuggestions(await res.json());
    return parsed && parsed.length > 0 ? parsed : heuristicSuggestFields(columns);
  } catch {
    return heuristicSuggestFields(columns);
  }
}

/** Detect the source columns for a supplier's most recent sample document. */
export const getMappingSourceColumns = isApiMockMode
  ? mockGetMappingSourceColumns
  : realGetMappingSourceColumns;

/** Suggest canonical-field → source-column mappings for the given columns. */
export const suggestMappingFields = isApiMockMode
  ? mockSuggestMappingFields
  : realSuggestMappingFields;
