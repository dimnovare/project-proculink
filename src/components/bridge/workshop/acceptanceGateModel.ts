// acceptanceGateModel — WP-18. Pure helpers that turn the server's per-field
// validation rows into the workshop's blocking issues. No React, no network.
//
// WHY THIS EXISTS. The supplier ACCEPTANCE answer used to reach the UI only
// through `useMapperModel`, which only `MapperWorkbench` builds — and the
// workshop mounts that inside `hidden lg:flex`. The count it derived
// (`blockingCount`) fed the mapper's own `canDeliver` and stopped there; it never
// reached `OrderWorkshop.canSend`. So the send gate was computed with no
// knowledge of the supplier's rules, and an operator below 1024px was offered a
// Send that WP-17's server-side acceptance gate refuses.
//
// THE CLIENT MIRRORS NO RULE. WP-17 changed GET /api/orders/{id}/validation so
// each row's `blocking` flag is derived from
// ISupplierAcceptanceService.GetBlockingFailuresAsync — the SAME call
// IAcceptanceGate consults before OrderTransformService refuses a transform. The
// backend freezes that equality with a set comparison
// (ValidationBlockingMatchesTheGateTests). We therefore only COUNT rows the
// server already marked blocking; there is exactly one evaluator and the two
// cannot drift.
//
// Invariants and output-render rows are deliberately advisory (`blocking:false`)
// server-side — the gate does not enforce them and the order sends fine. They
// must not gate here either, or the product goes back to claiming a block the
// server does not honour.

import type { FieldValidationState } from "@/lib/api/types";
import type { WorkshopIssue } from "./IssuesPanel";

/**
 * The rows the server says will actually refuse this order. Mirrors
 * `blockingReviewCount` in fieldBadgesModel (state === "review" && blocking) so
 * the mapper's badges and the send gate count the same rows.
 */
export function blockingAcceptanceRows(
  states: FieldValidationState[] | undefined | null,
): FieldValidationState[] {
  return (states ?? []).filter((s) => s.state === "review" && s.blocking === true);
}

/**
 * Project the blocking rows onto the workshop's issue shape, so they flow through
 * the SAME `issues` array every surface already reads: the desktop IssuesPanel,
 * the status bar's blocker chips, the reduced sub-lg MobileTriage list, and
 * `blockingIssues` → `canSend`. One list, one gate, every breakpoint.
 *
 * `code` is namespaced so an acceptance row can never collide with a FixQueueCard
 * key. `ref` is the server's field key, which resolveRowRef already resolves for
 * the mapper's scroll+highlight jump.
 *
 * Copy routes the party noun through the caller's `partyLabels` set — never a
 * hardcoded "supplier", so inbound orgs read "Customer".
 */
export function acceptanceIssues(
  states: FieldValidationState[] | undefined | null,
  counterpartyNoun: string,
): WorkshopIssue[] {
  return blockingAcceptanceRows(states).map((s) => ({
    code: `acceptance:${s.key}`,
    severity: "blocking" as const,
    ref: s.key,
    // The server writes the plain-language reason; it is the most specific true
    // thing we have, so it leads. Only when it is absent do we fall back to a
    // generic headline rather than render an empty card.
    title: s.reason?.trim() || `Blocked by a ${counterpartyNoun.toLowerCase()} acceptance rule`,
    why: `${counterpartyNoun} will refuse this order until this is fixed.`,
  }));
}
