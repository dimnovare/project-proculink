// replayImpactModel — the pre-publish impact verdict. Pure: no React, no network.
//
// WHY THIS EXISTS (audit 2026-08-13 v3, P0 finding 3).
//
// The headline was computed inline in ReplayPanel as
//
//     const changedCount = summary.outputChanges + summary.validationChanges;
//     const noImpact = changedCount === 0 && summary.startFailing === 0;
//
// `errors` was computed one scope up and deliberately left out of it. That is not a
// missing term — it inverts the sentence. `outputChanged` is
// `current.Ok && draft.Ok && text differs` (ReplayService.cs:543), so an order the
// draft revision CANNOT RENDER AT ALL scores `outputChanged: false`. A draft whose
// template is broken for every replayed order therefore produced `changedCount === 0`,
// `startFailing === 0`, and the headline
//
//     "Good news: these recent orders would process the same way under this version
//      — safe to go live."
//
// Zero output is not zero impact. The contradicting count rendered BELOW the headline
// and the header kept its calm blue fill, which keyed only off `startFailing`.
//
// THE PREDICATE IS NOT INVENTED HERE. The backend already refuses to publish a
// revision whose replay leg did not pass, in `SupplierConnectionService.cs`, and
// this module mirrors that meaning rather than authoring a second definition of it.
// `src/test/replayImpactBackendMirror.test.ts` diffs the two against the real C# so
// they cannot drift apart the way the nine status vocabularies once did.
//
// THE BACKEND RULE MOVED (BE PR 207, `fix/publish-gate-empty-test-pack`). It was a
// boolean:
//
//     var replayPassed = replay.OrderCount == 0 || rendered > 0;
//
// and it is now a four-state leg outcome that the publish gate reads directly:
//
//     var replayOutcome =
//         replay.OrderCount == 0 ? TestLegOutcome.NotExercised
//         : outputErrors > 0     ? TestLegOutcome.Failed
//         : rendered == 0        ? TestLegOutcome.Failed
//                                : TestLegOutcome.Passed;
//
// with `RollUp` turning a replay leg that is not `Passed` into a pack that is not
// `Passed`, and `PublishAsync` refusing anything that is not `Passed` — an empty
// window with its own outcome, `EvidenceNotExercised`. Two states therefore moved
// from "publishable" to "refused":
//
//   • OrderCount == 0. This used to be pass-with-note; nothing was tested, so it is
//     now `not_exercised` and the gate says so. It was always the quieter half of
//     the old predicate — the state where an empty result set and a clean one were
//     the same green.
//   • outputErrors > 0 with rendered > 0. One of five orders rendering used to pass
//     the leg while the summary printed "5 orders, 4 render errors" underneath it.
//     Any render error now fails the leg outright.
//
// Both halves of this repo run against BOTH backends — either side may deploy first.
// The rule below is the PR-207 one, which is STRICTLY STRICTER than its predecessor
// (see `legacyBackendWouldPassReplayLeg`, and the containment assertion the tests
// hold it to). A frontend that only recommends go-live where the newer backend would
// publish therefore never over-promises against the older one either. Being late to
// loosen is a cosmetic defect; being late to tighten is this module's whole subject.

import type { ReplayOrderDiff } from "@/lib/api/types";

/** An order currently passing that would start failing under the replayed revision. */
export function wouldStartFailing(o: ReplayOrderDiff): boolean {
  return o.currentValidation.passed && !o.draftValidation.passed;
}

/**
 * How many replayed orders the draft revision ACTUALLY PRODUCED OUTPUT FOR.
 *
 * The frontend mirror of `replay.Orders.Count(o => o.DraftOutput is not null)`.
 * Deliberately reads `draftOutput` rather than inferring the answer from
 * `outputError`: the backend's own pass predicate counts the output, not the error,
 * and the two are not guaranteed to be exact complements on every path.
 */
export function replayRenderedCount(orders: readonly ReplayOrderDiff[]): number {
  return orders.filter((o) => o.draftOutput !== null).length;
}

export interface ReplaySummary {
  /** How many orders were replayed. */
  total: number;
  /** How many of them the draft revision produced output for. */
  rendered: number;
  outputChanges: number;
  validationChanges: number;
  startFailing: number;
  /** How many carry an `outputError` — the draft could not build their output. */
  errors: number;
}

export function summariseReplay(orders: readonly ReplayOrderDiff[]): ReplaySummary {
  return {
    total: orders.length,
    rendered: replayRenderedCount(orders),
    outputChanges: orders.filter((o) => o.outputChanged).length,
    validationChanges: orders.filter((o) => o.validationChanged).length,
    startFailing: orders.filter(wouldStartFailing).length,
    errors: orders.filter((o) => !!o.outputError).length,
  };
}

/**
 * `danger` — this must not be made live.
 * `warning` — this is not a clean bill of health, for a reason the headline names.
 * `calm`   — nothing found, and something was actually looked at.
 */
export type ReplayImpactTone = "danger" | "warning" | "calm";

export interface ReplayImpact {
  tone: ReplayImpactTone;
  headline: string;
  /**
   * True only when the headline is entitled to recommend going live. Exactly one
   * branch sets it, and every state it survives is one `backendWouldPassReplayLeg`
   * accepts — the backend's own condition for letting the revision publish at all.
   */
  safeToGoLive: boolean;
}

/**
 * The backend's replay-leg verdict, restated on the frontend's summary shape.
 *
 * Mirrors `replayOutcome == TestLegOutcome.Passed` (BE PR 207): the window has to
 * have had something in it, nothing in it may have errored, and something has to
 * have come out. Kept as its own exported function so the mirror test can evaluate
 * it against a truth table rather than string-matching a rendered sentence.
 *
 * Anything else — `NotExercised` on an empty window, `Failed` on a render error —
 * rolls up to a pack that `PublishAsync` refuses.
 */
export function backendWouldPassReplayLeg(
  s: Pick<ReplaySummary, "total" | "rendered" | "errors">,
): boolean {
  return s.total > 0 && s.errors === 0 && s.rendered > 0;
}

/**
 * The PRE-PR-207 predicate — `replay.OrderCount == 0 || rendered > 0` — kept
 * because a deployed backend may still be that one, and because a claim of the
 * form "the new rule is stricter, so shipping it early is safe" is worth checking
 * rather than asserting in a comment. The tests hold the containment: every state
 * `backendWouldPassReplayLeg` accepts, this one accepts too.
 *
 * Not consulted by `replayImpact`. It exists to be diffed, not to be obeyed.
 */
export function legacyBackendWouldPassReplayLeg(
  s: Pick<ReplaySummary, "total" | "rendered">,
): boolean {
  return s.total === 0 || s.rendered > 0;
}

export function replayImpact(s: ReplaySummary): ReplayImpact {
  const changedCount = s.outputChanges + s.validationChanges;

  // Nothing was replayed. This is the state the backend used to grade pass-with-note
  // and now names `not_exercised`, refusing publish with `EvidenceNotExercised`:
  // passing on an empty set says nothing, so "safe to go live" here would be absence
  // rendering as approval. `warning`, not `danger` — nothing is broken, nothing was
  // checked, and the headline has to say which.
  if (s.total === 0) {
    return {
      tone: "warning",
      safeToGoLive: false,
      headline:
        "No recent orders matched, so this version was not tested against anything. " +
        "That is not the same as knowing it is safe to make live.",
    };
  }

  // The revision emitted nothing, for every order. This is the defect this module
  // was written for: it used to read "safe to go live".
  if (s.rendered === 0) {
    return {
      tone: "danger",
      safeToGoLive: false,
      headline:
        `This version produced no output at all for any of these ${s.total} order${s.total === 1 ? "" : "s"}. ` +
        "Do not make it live — see the errors below.",
    };
  }

  // A render error is now fatal to the leg on its own (BE PR 207), so it is read
  // BEFORE the changed-output branch rather than after it. It used to be last, which
  // meant a version that both errored and changed output was headlined "review the
  // details below" over a calm blue fill — the pack fails, and the operator was told
  // to have a look. "Would process the same way" is true of the survivors only, so
  // it never leads, and it is only claimed when there is nothing else to report.
  if (s.errors > 0) {
    return {
      tone: "danger",
      safeToGoLive: false,
      headline:
        `${s.errors} of these ${s.total} orders produced no output under this version. ` +
        (changedCount === 0
          ? "The rest would process the same way — fix those before you make this live."
          : "Others would come out differently — see the details below. Do not make it live."),
    };
  }

  if (changedCount > 0) {
    return {
      tone: s.startFailing > 0 ? "danger" : "calm",
      safeToGoLive: false,
      headline:
        `This version changes the output for ${changedCount} order${changedCount === 1 ? "" : "s"}. ` +
        "Review the details below before going live.",
    };
  }

  // Deliberately NOT folded into the branch above. In practice the backend sets
  // `validationChanged` whenever an order's outcome flips (ReplayService.cs:551,
  // `currentSummary.Passed != draftSummary.Passed`), so `startFailing > 0` with
  // `changedCount === 0` should never arrive — but that is a cross-repo invariant
  // this file cannot verify, and the entire defect class this module exists for is
  // a favourable branch reached by fall-through. Never fall through to a
  // recommendation on the strength of an assumption about the other repository.
  if (s.startFailing > 0) {
    return {
      tone: "danger",
      safeToGoLive: false,
      headline:
        `${s.startFailing} of these ${s.total} orders would start failing under this version. ` +
        "Do not make it live until that is fixed.",
    };
  }

  return {
    tone: "calm",
    safeToGoLive: true,
    headline:
      "Good news: these recent orders would process the same way under this version — safe to go live.",
  };
}
