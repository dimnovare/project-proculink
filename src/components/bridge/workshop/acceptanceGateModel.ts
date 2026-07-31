// acceptanceGateModel — WP-18. Pure helpers that turn WP-17's server-side
// acceptance-gate decision into the workshop's blocking issues. No React, no network.
//
// WHY THIS EXISTS. The supplier acceptance answer used to reach the UI only through
// `useMapperModel`, which only `MapperWorkbench` builds — and the workshop mounts
// that inside `hidden lg:flex`. The count it derived (`blockingCount`) fed the
// mapper's own `canDeliver` and stopped there; it never reached
// `OrderWorkshop.canSend`. So the send gate was computed with no knowledge of the
// supplier's rules, and an operator below 1024px was offered a Send that
// `OrderTransformService` refuses.
//
// THE CLIENT DECIDES NOTHING. It renders `decision.blocked` — the exact boolean the
// server computes and acts on. It does not re-derive it from the blocker list,
// because the two are NOT equivalent: the gate subtracts a recorded operator
// override (`AcceptanceGate.cs:62-77`), so an overridden order is `blocked:false`
// with a NON-EMPTY `blockers` array. Counting blockers instead of reading `blocked`
// is precisely how a client starts refusing sends the server allows.
//
// Invariants and output-render rows never appear here at all: the gate deliberately
// enforces only supplier ACCEPTANCE rules, and orders failing an invariant transform
// and deliver fine today.

import type { AcceptanceGateDecision } from "@/lib/api/types";
import type { WorkshopIssue } from "./IssuesPanel";

/** The stable issue code for "we could not ask whether this order can be sent". */
export const GATE_UNAVAILABLE_CODE = "acceptance:unavailable";

/**
 * Project the gate's decision onto the workshop's issue shape, so it flows through
 * the SAME `issues` array every surface already reads: the desktop IssuesPanel, the
 * status bar's blocker chips, the reduced sub-lg MobileTriage list, and
 * `blockingIssues` → `canSend`. One list, one gate, every breakpoint.
 *
 * Returns [] when the order is not blocked — INCLUDING when an operator override
 * covers every blocker. The blockers are still listed on the decision in that case;
 * surfacing them as blocking issues would re-impose a refusal the operator has
 * already lifted server-side.
 *
 * `unavailable` is NOT the same as "nothing blocks". The server refuses to transform
 * when it cannot evaluate the gate (`acceptance_gate_unavailable`), so an unknown
 * answer must gate the send too — otherwise the button is green and the send 4xxs.
 *
 * Copy routes the party noun through the caller's `partyLabels` set — never a
 * hardcoded "supplier", so inbound orgs read "Customer".
 */
export function acceptanceIssues(
  decision: AcceptanceGateDecision | undefined | null,
  counterpartyNoun: string,
  opts?: { unavailable?: boolean },
): WorkshopIssue[] {
  if (opts?.unavailable) {
    return [{
      code: GATE_UNAVAILABLE_CODE,
      severity: "blocking",
      // No field to jump to — this is about the check itself, not about a value.
      ref: GATE_UNAVAILABLE_CODE,
      title: `We couldn't check this order against ${counterpartyNoun.toLowerCase()} rules`,
      why: "Sending is paused until the check succeeds. Reload in a moment to try again.",
    }];
  }

  if (!decision?.blocked) return [];

  return decision.blockers.map((b) => ({
    // Namespaced so a rule code can never collide with a FixQueueCard key, and
    // line-qualified so two lines failing the same rule stay distinct entries.
    code: `acceptance:${b.code}${b.lineNumber != null ? `:${b.lineNumber}` : ""}`,
    severity: "blocking" as const,
    // The rule code is `{fieldPath}.{operator}` (SupplierAcceptanceService.cs:417),
    // which the mapper's resolveRowRef cannot resolve — it splits ids on
    // non-alphanumerics, so a needle containing "." never matches a segment. Point
    // at the FIELD PATH instead, which is a real canonical key.
    ref: b.code.includes(".") ? b.code.slice(0, b.code.lastIndexOf(".")) : b.code,
    // The server authors the plain-language message; it is the most specific true
    // thing we have, so it leads.
    title: b.message?.trim() || `Blocked by a ${counterpartyNoun.toLowerCase()} acceptance rule`,
    why: b.lineNumber != null
      ? `Line ${b.lineNumber}. ${counterpartyNoun} will refuse this order until it is fixed.`
      : `${counterpartyNoun} will refuse this order until this is fixed.`,
  }));
}

/**
 * How many acceptance rules did NOT pass — what the send-confirmation dialog's
 * acknowledgement counts.
 *
 * Note the asymmetry that makes this useful: when `blocked` is true `canSend` is
 * false and the dialog cannot open at all. So the only case in which this count is
 * ever READ is an order the gate lets through — i.e. one whose blockers an operator
 * has explicitly overridden. That is exactly the case the acknowledgement exists
 * for ("the supplier may still refuse, but say so deliberately").
 */
export function failingAcceptanceCount(
  decision: AcceptanceGateDecision | undefined | null,
): number {
  return decision?.blockers.length ?? 0;
}
