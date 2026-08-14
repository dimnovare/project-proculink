// validationOutcomeManifest — the ONE place the frontend writes down what an
// acceptance-rule outcome can be, and the only list that may answer "did this
// check pass?".
//
// WHY THIS FILE EXISTS
//
// The outcome of a rule used to be TWO values, and the frontend encoded that
// assumption twice — in opposite directions, in two files that both claimed to be
// reading the same field:
//
//     // OrderPassport.tsx:49   anything that is not "fail" is a PASS
//     if (status) return status === "fail";
//     // api-client.ts:3018     anything that is not "pass" is a FAILURE
//     passed: r.status === "pass"
//
// Neither is a reading of the data; each is a guess about the half of the
// vocabulary it did not enumerate. One under-reports, one over-reports, and
// nothing in the type system could tell them apart because the type was `boolean`:
// `OrderValidationResult.results[].passed` could not represent a third answer at
// all, so there was no shape for the disagreement to show up in.
//
// Backend PR 206 added that third answer. `not_evaluated` means THE RULE COULD NOT
// RUN — the input it judges was not present on the order, so nothing was examined.
// It exists because rules that were structurally incapable of failing were
// reporting a pass:
//
//   • `line_amount_reconcile` read `stated = LineAmount ?? (Quantity * UnitPrice)`,
//     which makes `stated == computed` an IDENTITY rather than a comparison. Nine of
//     the eleven line-producing parsers never populate `LineAmount`, so for a CSV,
//     XLSX, UBL, EDIFACT, X12, deterministic-PDF or email-body order the rule could
//     not reject anything — while the passport printed it green.
//   • `date_sanity`, `not_label` and `vat_format` all returned true on a blank value.
//   • Any rule whose field path the evaluator does not implement resolved to a null
//     value that the absence-tolerant operators then waved through.
//
// So the favourable answer was coming from the code path that had looked at NO DATA.
// Rendering that as a green tick is the same defect one layer up, which is why the
// frontend may not collapse it back into a boolean.
//
// This file follows `src/lib/deliveryAttemptManifest.ts` and
// `src/lib/orderStatusManifest.ts`: one table, every row carrying the C# site it
// mirrors, and — the part that matters — A STATUS THIS FILE HAS NEVER HEARD OF
// RESOLVES TO `unrecognised`, WHICH IS NEVER A PASS. The standing rule is written in
// orderStatusManifest.ts: unknown answers must be treated as "I cannot say" rather
// than "carry on". A fourth outcome added by a later backend PR must not become a
// green tick on this one's schedule.
//
// PROVENANCE — backend repo ProcuLink, PR 206 (open at the time of writing; this
// frontend change PAIRS WITH IT and neither is correct alone):
//
//   ProcuLink.Core/Entities/OrderValidationResult.cs   StatusPass / StatusFail /
//                                                      StatusNotEvaluated
//   ProcuLink.Api/Services/SupplierAcceptanceService.cs   RuleOutcome, the producer
//   ProcuLink.Api/Services/AcceptanceMessages.cs:61       ForNotEvaluated, the per-
//                                                         operator sentence shipped
//                                                         in `message`
//   ProcuLink.Api/Contracts/AcceptanceProfileDto.cs:18    OrderValidationResultDto
//   ProcuLink.Api/Contracts/PassportDto.cs:96             PassportValidationResult
//
// Both DTOs send `Status` verbatim as an open `string`, so this file is an
// ALLOW-LIST of exact values rather than a pattern. A pattern is what the sibling
// manifest replaced, and a pattern is how `undeliverable` came to satisfy a test for
// "delivered".

/**
 * What one rule's outcome tells an operator.
 *
 *  pass           the rule RAN and the order satisfied it. The only outcome that may
 *                 be counted into a "checks passed" claim
 *  fail           the rule RAN and the order did not satisfy it
 *  not_evaluated  the rule COULD NOT RUN: the value it judges was absent, so nothing
 *                 was examined. Not a pass and not a failure — it never blocks
 *                 (the backend's `GetBlockingFailuresAsync` collects only failures)
 *                 and it must never be counted as a check that cleared
 *  unrecognised   THE BACKEND SENT A STATUS THIS FILE DOES NOT KNOW. Never stored in
 *                 the table below; only ever produced by `validationStatusFact`
 *                 missing. It is not a pass, and it is surfaced rather than hidden
 */
export type ValidationOutcome = "pass" | "fail" | "not_evaluated" | "unrecognised";

export interface ValidationOutcomeFact {
  /** The exact string the API sends in `status`. Matched exactly, after trim + lowercase. */
  status: string;
  /** Never "unrecognised" — that outcome exists only for statuses absent from this table. */
  outcome: Exclude<ValidationOutcome, "unrecognised">;
  /** file:line of the C# constant this row mirrors. */
  backendSite: string;
  /** Why this row reads the way it does. */
  note: string;
}

/** Every acceptance-rule status the backend can put on the wire. */
export const VALIDATION_OUTCOME_FACTS: readonly ValidationOutcomeFact[] = [
  {
    status: "pass",
    outcome: "pass",
    backendSite: "ProcuLink.Core/Entities/OrderValidationResult.cs (StatusPass)",
    note:
      "THE ONLY `pass` ROW. The entity's own words: \"the rule ran and the order satisfied it\". " +
      "Note the emphasis on RAN — that is the distinction this whole file exists to keep.",
  },
  {
    status: "fail",
    outcome: "fail",
    backendSite: "ProcuLink.Core/Entities/OrderValidationResult.cs (StatusFail)",
    note:
      "The rule ran and the order did not satisfy it. The only outcome that can block: " +
      "SupplierAcceptanceService.GetBlockingFailuresAsync skips every row whose status is not " +
      "this one, so nothing else may be rendered as a refusal either.",
  },
  {
    status: "not_evaluated",
    outcome: "not_evaluated",
    backendSite: "ProcuLink.Core/Entities/OrderValidationResult.cs (StatusNotEvaluated)",
    note:
      "The rule could not run — the value it judges was not on the order. `message` carries the " +
      "reason in plain language from AcceptanceMessages.ForNotEvaluated, e.g. \"not checked — this " +
      "document didn't state a line amount to reconcile against.\", so a screen showing this row " +
      "can say WHY rather than only that something is missing.",
  },
];

/** Every status this file knows, in table order. */
export const VALIDATION_STATUSES: readonly string[] =
  VALIDATION_OUTCOME_FACTS.map((f) => f.status);

const FACT_BY_STATUS = new Map<string, ValidationOutcomeFact>(
  VALIDATION_OUTCOME_FACTS.map((f) => [f.status, f]),
);

/** The row for an exact status, or null when this file has never heard of it. */
export function validationStatusFact(
  status: string | null | undefined,
): ValidationOutcomeFact | null {
  if (!status) return null;
  return FACT_BY_STATUS.get(status.trim().toLowerCase()) ?? null;
}

/**
 * Resolve a wire status to an outcome.
 *
 * An absent, blank or unknown status resolves to `unrecognised` — NOT to a pass, and
 * not to a failure. Callers decide what to do with that, but no caller may render it
 * as a check that cleared.
 */
export function validationOutcome(status: string | null | undefined): ValidationOutcome {
  return validationStatusFact(status)?.outcome ?? "unrecognised";
}

/**
 * The ONLY function in the frontend that may claim a rule passed.
 *
 * It is a named predicate rather than an inline `=== "pass"` on purpose: the defect
 * this replaces was an inline comparison that got written as `!== "fail"` in one file
 * and `=== "pass"` in another. There is now one place for that comparison to live and
 * one place to change it.
 */
export function outcomeIsPass(outcome: ValidationOutcome): boolean {
  return outcome === "pass";
}

/** True only for a rule that RAN and the order did not satisfy. Never for a rule that did not run. */
export function outcomeIsFailure(outcome: ValidationOutcome): boolean {
  return outcome === "fail";
}

/** True only for a rule the backend reported it could not run. */
export function outcomeWasNotEvaluated(outcome: ValidationOutcome): boolean {
  return outcome === "not_evaluated";
}

/**
 * True for a row that owes the operator a look: a real failure, or an outcome this
 * build cannot read at all.
 *
 * `not_evaluated` is deliberately NOT an open issue — there is nothing for a person to
 * fix about a document that never printed a line amount, and the backend does not block
 * on it, so raising it as a rule failure would be the same false claim pointing the
 * other way. It is reported in its own words instead (see `OrderPassport`).
 *
 * `unrecognised` IS an open issue: surfacing a row we cannot read is the safe
 * direction, and it is the direction the standing rule requires — never a pass.
 */
export function outcomeIsOpenIssue(outcome: ValidationOutcome): boolean {
  return outcome === "fail" || outcome === "unrecognised";
}
