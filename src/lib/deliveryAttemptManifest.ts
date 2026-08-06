// deliveryAttemptManifest — the ONE place the frontend writes down what a
// `DeliveryAttempt.status` can be, and the only list that may answer "did this
// order reach the supplier?".
//
// WHY THIS FILE EXISTS
//
// `GET /api/orders/{id}/passport` sends the attempt status VERBATIM
// (`PassportService.cs:198`, `Status: a.Status`) into a field typed `string | null`.
// `OrderPassport.tsx` decided success from it by POSITIVE SUBSTRING MATCH on that
// open string, in two places that did not agree with each other:
//
//     // deriveTimeline
//     s.includes("deliver") || s.includes("success") || s.includes("acknowled") || s === "ok" || s === "sent"
//     // sendWasObserved                                                          … no "sent"
//     s.includes("deliver") || s.includes("success") || s.includes("acknowled") || s === "ok"
//
// Three things were wrong with that.
//
//   1. `includes("deliver")` matches NEGATIVE strings. `undeliverable` — the standard
//      SMTP bounce word, and email is one of this product's delivery channels —
//      contains it, as do `not_delivered`, `delivery_failed` and `delivery_rejected`.
//      The row's colour ternary tested success FIRST, so such a status painted green
//      (#1E6D29) while the very next arm of the same expression was still looking for
//      "fail"/"reject".
//   2. It also set `deliveredOk`, which forces `reached = 5`: the whole six-node
//      pipeline drew done/green with a white checkmark, the final node read
//      "Awaiting response — Delivered, no supplier confirmation yet", and the button
//      offered to "Download what we sent".
//   3. `s === "sent"` existed in one predicate and not the other, so one screen could
//      draw the timeline green and the row beside it amber.
//
// None of `deliver`, `acknowled`, `ok` or `sent` is backend vocabulary at all — the
// old positive match worked only through `includes("success")`, by accident. That is
// the shape of the defect: a matcher that is right by coincidence and wrong the first
// time the vocabulary grows a word with `deliver` inside it.
//
// So this file follows `src/lib/orderStatusManifest.ts` and
// `src/lib/auditActionManifest.ts`: one table, every row carrying the C# site it
// mirrors, derived sets rather than second copies, and a cross-repo diff
// (`src/test/deliveryAttemptMirror.test.ts`) that parses the real C# whenever a
// backend checkout is reachable. A status this file has never heard of resolves to
// `unrecognised`, which is a rendering of its own and IS NEVER A SUCCESS.
//
// PROVENANCE — backend repo ProcuLink @ main 1433807, read 2026-08-06.
//
// The vocabulary IS centralised, unlike the audit actions: four `public const string`
// declarations on the entity itself.
//
//   ProcuLink.Core/Entities/DeliveryAttempt.cs:99-136   the four Status* constants
//
// Every production site that writes the column was enumerated; all of them live in
// one file, and none writes a value outside those four:
//
//   DeliveryService.cs:489   Status = DeliveryAttempt.StatusDispatching   (open in-flight row)
//   DeliveryService.cs:555   attempt.Status = StatusUnconfirmed           (park an unknown outcome)
//   DeliveryService.cs:975   existingAttempt.Status = status              ┐ status, :962, is
//   DeliveryService.cs:1002  Status = status                              ┘ Success : Failed
//   DeliveryService.cs:788   Status = result.Success ? "success" : "failed"  (test-fire, OrderId null)
//   DeliveryService.cs:873   Status = "failed"                            (missing delivery config)
//
// The last two write the literals rather than the constants; they are the same four
// values, and the mirror test reads the raw literals too so a fifth one cannot appear
// there unnoticed. No migration sets a default, and nothing bulk-updates the column,
// so there is no legacy value to account for either.

/**
 * What an attempt's status tells an operator about whether the supplier got the file.
 *
 * This is a PRESENTATION slot, not a second copy of the backend's semantics — the
 * backend has no such classification, which is exactly why the frontend has to write
 * one down somewhere checkable.
 *
 *  sent          the channel OBSERVED the supplier take the bytes. GREEN, and
 *                reserved: it is the only outcome that may advance the pipeline to
 *                Delivered or put the words "what we sent" in front of an operator
 *  failed        the attempt failed — transport, or an explicit supplier refusal
 *  unknown       a send may or may not have happened and the channel cannot say
 *                which. Not a failure, not a success; only a person resolves it
 *  unrecognised  THE BACKEND SENT A STATUS THIS FILE DOES NOT KNOW. Never stored in
 *                the table below; only ever produced by `deliveryAttemptStatusFact`
 *                missing. Renders as its own neutral row and is never a success —
 *                an unknown status reading as a delivery is the whole defect
 */
export type DeliveryAttemptOutcome = "sent" | "failed" | "unknown" | "unrecognised";

export interface DeliveryAttemptStatusFact {
  /** The exact string the API sends in `status`. Matched exactly, after trim + lowercase. */
  status: string;
  /** Never "unrecognised" — that outcome exists only for statuses absent from this table. */
  outcome: Exclude<DeliveryAttemptOutcome, "unrecognised">;
  /** file:line of the constant this row mirrors. */
  backendSite: string;
  /** Why this row reads the way it does. */
  note: string;
}

/**
 * Every delivery-attempt status the backend can put on the wire.
 *
 * An ALLOW-LIST of exact values, deliberately not a pattern: the defect this replaces
 * was a pattern, and a pattern is what let a word meaning "we could not deliver this"
 * satisfy a test for "delivered".
 */
export const DELIVERY_ATTEMPT_STATUS_FACTS: readonly DeliveryAttemptStatusFact[] = [
  {
    status: "success",
    outcome: "sent",
    backendSite: "ProcuLink.Core/Entities/DeliveryAttempt.cs:101 (StatusSuccess)",
    note:
      "THE ONLY `sent` ROW. The entity's own words: \"the supplier accepted the payload " +
      "(HTTP 2xx / successful upload / send)\". Written at DeliveryService.cs:975 and :1002 " +
      "from the :962 ternary, and as a raw literal at :788 for a test fire.",
  },
  {
    status: "failed",
    outcome: "failed",
    backendSite: "ProcuLink.Core/Entities/DeliveryAttempt.cs:103 (StatusFailed)",
    note:
      "Transient 5xx / network, or an explicit 4xx rejection — `rejectionReason` distinguishes " +
      "them on the row. Also the pre-dispatch failure at DeliveryService.cs:873, where the " +
      "supplier has no delivery config and nothing was ever sent.",
  },
  {
    status: "dispatching",
    outcome: "unknown",
    backendSite: "ProcuLink.Core/Entities/DeliveryAttempt.cs:112 (StatusDispatching)",
    note:
      "The in-flight marker, committed BEFORE the network write purely so a crash after the " +
      "supplier accepts is detectable. Its survival therefore proves nothing about whether bytes " +
      "went out: DeliveryService's own note says the reachable outcomes are \"sent and accepted\", " +
      "\"sent and rejected\" and \"never sent\", and it cannot tell them apart.",
  },
  {
    status: "unconfirmed",
    outcome: "unknown",
    backendSite: "ProcuLink.Core/Entities/DeliveryAttempt.cs:136 (StatusUnconfirmed)",
    note:
      "The park. A crash-recovery re-drive re-adopted an in-flight row on a channel that cannot " +
      "de-duplicate, so re-sending could duplicate the PO. The entity is explicit that this is " +
      "NEVER rewritten to success — not by an operator's \"Mark as delivered\", not by a supplier " +
      "webhook — because the row records what the CHANNEL observed, which was nothing.",
  },
] as const;

/** Every status this file knows. */
export const DELIVERY_ATTEMPT_STATUSES: readonly string[] = DELIVERY_ATTEMPT_STATUS_FACTS.map((f) => f.status);

function statusesWithOutcome(outcome: DeliveryAttemptStatusFact["outcome"]): readonly string[] {
  return DELIVERY_ATTEMPT_STATUS_FACTS.filter((f) => f.outcome === outcome).map((f) => f.status);
}

/**
 * THE allow-list. The only statuses that may render as a completed send.
 *
 * Derived from the `outcome` column rather than retyped, so the timeline node, the
 * row colour and the download button's wording cannot disagree — which is the state
 * the two hand-written substring predicates were in.
 */
export const SENT_ATTEMPT_STATUSES: readonly string[] = statusesWithOutcome("sent");

/** Statuses that mean the attempt failed. */
export const FAILED_ATTEMPT_STATUSES: readonly string[] = statusesWithOutcome("failed");

/** Statuses where "did anything go out?" has no answer yet — or ever. */
export const UNKNOWN_OUTCOME_ATTEMPT_STATUSES: readonly string[] = statusesWithOutcome("unknown");

const FACT_BY_STATUS = new Map(DELIVERY_ATTEMPT_STATUS_FACTS.map((f) => [f.status, f] as const));

/**
 * The manifest row for a raw status, or null when the backend has sent something this
 * file has never heard of.
 *
 * Trimmed and lower-cased before lookup — the constants are already lowercase, so this
 * only absorbs whitespace and casing accidents. It is NOT a substring match, and must
 * never become one.
 */
export function deliveryAttemptStatusFact(status: string | null | undefined): DeliveryAttemptStatusFact | null {
  if (!status) return null;
  return FACT_BY_STATUS.get(status.trim().toLowerCase()) ?? null;
}

/**
 * How to read a raw status.
 *
 * UNKNOWN STATUSES ANSWER `unrecognised`, NOT A SUCCESS. That is the entire point of
 * this module: `includes("deliver")` made `undeliverable` indistinguishable from a
 * completed delivery, on the one screen an operator opens to prove what was sent.
 */
export function deliveryAttemptOutcome(status: string | null | undefined): DeliveryAttemptOutcome {
  return deliveryAttemptStatusFact(status)?.outcome ?? "unrecognised";
}

/**
 * Did the channel observe the supplier take the bytes?
 *
 * A tiny allow-list rather than `outcome !== "failed"`: a deny-list is how an
 * unrecognised status came to read as a delivery in the first place.
 */
export function attemptSendWasObserved(status: string | null | undefined): boolean {
  return deliveryAttemptOutcome(status) === "sent";
}

/**
 * Is this an attempt whose outcome nobody can state — the two states the backend
 * documents as unknowable?
 */
export function attemptOutcomeIsUnknown(status: string | null | undefined): boolean {
  return deliveryAttemptOutcome(status) === "unknown";
}
