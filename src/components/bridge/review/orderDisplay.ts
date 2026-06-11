// orderDisplay — tiny shared display helpers for the order-review surfaces.
// Moved VERBATIM from SpineReview.tsx (batch 9 Phase C) so the classic triptych,
// the extracted OutputPreview and the Triage context stage format money / output
// labels / delivery channels identically. Pure functions, no React.

import type { Order } from "@/types/procurement";
import type { DeliveryProtocol } from "@/lib/api/types";

/** Sum of unitPrice × quantity across all order lines. */
export function orderTotal(order: Order): number {
  return order.lines.reduce((sum, l) => sum + Number(l.unitPrice) * Number(l.quantity), 0);
}

/**
 * The grand total to display: prefer the backend-extracted `grandTotal`
 * (Phase 4 enrichment) when present, else fall back to the client-computed
 * sum so behaviour is unchanged when the field is absent (e.g. CSV orders).
 */
export function resolvedGrandTotal(order: Order): number {
  return order.grandTotal ?? orderTotal(order);
}

/** Format an amount with a currency symbol/code, e.g. "€ 4,436.73" or "USD 120.00". */
export function formatMoney(currency: string, amount: number): string {
  const prefix = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : currency;
  return `${prefix} ${amount.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`;
}

/** Generate a display label for the supplier output file. */
export function outputArtifactLabel(artifacts: Order["artifacts"], supplierName: string): string {
  const fmt = artifacts[0]?.format;
  const slug = supplierName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return fmt ? `${slug}.${fmt}` : `${slug}.xml`;
}

/** Derive FileChip format from the latest outbound artifact. */
export function outputArtifactType(artifacts: Order["artifacts"]): string {
  const fmt = artifacts[0]?.format?.toLowerCase();
  if (!fmt)           return "XML";
  if (fmt === "cxml") return "cXML";
  if (fmt === "csv")  return "CSV";
  return fmt.toUpperCase();
}

// Friendly channel labels for the raw delivery protocol ids (mirrors
// DeliveryConfigEditor / SupplierDockList).
export const PROTOCOL_LABEL: Record<DeliveryProtocol, string> = {
  http: "HTTP",
  sftp: "SFTP",
  ftps: "FTPS",
  smtp: "Email",
  erp_erply: "Erply ERP",
  erp_directo: "Directo ERP",
};

export function deliveryChannelLabel(protocol: string): string {
  return PROTOCOL_LABEL[protocol as DeliveryProtocol] ?? protocol.toUpperCase();
}
