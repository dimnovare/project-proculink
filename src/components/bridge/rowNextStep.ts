// rowNextStep — the one line a queue row owes the operator, in one place.
//
// Two surfaces render "what does this order need?": the inbox row's second line and
// the dashboard's "Needs you" preview. They were written twice, and the second copy
// is where the interesting half lived — the dashboard knew that `pending_review`
// means "3 item codes to confirm", and the inbox, the screen an operator works all
// day, printed "14 lines · 3 to review" for the same order.
//
// A count is not a cause. "14 lines" is true of a delivered order, a parsing order
// and an order that has been waiting on a human for three days; it is the one fact
// that cannot distinguish them. So the derivation lives here, both surfaces read it,
// and a state that needs different words is one edit, not two.
//
// THREE REGISTRIES, NOTHING PHRASED HERE:
//   stopped words  ← problemFor(status).rowAction  (problem/problemCopy.ts)
//   colour         ← statusFact(status).bucket     (lib/orderStatusManifest.ts)
//   review words   ← the count the server sent, or nothing (see reviewNeedLine)
//
// Why `pending_review` is not simply a ninth ProblemStatus: PROBLEM_COPY answers five
// questions (headline / attribution / automatic / actions / consequence) about an
// order that is STUCK, and `pending_review` is not stuck — it is the state the review
// workshop exists to serve, with no failure to attribute and nothing running in the
// background. It earns a next-step line for the opposite reason: nothing will move it
// until a person acts, which is exactly what the row has to say.

import { problemFor } from "./problem/problemCopy";
import { statusFact } from "@/lib/orderStatusManifest";

/** The raw backend status for an order waiting on a human review. */
export const REVIEW_STATUS = "pending_review";

/**
 * What a review row needs, in operator language.
 *
 * The count is the SERVER's, never inferred. When it is absent or zero the line
 * degrades to the generic "Review before sending" rather than inventing "0 item
 * codes to confirm" or, worse, printing a confident number nothing supplied —
 * the failure mode this codebase keeps rediscovering, where an unfetched value
 * renders as a definite claim.
 */
export function reviewNeedLine(unresolvedCount: number | null | undefined): string {
  const unresolved = unresolvedCount ?? 0;
  if (unresolved <= 0) return "Review before sending";
  return `${unresolved} item code${unresolved === 1 ? "" : "s"} to confirm`;
}

/**
 * The row's next step, or null when the order is genuinely moving on its own.
 *
 * RAW status, never the collapsed CrossingStatus. The red "Failed" pill folds five
 * backend statuses whose next steps are five DIFFERENT sentences — "Upload it again"
 * against "See their reply" against "Retrying automatically", the last of which asks
 * the operator to do nothing at all. Collapsing them is what the pill is for;
 * un-collapsing them is the whole reason `rowAction` exists.
 *
 * --amber-text, NEVER --amber: at 11-12.5px this line is body text, and --amber is
 * 3.65:1 on the row's near-white background — under the 4.5:1 floor. --amber-text is
 * the darkened twin that exists for exactly this. (Both are defined in globals.css;
 * naming their hex values here is what the token gate is for.)
 *
 * Null for a moving row, which keeps its count line: on an order that is parsing or
 * delivered the line count IS the useful fact, and there is no action to name. A
 * next-step line on every row is noise, not help.
 */
export function rowNextStep(
  rawStatus: string,
  unresolvedCount?: number | null,
): { text: string; color: string } | null {
  // `pending_review` is `bucket: "healthy"` in the manifest, and correctly so —
  // nothing has failed. The colour is therefore chosen here rather than derived:
  // a row that cannot move without a person reads as parked, not as broken.
  if (rawStatus === REVIEW_STATUS) {
    return { text: reviewNeedLine(unresolvedCount), color: "var(--amber-text)" };
  }
  const problem = problemFor(rawStatus);
  if (!problem) return null;
  // The manifest decides. Its bucket and the registry's own `tone` agree across all
  // eight states today; the fallback covers the drift where one of the two learns a
  // status before the other, so an unknown bucket still reads as the tone the copy
  // was written in rather than silently defaulting to a colour.
  const bucket = statusFact(rawStatus)?.bucket ?? null;
  const danger = bucket === null ? problem.tone === "danger" : bucket === "failure";
  return { text: problem.rowAction, color: danger ? "var(--danger)" : "var(--amber-text)" };
}
