// Pure helpers for the Inbox "Send selected" bulk action — split out for unit
// testing (vitest), mirroring the parseStall.ts pattern.
//
// WHY: POST /api/orders/{id}/redeliver is guarded server-side by
// OrderStatusMachine.RedeliverableFrom = { delivery_failed, ready_to_deliver }.
// Any other status → 400. Row selection is therefore gated on these RAW
// backend statuses — NOT the collapsed display CrossingStatus: the red
// "Failed" pill also covers parse failures, transform failures, dead-letters
// and supplier rejections, none of which the redeliver endpoint accepts
// (a dead-lettered order is rescued by the separate ops requeue path).

/**
 * Raw backend statuses from which POST /redeliver succeeds.
 * Mirrors ProcuLink.Core's OrderStatusMachine.RedeliverableFrom exactly.
 */
export const REDELIVERABLE_STATUSES: ReadonlySet<string> = new Set([
  "ready_to_deliver",
  "delivery_failed",
]);

/** True when the backend will accept a redeliver for this raw order status. */
export function isRedeliverable(rawStatus: string): boolean {
  return REDELIVERABLE_STATUSES.has(rawStatus);
}

export interface BulkSendFailure {
  /** PO number shown to the user (caller falls back to a shortened order id). */
  po: string;
  /** Per-order backend error message (previously discarded by the bulk bar). */
  reason: string;
}

const MAX_LISTED_FAILURES = 3;
const MAX_REASON_CHARS = 90;

function clipReason(reason: string): string {
  const r = reason.trim();
  if (r === "") return "no reason given";
  return r.length > MAX_REASON_CHARS ? `${r.slice(0, MAX_REASON_CHARS - 1)}…` : r;
}

/**
 * Summarise a bulk send for the inbox bulk-action bar: names the failing PO
 * numbers WITH each order's reason (first three, then "and N more") instead
 * of an opaque "N failed".
 */
export function formatBulkSendResult(
  sent: number,
  failures: BulkSendFailure[],
): { ok: boolean; text: string } {
  if (failures.length === 0) {
    return { ok: true, text: `${sent} order${sent === 1 ? "" : "s"} sent` };
  }

  const listed = failures
    .slice(0, MAX_LISTED_FAILURES)
    .map((f) => `${f.po} — ${clipReason(f.reason)}`)
    .join("; ");
  const more =
    failures.length > MAX_LISTED_FAILURES
      ? ` and ${failures.length - MAX_LISTED_FAILURES} more`
      : "";
  const head =
    sent > 0
      ? `${sent} sent · ${failures.length} failed: `
      : `Couldn't send ${failures.length} order${failures.length === 1 ? "" : "s"}: `;

  return { ok: false, text: `${head}${listed}${more}` };
}
