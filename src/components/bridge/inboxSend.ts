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

/**
 * Statuses whose ROW carries its own primary send button (WP-29).
 *
 * DIFFERENT ENDPOINT, DIFFERENT GUARD SET — and that is the whole point. The bulk bar
 * posts to /redeliver, guarded by OrderStatusMachine.RedeliverableFrom, which does NOT
 * contain `ready`; a bulk send of `ready` rows could only ever 400, which is exactly
 * WP-24's D2 defect. The row button posts to /orders/{id}/transform instead, whose
 * guard set — OrderStatusMachine.TransformableFrom = {ready, transform_failed,
 * rejected_by_supplier} — does contain it. A control is only offered where the backend
 * accepts it.
 *
 * `ready` is the ONLY member, though the endpoint would accept two more:
 *   • `transform_failed` and `rejected_by_supplier` are failure states owned by WP-24's
 *     OrderProblemPanel, which already offers a named recovery with the reason attached.
 *     A bare "Send" next to "Couldn't build output" would race that panel and say less.
 *
 * The two sets are DISJOINT by construction, and inboxReadySend.test.tsx walks every
 * known status to keep them that way. Merging them — or widening isRedeliverable to
 * cover `ready` — is how one checkbox comes to fire two endpoints with two guard sets.
 */
export const ROW_SENDABLE_STATUSES: ReadonlySet<string> = new Set(["ready"]);

/** True when the inbox row itself offers the primary send button. */
export function isRowSendable(rawStatus: string): boolean {
  return ROW_SENDABLE_STATUSES.has(rawStatus);
}

/**
 * The row action's copy — deliberately NOT `partyLabels(direction).primaryCta`.
 *
 * "Send to supplier" already names the ORDER-DETAIL control, and that control earns the
 * words: useSendFlow.confirmSend transforms, polls to `ready_to_deliver`, calls
 * /redeliver, and polls again to delivered — it genuinely sends. This button calls
 * apiClient.transformOrder and stops.
 *
 * Those are the same words for two different actions, and for the ORDINARY org they are
 * two different OUTCOMES: Organisation.AutoDeliver defaults to FALSE, so the transform's
 * post-hoc DeliverOrderJob.Enqueue ("respects AutoDeliver flag") does nothing and the
 * order rests in `ready_to_deliver` / "Queued to send" waiting for a second, differently
 * shaped action. Naming that button "Send to supplier" would be false on the default
 * configuration — in the packet whose whole point is that one label means one thing.
 *
 * "Prepare output" is what the endpoint does on every configuration. It is also the
 * imperative of the badge the row is about to show: `transforming` renders "Preparing
 * output" (UnifiedStatusBadge STATUS_META), so button → in-flight badge → resting badge
 * reads "Prepare output" → "Preparing output" → "Queued to send". The success notice
 * ("building the output") already said this; now the affordance agrees with it.
 *
 * It carries NO party noun, so unlike primaryCta it needs no direction to be correct —
 * which is why inboxReadySend.test.tsx asserts the rendered text is IDENTICAL in both
 * directions and is not either direction's primaryCta. That is a stricter guard than the
 * one it replaces, not a way around the founder decision of 2026-07-30: entity nouns
 * everywhere else still route through partyLabels, and the order-detail CTA is untouched.
 */
export const ROW_SEND_CTA = "Prepare output";

/** In-flight copy for ROW_SEND_CTA. Matches the `transforming` badge, "Preparing output". */
export const ROW_SEND_CTA_PROGRESS = "Preparing…";

/**
 * The row send's success line.
 *
 * Deliberately does NOT claim the supplier has it. POST /transform answers 202 and
 * enqueues TransformOrderJob, which enqueues DeliverOrderJob — but that enqueue
 * "respects the AutoDeliver flag" (DeliverOrderJob.Enqueue's own xmldoc), so an order
 * whose supplier does not auto-send lands in `ready_to_deliver` ("Queued to send") and
 * waits for a person. "Sent" would be a lie for that org; this sentence is true for
 * every org, and the row's own status badge tells the rest of the story as it moves.
 */
export function rowSendStartedCopy(po: string): string {
  return `Started ${po} — building the output. This order's status updates as it goes.`;
}

/** The row send's failure line — names the order and keeps the backend's own reason. */
export function rowSendFailedCopy(po: string, reason: string): string {
  const r = reason.trim();
  return `Couldn't start ${po} — ${r === "" ? "no reason given" : r}`;
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

/**
 * The bulk send's success line.
 *
 * "QUEUED", NOT "SENT" — and the distinction is the whole reason this constant exists.
 * POST /api/orders/{id}/redeliver answers **202 Accepted**: OrdersController enqueues
 * DeliverOrderJob.EnqueueRedeliver and returns `{ status: "delivering" }` without any
 * supplier having been contacted. apiClient.redeliverOrder resolves on `res.ok`, so a
 * 202 arrived here as an unqualified success and the bar printed a green "✓ 3 orders
 * sent" for three orders that can each still land in `delivery_failed` or
 * `delivery_unconfirmed`.
 *
 * The single-row send one handler up has always said this correctly
 * (`rowSendStartedCopy`: "building the output. This order's status updates as it goes"),
 * and InboxView's own comment on that handler reads "The success line does not claim
 * delivery." The bulk path is the SAME shape of promise about MORE orders; it now makes
 * the same one, and points at the thing that carries the real answer — the row's status
 * badge, which the handler invalidates ["orders"] precisely in order to refresh.
 */
export function bulkSendQueuedCopy(count: number): string {
  return count === 1
    ? "1 order queued to send — its status updates as it goes"
    : `${count} orders queued to send — each row's status updates as it goes`;
}

/** Result of a bulk send — `ok` toggles the success/failure styling + glyph. */
export interface BulkSendResult {
  ok: boolean;
  text: string;
}

/**
 * Whether the inbox bulk-action bar should stay mounted.
 *
 * REGRESSION GUARD: a FULL success clears the row selection (so already-queued
 * orders can't be re-sent on retry), which — if the bar rendered on
 * `selectedCount > 0` alone — unmounted the bar together with its
 * "N orders queued to send" confirmation, making the send read as a silent no-op (the
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
 *
 * `accepted` counts orders the API ACCEPTED (202), not orders a supplier received —
 * see bulkSendQueuedCopy. Both arms that mention that number say "queued".
 *
 * The all-failed arm keeps "Couldn't send": it asserts a NON-event, and a request that
 * was refused really did send nothing and queue nothing, so it was never part of this
 * defect. Only the arms that counted successes were claiming an outcome nobody had
 * observed.
 */
export function formatBulkSendResult(
  accepted: number,
  failures: BulkSendFailure[],
): BulkSendResult {
  if (failures.length === 0) {
    return { ok: true, text: bulkSendQueuedCopy(accepted) };
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
    accepted > 0
      ? `${accepted} queued · ${failures.length} failed: `
      : `Couldn't send ${failures.length} order${failures.length === 1 ? "" : "s"}: `;

  return { ok: false, text: `${head}${listed}${more}` };
}
