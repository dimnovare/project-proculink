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

/**
 * THE ONE CLAUSE every "nothing is outstanding" surface states, so no surface can
 * quietly widen it again.
 *
 * It names the SCOPE of what was looked at and stops there. It deliberately does NOT
 * say a field was "checked": the only rule-level check this screen can run is
 * `POST /api/orders/{id}/validate`, which has no caller anywhere in `src/` (see
 * readyBarLabel below for the full reasoning), so nothing rule-level ever ran behind
 * any of these bars.
 *
 * No terminal punctuation and no party noun, so each surface attaches its own
 * continuation. Every consumer composes from THIS constant rather than retyping the
 * words, which is what stops a fifth phrasing from appearing on a sixth surface.
 *
 * Help guides quote `readyBarLabel`s output verbatim and `src/test/readyBarClaim.test.ts`
 * compares them against it, so changing this text changes those guides too.
 */
export const CHECK_SCOPE_SENTENCE = "This is everything ProcuLink can check before sending";

/**
 * The sub-line under the IssuesPanel's green "Ready to send" bar.
 *
 * WHY THIS IS PRODUCED RATHER THAN LEFT TO THE DEFAULT (audit 2026-08-13 v3, P0-2).
 * `IssuesPanel` has carried a `readyLabel` prop since it was written and NOTHING in
 * `src/` ever passed one, so the hardcoded fallback was the only sentence that ever
 * rendered:
 *
 *     No open issues — every required field is filled and checked.
 *
 * "and checked" names a check. The only rule-level check this screen can run is
 * `POST /api/orders/{id}/validate`, which has no caller anywhere in `src/` — so
 * `validationResult` is permanently null, `buildFixQueue`'s rule branch never
 * contributes a card, and no rule was ever evaluated behind that green. Nor can we
 * retreat to "checked against the acceptance rules": `AcceptanceGateDecision` carries
 * no signal for whether the supplier HAS an acceptance profile, so a supplier with no
 * rules at all is indistinguishable here from one that passed every rule.
 *
 * The second leg is the one an operator actually meets. An order whose blockers were
 * OVERRIDDEN is `blocked:false` with a NON-EMPTY `blockers` list (AcceptanceGate.cs:62-77),
 * so `acceptanceIssues` returns `[]` and this bar goes green — while the send control
 * beside it reads `Send · N optional` about those very rules. That contradiction is
 * what `advisoryCount` names out loud.
 *
 * `counterpartyNoun` comes from the caller's `partyLabels`, never a hardcoded
 * "supplier", so an inbound org reads "customer".
 */
export function readyBarLabel(input: {
  /** Acceptance rules that did not pass but that the server's gate will not refuse. */
  advisoryCount: number;
  counterpartyNoun: string;
}): string {
  const noun = input.counterpartyNoun.toLowerCase();
  if (input.advisoryCount > 0) {
    const n = input.advisoryCount;
    return (
      `No open issues, but ${n} ${noun} rule${n === 1 ? "" : "s"} did not pass and ` +
      `${n === 1 ? "was" : "were"} overridden — you'll confirm that before sending.`
    );
  }
  // States what was looked at and stops there. "No open issues" is kept verbatim:
  // it is the true half of the old sentence, and two help guides and
  // issuesRailFailureState.test.tsx both key off it.
  return (
    `No open issues. ${CHECK_SCOPE_SENTENCE} — ` +
    `it is not a guarantee that the ${noun} will accept the order.`
  );
}

/**
 * The sub-line on the ZERO-FIELD-PROBLEMS-BUT-STOPPED bar — IssuesPanel and, below
 * lg, MobileTriage. Both render the same branch of the same decision, so both read
 * this one string.
 *
 * WHAT IT REPLACED, and why (audit follow-up to P0-2). Both surfaces said:
 *
 *     Every required field is filled and checked. This order stopped for another
 *     reason — see what happened and what to do next.
 *
 * "and checked" is the exact claim readyBarLabel retired, on the exact same
 * evidence: no rule-level check runs on this screen at all, and the gate decision
 * carries no signal for whether the counterparty even HAS an acceptance profile, so
 * a counterparty with no rules is indistinguishable from one that passed every rule.
 * The headline above this line is already "No field problems", which is true and
 * carries the good news; it was only the second sentence that overreached.
 *
 * No party noun: neither surface has one in scope here, and inventing one would be a
 * second fabrication in a string whose whole purpose is to stop fabricating.
 * "stopped for another reason" is kept verbatim — issuesRailFailureState.test.tsx
 * keys both surfaces off it.
 */
export const STOPPED_ORDER_NOTE =
  `${CHECK_SCOPE_SENTENCE}. This order stopped for another reason — ` +
  `see what happened and what to do next.`;

/**
 * The sub-line on the ZERO-FIELD-PROBLEMS-AND-WE-CANNOT-TELL bar — the same two
 * surfaces, the same amber bar, a DIFFERENT sentence.
 *
 * `orderProblemState` has three answers and `STOPPED_ORDER_NOTE` may only be said for
 * one of them. On `"unknown"` — a status this build has never heard of, which is a
 * routine consequence of the frontend and the backend deploying separately — nothing
 * observed a stoppage. Saying "this order stopped for another reason" there would
 * invent an event, which is the same class of overreach as the "and checked" this
 * module retired, only pointing the other way.
 *
 * So it states the scope, then the limit, then the one thing the operator can do. It
 * shares `CHECK_SCOPE_SENTENCE` with its two siblings for the same reason they share
 * it: three surfaces render this and a retyped clause is how they drift.
 *
 * The Issues column head says the same thing in its own words — "We can't confirm this
 * order is clear" (MapperWorkbench's IssuesColumn). It phrases the claim against its
 * own green ("Nothing to fix"); this one is phrased against the green bar it replaces
 * ("Ready to send").
 */
export const UNVERIFIED_ORDER_NOTE =
  `${CHECK_SCOPE_SENTENCE}. We can't confirm this order is ready to send — ` +
  `its current status isn't one we recognise. Check the status before you send.`;

/**
 * IssuesPanels `readyLabel` fallback — what the green bar renders for a caller that
 * passes no label.
 *
 * Every PRODUCTION call site passes one (readyBarClaim.test.ts asserts it), so this
 * is reached only by pure-view callers. It still held the retired claim verbatim
 * until now, which made the panel the last place in `src/` an operator could have
 * read it. Noun-free, because a fallback has no direction to route.
 */
export const READY_BAR_DEFAULT = `No open issues. ${CHECK_SCOPE_SENTENCE}.`;
 * Tooltip for WorkshopStatusBar's zero-blocker summary chip ("No issues" /
 * "N optional").
 *
 * WHY IT LIVES HERE AND NOT ON THE BAR (audit follow-up 2026-08-14).
 * It is the same claim readyBarLabel makes, on the same screen, computed from the
 * same two numbers — and while readyBarLabel was being corrected, the chip a few
 * pixels away was hand-writing a STRONGER version of the very sentence that was
 * being retired:
 *
 *     Every required field is filled and every rule passed.
 *
 * Both reasons recorded above apply to it verbatim. `POST /api/orders/{id}/validate`
 * has no caller anywhere in `src/`, so no rule-level check ever runs behind that
 * green; and `AcceptanceGateDecision` carries no signal for whether the
 * counterparty HAS an acceptance profile, so one with no rules at all is
 * indistinguishable from one that passed every rule. "every rule passed" asserts
 * both of the things the evidence cannot support.
 */
export function statusChipTitle(input: {
  /** Warning-severity issues behind the chip. Zero renders the "No issues" face. */
  noteCount: number;
}): string {
  if (input.noteCount > 0) {
    // The chip itself already carries the count, so this says what to do with
    // them and claims nothing about anything else.
    return "Nothing is blocking this order. These are worth a look before you send.";
  }
  return `Nothing is blocking this order. ${CHECK_SCOPE_SENTENCE}.`;
}

/**
 * Label for the send-confirmation checkbox in `review/ConfirmDialog.tsx`.
 *
 * THE ZERO-EXCEPTION ARM USED TO READ "Everything checks out." False in both
 * ways readyBarLabel documents, and false in a third way of its own: the ternary
 * that produced it read `exceptionCount` alone and ignored `failingRuleCount`,
 * whose own prop doc says it is "0 if it passed OR WAS NOT RUN". So an order with
 * zero exceptions and N failed acceptance rules rendered "Everything checks out."
 * eighteen lines above that same dialog panel reading "N acceptance rules failed
 * validation" — both on screen at once, on the consent step for an irreversible
 * action.
 *
 * The failing-rule arm therefore states the action and stops. That panel below
 * already names the failures and takes its own separate acknowledgement, so a
 * second sentence up here can only repeat it or contradict it.
 */
export function confirmAckLabel(input: {
  /** Unresolved exceptions the operator is being asked to say they reviewed. */
  exceptionCount: number;
  /** Acceptance rules that did not pass. Per the note above, 0 also means "not run". */
  failingRuleCount: number;
  /** "Send to BoltWorks BV" / "Confirm for BoltWorks BV" — the caller owns direction. */
  actionPhrase: string;
}): string {
  const { exceptionCount, failingRuleCount, actionPhrase } = input;
  if (exceptionCount > 0) {
    const n = exceptionCount;
    return `I've reviewed the ${n} issue${n === 1 ? "" : "s"}. ${actionPhrase}.`;
  }
  if (failingRuleCount > 0) return `${actionPhrase}.`;
  // Names what was looked at — the issue list — rather than the order as a whole.
  return `No open issues to review. ${actionPhrase}.`;
}
