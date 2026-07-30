// Pure helpers for the Inbox "Send selected" bulk action — split out for unit
// testing (vitest), mirroring the parseStall.ts pattern.
//
// WHY: POST /api/orders/{id}/redeliver is guarded server-side by
// OrderStatusMachine.RedeliverableFrom =
// { delivery_failed, ready_to_deliver, delivery_unconfirmed }.
// Any other status → 400. Row selection is therefore gated on these RAW
// backend statuses — NOT the collapsed display CrossingStatus: the red
// "Failed" pill also covers parse failures, transform failures, dead-letters
// and supplier rejections, none of which the redeliver endpoint accepts
// (a dead-lettered order is rescued by the separate ops requeue path).

/**
 * Raw backend statuses from which POST /redeliver succeeds.
 * Mirrors ProcuLink.Core's OrderStatusMachine.RedeliverableFrom exactly.
 *
 * `delivery_held` is EXCLUDED ON PURPOSE — do not "complete the set". The billing
 * hold is not in the backend's RedeliverableFrom, so /redeliver answers 400 for it.
 * That is by design: a held order is released by settling billing (which auto-releases
 * every held order back to ready_to_deliver and re-drives delivery), not by a button.
 * Adding it here would enable a bulk-send checkbox that can only ever error.
 *
 * `delivery_unconfirmed` is INCLUDED ON PURPOSE — the opposite reasoning. A crash
 * lost the delivery outcome, so the backend parks the order instead of guessing
 * whether a retry would duplicate it. The park exists precisely so a HUMAN can
 * choose to accept that duplicate risk and send again; excluding it here would
 * strand the operator with no bulk path to that choice.
 */
export const REDELIVERABLE_STATUSES: ReadonlySet<string> = new Set([
  "ready_to_deliver",
  "delivery_failed",
  "delivery_unconfirmed",
]);

/** True when the backend will accept a redeliver for this raw order status. */
export function isRedeliverable(rawStatus: string): boolean {
  return REDELIVERABLE_STATUSES.has(rawStatus);
}

/**
 * Statuses the inbox may BULK-select. Deliberately NARROWER than
 * REDELIVERABLE_STATUSES: it is exactly the backend's ClaimableForRetryFrom,
 * whose own comment states the rule — "an automatic path never claims a park".
 *
 * `delivery_unconfirmed` is redeliverable (a human may choose to accept the
 * duplicate risk) but is NOT selectable here, because the bulk bar is not that
 * human. It routed N parked orders through ONE boolean confirm, on the very
 * channels that de-duplicate nothing; the order screen's three-step resolver
 * exists precisely so that decision is per-order and evidence-based ("what did
 * the supplier say?"). A checkbox cannot answer that question, so it does not
 * get to ask it.
 */
export const BULK_SELECTABLE_STATUSES: ReadonlySet<string> = new Set([
  "ready_to_deliver",
  "delivery_failed",
]);

/** True when a row may be swept into the inbox's bulk "Send selected". */
export function isBulkSelectable(rawStatus: string): boolean {
  return BULK_SELECTABLE_STATUSES.has(rawStatus);
}

/** The parked status — sent, but the outcome was lost, so a resend may duplicate. */
const DELIVERY_UNCONFIRMED = "delivery_unconfirmed";

/**
 * Whether the inbox's bulk "Send selected" must warn before it sends.
 *
 * WHY THIS EXISTS: `delivery_unconfirmed` is redeliverable, so parked rows are
 * selectable and the header select-all sweeps them in with everything else. The
 * workshop panel gates the SAME redeliverOrder call on the SAME status behind a
 * confirm; without this the bulk bar was a loophole around that guard — one
 * select-all could hand N suppliers a duplicate PO on the very channels (ERP
 * connections, email) that de-duplicate nothing and are the reason the park exists.
 *
 * A selection of only non-parked rows returns false and sends straight through:
 * ready_to_deliver / delivery_failed carry no duplicate risk the operator hasn't
 * already accepted, and adding a dialog there would just train them to click past it.
 *
 * An id with NO known status also returns true. Paging does not clear the selection,
 * so a row selected on page 1 stays selected while page 2 is loaded and its status is
 * no longer in hand. We cannot prove such a row isn't parked — and an unnecessary
 * dialog costs a click, while a missed one costs the supplier a duplicate order.
 */
export function bulkSendNeedsDuplicateConfirm(
  ids: readonly string[],
  rawStatusById: ReadonlyMap<string, string>,
): boolean {
  return ids.some((id) => {
    const raw = rawStatusById.get(id);
    return raw === undefined || raw === DELIVERY_UNCONFIRMED;
  });
}

/**
 * Confirm copy for a bulk send that includes (or may include) a parked order.
 *
 * Mirrors DeliveryUnconfirmedPanel's pinned CONFIRM_COPY.redeliver rather than
 * inventing a second vocabulary for the same risk — the single-order and bulk paths
 * must read identically, because they ARE the same decision. `count` is the whole
 * selection: every selected order is sent, so that is the honest number to name.
 *
 * The claim stays conditional ("If … already received", "may give"): we never
 * observed whether the supplier got it — that unknown IS the park.
 */
export function bulkSendConfirmCopy(count: number): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  return {
    title: count === 1 ? "Send this order again?" : `Send ${count} orders again?`,
    description:
      count === 1
        ? "If the supplier already received this order, sending again may give them a duplicate."
        : "If the supplier already received them, sending again may give them duplicates.",
    confirmLabel: "Send again",
  };
}

export interface BulkSendFailure {
  /** PO number shown to the user (caller falls back to a shortened order id). */
  po: string;
  /** Per-order backend error message (previously discarded by the bulk bar). */
  reason: string;
}

/** Result of a bulk send — `ok` toggles the success/failure styling + glyph. */
export interface BulkSendResult {
  ok: boolean;
  text: string;
}

/**
 * Whether the inbox bulk-action bar should stay mounted.
 *
 * REGRESSION GUARD: a FULL success clears the row selection (so already-sent
 * orders can't be re-sent on retry), which — if the bar rendered on
 * `selectedCount > 0` alone — unmounted the bar together with its
 * "N orders sent" confirmation, making the send read as a silent no-op (the
 * success line vanished the instant Send selected succeeded). The bar must
 * therefore render while EITHER rows are selected OR a result is still on
 * display awaiting dismissal.
 */
export function shouldShowBulkBar(
  selectedCount: number,
  bulkResult: BulkSendResult | null,
): boolean {
  return selectedCount > 0 || bulkResult !== null;
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
): BulkSendResult {
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
