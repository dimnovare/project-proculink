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
// THE PREDICATE IS NOT INVENTED HERE, AND IT MOVED (backend PR 207,
// `fix/publish-gate-empty-test-pack`).
//
// The backend decides whether a version's replay leg passed, and this module mirrors
// that decision rather than authoring a second definition of it.
// `src/test/replayImpactBackendMirror.test.ts` diffs the two against the real C# so
// they cannot drift apart the way the nine status vocabularies once did.
//
// What the backend used to say (`SupplierConnectionService.cs`, pre-PR-207):
//
//     var rendered     = replay.Orders.Count(o => o.DraftOutput is not null);
//     var replayPassed = replay.OrderCount == 0 || rendered > 0;
//
// What it says now (`SupplierConnectionService.cs`, PR 207):
//
//     var replayOutcome =
//         replay.OrderCount == 0 ? TestLegOutcome.NotExercised
//         : outputErrors > 0     ? TestLegOutcome.Failed
//         : rendered == 0        ? TestLegOutcome.Failed
//                                : TestLegOutcome.Passed;
//
// Two terms changed, and both of them used to read favourably here:
//
//   • ZERO ORDERS is no longer a pass. It is `not_exercised` — the pack ran, nothing
//     objected, and nothing was proved. `PublishAsync` refuses it by name
//     (`ConnectionPublishOutcome.EvidenceNotExercised`). It is the state every
//     supplier is in at onboarding, which is exactly when an operator runs checks.
//   • ANY RENDER ERROR now fails the leg. `rendered > 0` used to carry it, so four of
//     five orders failing to rebuild still passed while the summary printed
//     "5 orders, 4 render errors" underneath. The replay window is the five most
//     recent orders — the best available proxy for the next five — so an error in it
//     predicts orders dying at transform, not a historical curiosity.
//
// A THIRD LEG OUTCOME EXISTS AND IS NOT OURS. `not_applicable` belongs to the
// STANDARDS leg over CSV / JSON / XML output, where `ConformanceService.ProfileForFormat`
// returns null and no operator action could ever produce a profile. The replay leg
// never concludes it. It is deliberately NOT a blocker over there either — gating on it
// would strand the most common supplier formats forever — so nothing on this screen may
// render it as a gap or a missing check. See `src/lib/testPackOutcomeManifest.ts`, which
// is the one place the frontend writes down what a check run can have concluded; the
// vocabulary and the favourability rule both come from there rather than being restated.
//
// FAIL-SAFE ACROSS BOTH BACKENDS. The new rule refuses a strict superset of what the old
// one refused, so computing under the new rule is correct against either deployment: this
// module can be more cautious than a backend that has not shipped PR 207 yet, and it can
// never be less cautious than one that has. Where it cannot tell, it does not recommend.

import type { ReplayOrderDiff } from "@/lib/api/types";
import { FAVOURABLE_TEST_OUTCOMES, type TestOutcome } from "@/lib/testPackOutcomeManifest";

/** An order currently passing that would start failing under the replayed revision. */
export function wouldStartFailing(o: ReplayOrderDiff): boolean {
  return o.currentValidation.passed && !o.draftValidation.passed;
}

/**
 * How many replayed orders the draft revision ACTUALLY PRODUCED OUTPUT FOR.
 *
 * The frontend mirror of `replay.Orders.Count(o => o.DraftOutput is not null)`.
 * Deliberately reads `draftOutput` rather than inferring the answer from
 * `outputError`: the backend's own predicate counts the output, not the error,
 * and the two are not guaranteed to be exact complements on every path — which is
 * also why `errors` below is counted separately rather than derived from this.
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
 * What the REPLAY leg can conclude.
 *
 * A narrowing of the manifest's `TestOutcome`, not a new list. `not_applicable` is
 * excluded because it is the standards leg's answer and this leg can never reach it;
 * `unrecognised` is excluded because it describes a value arriving from the wire, and
 * this outcome is computed locally from counts.
 */
export type ReplayLegOutcome = Extract<TestOutcome, "passed" | "failed" | "not_exercised">;

/**
 * The backend's replay-leg outcome, restated on the frontend's summary shape.
 *
 * A direct transcription of the ternary in `SupplierConnectionService.ExecuteTestPackAsync`,
 * ARM FOR ARM AND IN ORDER — `src/test/replayImpactBackendMirror.test.ts` parses that C#
 * and evaluates both sides over the same state table, so a reordered or retermed arm over
 * there fails here.
 *
 * It returns an outcome rather than a boolean on purpose. A boolean is what let "we did
 * not run this" and "we ran this and it was fine" be the same answer, which is the whole
 * defect PR 207 removes.
 */
export function backendReplayLegOutcome(
  s: Pick<ReplaySummary, "total" | "rendered" | "errors">,
): ReplayLegOutcome {
  if (s.total === 0) return "not_exercised";
  if (s.errors > 0) return "failed";
  if (s.rendered === 0) return "failed";
  return "passed";
}

/**
 * May a version with this replay leg behind it be recommended for go-live?
 *
 * An ALLOW-LIST, read from the manifest's one-row `FAVOURABLE_TEST_OUTCOMES`, and
 * deliberately not `outcome !== "failed"`. A deny-list is precisely how a run that
 * exercised nothing came to read as approval: `not_exercised` is not a failure, and
 * every deny-list that names only failures lets it through. An outcome nothing in the
 * manifest recognises is likewise not favourable.
 *
 * Takes a raw string so an unrecognised value can be asked about at all — the type
 * cannot be relied on to keep one out, since the interesting version of this bug always
 * arrives from a repository the compiler cannot see.
 */
export function replayLegOutcomeIsFavourable(outcome: string): boolean {
  return FAVOURABLE_TEST_OUTCOMES.includes(outcome);
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
   * branch sets it, and that branch is reached only when the replay leg's outcome is
   * on the manifest's favourable allow-list.
   */
  safeToGoLive: boolean;
}

export function replayImpact(s: ReplaySummary): ReplayImpact {
  const leg = backendReplayLegOutcome(s);
  const changedCount = s.outputChanges + s.validationChanges;

  // Nothing was replayed — the backend's `not_exercised`. Saying "safe to go live"
  // here would be absence rendering as approval, and it is the default state of every
  // newly configured supplier rather than an edge case.
  if (leg === "not_exercised") {
    return {
      tone: "warning",
      safeToGoLive: false,
      headline:
        "No recent orders matched, so this version was not tested against anything. " +
        "That is not the same as knowing it is safe to make live.",
    };
  }

  // A FAILED leg outranks everything below it, exactly as a failed leg outranks the
  // other legs in the backend's own roll-up. This ordering is load-bearing: the
  // changed-output branch below paints itself `calm` when nothing would start failing,
  // and reaching it with unrebuilt orders in hand is how a version that cannot be
  // published got a calm blue header.
  if (leg === "failed") {
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
    // Rendered for some, failed for others. "Would process the same way" is true of the
    // survivors only, so it cannot lead — and the orders it failed on are the most
    // recent ones, which is the best guess available at what arrives next.
    return {
      tone: "danger",
      safeToGoLive: false,
      headline:
        `${s.errors} of these ${s.total} orders produced no output under this version. ` +
        "Do not make it live until those are fixed — the rest would process the same way.",
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

  // The recommendation is GATED, not fallen into. Everything above narrowed `leg` to
  // `passed` already, so this asks a question whose answer is known — which is the
  // point: the one branch that recommends go-live may only be reached by an outcome the
  // manifest lists as favourable, so an outcome added upstream that nobody has taught
  // this file about lands here and declines rather than sailing through the last
  // `return`.
  if (!replayLegOutcomeIsFavourable(leg)) {
    return {
      tone: "warning",
      safeToGoLive: false,
      headline:
        "The replay came back with a result this page can't read, so it can't tell you whether " +
        "this version is safe to make live. Run it again, and contact support if it keeps happening.",
    };
  }

  return {
    tone: "calm",
    safeToGoLive: true,
    headline:
      "Good news: these recent orders would process the same way under this version — safe to go live.",
  };
}
