// orderDisplay — tiny shared display helpers for the order-review surfaces.
// Moved VERBATIM from SpineReview.tsx (batch 9 Phase C) so the order-review surfaces
// format money / output labels / delivery channels identically. Pure functions, no React.

import type { Order } from "@/types/procurement";
import type { DeliveryProtocol, OutputFormatId } from "@/lib/api/types";

/**
 * Sum of unitPrice × quantity across all order lines — the SAME derivation the
 * inbox Value column shows (backend OrderQueryService: Sum(Quantity × UnitPrice)),
 * so the workshop header never disagrees with the orders list.
 */
export function orderTotal(order: Order): number {
  return order.lines.reduce((sum, l) => sum + Number(l.unitPrice) * Number(l.quantity), 0);
}

/**
 * The grand total to display, or null when it is genuinely unknown.
 *
 * Prefer the backend-extracted `grandTotal` (Phase 4 enrichment) when it is a
 * real positive amount. An extracted 0 means "not captured", NOT a zero-value
 * order — founder bug: an order showed "€ 0.00" because
 * `order.grandTotal ?? fallback` kept the stored 0 while its one line was
 * priced — so 0/absent falls back to the client-computed
 * line sum (the same number the inbox Value column shows). When the lines carry
 * no value either (still parsing / nothing extracted), return null so callers
 * HIDE the value instead of rendering a fake zero.
 */
export function resolvedGrandTotal(order: Order): number | null {
  const stated = order.grandTotal;
  if (stated != null && Number.isFinite(stated) && stated > 0) return stated;
  const computed = orderTotal(order);
  return Number.isFinite(computed) && computed > 0 ? computed : null;
}

/**
 * Format an amount the way the inbox Value column does: currency CODE + amount,
 * e.g. "EUR 600.40" or "PLN 1,469.00" — never a hardcoded symbol.
 */
export function formatMoney(currency: string, amount: number): string {
  const code = (currency ?? "").trim();
  const formatted = amount.toLocaleString("en-IE", { minimumFractionDigits: 2 });
  return code ? `${code} ${formatted}` : formatted;
}

/**
 * The header total label for an order: "" when the total is genuinely unknown
 * (callers render nothing — never "€ 0.00").
 */
export function orderGrandTotalLabel(order: Order): string {
  const total = resolvedGrandTotal(order);
  return total == null ? "" : formatMoney(order.currency, total);
}

/**
 * The buyer name to show in the order header. Only says "(parsing…)" while the order is
 * GENUINELY still parsing — once it reaches a terminal/ready state but carries no buyer name
 * (e.g. the document never named a buyer), it shows a neutral "Buyer not detected" instead of
 * implying the pipeline is still running (founder bug 9: header read "(parsing…)" on a `ready`
 * order). A present buyerName always wins.
 */
export function buyerLabel(order: Pick<Order, "buyerName" | "status">): string {
  if (order.buyerName) return order.buyerName;
  return order.status === "parsing" ? "(parsing…)" : "Buyer not detected";
}

/**
 * The storage-key segment that marks an outbound artifact as a RE-PROCESSED PREVIEW rather than
 * the order's deliverable output.
 *
 * MIRRORS `OutboundArtifactSelection.ReprocessKeyMarker` BY HAND
 * (ProcuLink.Core/Services/OutboundArtifactSelection.cs:44). The backend deliberately discriminates
 * on the storage namespace rather than a column — "a fact about the object, readable by anyone
 * listing the bucket" — and `ArtifactDto` (ProcuLink.Api/Contracts/OrderDto.cs:186) carries
 * `fileKey`, so the frontend can ask the same question. It carries no flag, no revision id and no
 * `isReprocessed`, so this string is the only thing to ask it with. The C# side pins its own
 * constant in ProcuLink.Api.Tests/Architecture/DeliverableArtifactSelectionIsRoutedTests.cs; if
 * that value ever changes, this one has to change with it.
 */
export const REPROCESSED_ARTIFACT_KEY_MARKER = "/reprocessed/";

/**
 * The artifact this order would actually DELIVER: its newest non-re-processed output, or null.
 *
 * `artifacts[0]` is not that. The API returns the list newest-first and unfiltered — on purpose,
 * because it answers "what does this order hold?" — so after a WP-35 re-process under a draft
 * revision with a different output format, the newest artifact is the PREVIEW. The backend sends
 * the right bytes either way (`OutboundArtifactSelection.Deliverable()`); it was the frontend's
 * display that answered a different question from the one it was asked, including in the send
 * confirmation, where the operator is consenting to something irreversible.
 *
 * Sorted by `createdAt` rather than trusting the server's order: the sort is stable, so a tie
 * keeps the server's sequence, and the assumption stops being unwritten.
 */
export function deliverableArtifact(artifacts: Order["artifacts"] | undefined): Order["artifacts"][number] | null {
  const deliverable = (artifacts ?? []).filter(
    (a) => !(a.fileKey ?? "").includes(REPROCESSED_ARTIFACT_KEY_MARKER),
  );
  if (deliverable.length === 0) return null;
  return [...deliverable].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

/** Generate a display label for the supplier output file. */
export function outputArtifactLabel(artifacts: Order["artifacts"], supplierName: string): string {
  const fmt = deliverableArtifact(artifacts)?.format;
  const slug = supplierName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return fmt ? `${slug}.${fmt}` : `${slug}.xml`;
}

/**
 * Display label for a delivery format id — "cxml" → "cXML", "csv" → "CSV", "x12" → "X12".
 *
 * NULL IN, NULL OUT, and that is the entire point of the function existing.
 *
 * It replaces `outputArtifactType(artifacts)`, which read the same artifact list and answered
 * a confident **"XML"** whenever there was no deliverable artifact to read:
 *
 *     const fmt = deliverableArtifact(artifacts)?.format?.toLowerCase();
 *     if (!fmt) return "XML";
 *
 * That branch is not an edge case — it is the NORMAL pre-send state. `useSendFlow` runs the
 * transform precisely BECAUSE no deliverable artifact exists yet, so every order still awaiting
 * review took it, and every supplier that does not receive XML was named wrongly. The desktop
 * send confirmation had already been fixed for exactly this (OrderWorkshop's `sendModalFormat`
 * comment); the reduced sub-lg surface was left on the old chain and went on printing a green
 * `XML` badge over "What we will send · To the supplier".
 *
 * The input is deliberately an `OutputFormatId`, not a raw artifact string: `orderDeliveryFormat`
 * is the ONE normalizer, so the badge, the send confirmation and the mapper preview's default
 * cannot answer differently about the same order. A format the product cannot preview arrives
 * here as null and renders as nothing.
 */
export function deliveryFormatLabel(format: OutputFormatId | null): string | null {
  if (!format) return null;
  return format === "cxml" ? "cXML" : format.toUpperCase();
}

/**
 * The output format the supplier actually RECEIVES for this order, as an OutputFormatId — derived
 * from the newest DELIVERABLE artifact's format (see deliverableArtifact: the newest artifact may
 * be a re-processed preview). Drives the mapper preview's DEFAULT format so it opens on what's
 * delivered, not a hard-coded CSV (founder bug 4), and the send confirmation's format. Null when
 * the order holds no deliverable artifact yet (the preview then falls back to its own default, and
 * the confirmation says nothing rather than guessing). Normalizes the loose artifact string
 * ("Json"/"cXML"/…) and maps any non-previewable value to null so the caller falls back cleanly.
 */
export function orderDeliveryFormat(order: Pick<Order, "artifacts">): OutputFormatId | null {
  const raw = (deliverableArtifact(order.artifacts)?.format ?? "").trim().toLowerCase();
  switch (raw) {
    case "csv": case "json": case "xml": case "cxml": case "ubl": case "x12":
      return raw as OutputFormatId;
    default:
      return null;
  }
}

// Friendly channel labels for the raw delivery protocol ids (mirrors
// DeliveryConfigEditor / SupplierDockList).
export const PROTOCOL_LABEL: Record<DeliveryProtocol, string> = {
  http: "HTTP",
  sftp: "SFTP",
  ftps: "FTPS",
  email: "Email",
  smtp: "Email (SMTP)",
  erp_erply: "Erply ERP",
  erp_directo: "Directo ERP",
};

export function deliveryChannelLabel(protocol: string): string {
  return PROTOCOL_LABEL[protocol as DeliveryProtocol] ?? protocol.toUpperCase();
}
