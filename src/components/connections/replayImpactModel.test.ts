import { describe, it, expect } from "vitest";
import type { ReplayOrderDiff } from "@/lib/api/types";
import {
  backendWouldPassReplayLeg,
  legacyBackendWouldPassReplayLeg,
  replayImpact,
  replayRenderedCount,
  summariseReplay,
  type ReplaySummary,
} from "./replayImpactModel";

// ─────────────────────────────────────────────────────────────────────────────
// P0-C (audit 2026-08-13 v3, finding 3) — "safe to go live" for a revision that
// produced nothing.
//
// THE DEFECT, verbatim. `ReplayPanel.tsx:323` was
//     const noImpact = changedCount === 0 && summary.startFailing === 0;
// with `errors` computed at :93 and excluded. `outputChanged` is
// `current.Ok && draft.Ok && text differs` (ReplayService.cs:543), so an order the
// draft CANNOT RENDER scores false — a draft broken for EVERY order summed to
// `changedCount === 0`, `startFailing === 0`, and the headline
//
//     "Good news: these recent orders would process the same way under this
//      version — safe to go live."
//
// The first test below is that exact input. It is the shape that reached
// production, not a reduced one: every order carries `draftOutput: null` AND an
// `outputError`, which is what a broken template actually produces.
//
// The second silent case is `total === 0`, which the old predicate also graded
// "safe to go live" — an empty result set and a clean one were the same green.
//
// BE PR 207 then moved the BACKEND rule under this model. `replayPassed` became a
// four-state `replayOutcome`, and two states that used to publish no longer do:
// an empty replay window (now `not_exercised`, refused as `EvidenceNotExercised`)
// and ANY render error (now `failed`, where one rendered order out of five used to
// carry the leg). `safeToGoLive` was already conservative enough to survive both —
// it is `backendWouldPassReplayLeg` that had gone stale, which mattered because the
// mirror test derives the states it checks FROM that predicate. A checker that
// reads its own subject's old rule cannot see the new one being broken.
//
// So the diffs below are held to the CURRENT backend rule, and the pre-PR-207 rule
// is kept alongside it only to prove the containment that makes shipping the
// stricter one early safe.
// ─────────────────────────────────────────────────────────────────────────────

const SAFE_HEADLINE =
  "Good news: these recent orders would process the same way under this version — safe to go live.";

function order(over: Partial<ReplayOrderDiff> = {}): ReplayOrderDiff {
  return {
    orderId: "ord-1",
    poNumber: "PO-1",
    outputFormat: "Csv",
    outputChanged: false,
    currentOutput: "PoNumber\nPO-1",
    draftOutput: "PoNumber\nPO-1",
    outputError: null,
    effectiveValueChanges: [],
    validationChanged: false,
    currentValidation: { passed: true, passCount: 1, failCount: 0, hasProfile: true },
    draftValidation: { passed: true, passCount: 1, failCount: 0, hasProfile: true },
    validationFlips: [],
    ...over,
  } as ReplayOrderDiff;
}

/** The order shape a template that is broken for this order actually produces. */
function unrenderable(id: string): ReplayOrderDiff {
  return order({
    orderId: id,
    poNumber: id,
    outputChanged: false,
    draftOutput: null,
    outputError: "Template render failed: unknown variable 'Line.Sku' at line 8.",
  });
}

/**
 * The summary state space, small enough to enumerate exhaustively. Shared by every
 * table-driven test below so they cannot disagree about what "every state" means —
 * and so that a state added here is covered by all of them at once.
 *
 * Deliberately the full cross product rather than only physically-reachable rows:
 * `errors` and `rendered` are counted from different DTO fields and the backend does
 * not guarantee they are complements (see `replayRenderedCount`), so a row where both
 * are set is exactly the kind the model must still answer correctly.
 */
const ALL_STATES: ReplaySummary[] = (() => {
  const out: ReplaySummary[] = [];
  for (const total of [0, 1, 3]) {
    for (const rendered of [0, 1, total]) {
      if (rendered > total) continue;
      for (const outputChanges of [0, 1]) {
        for (const validationChanges of [0, 1]) {
          for (const startFailing of [0, 1]) {
            for (const errors of [0, 1]) {
              out.push({ total, rendered, outputChanges, validationChanges, startFailing, errors });
            }
          }
        }
      }
    }
  }
  return out;
})();

describe("replayImpact — zero output is not zero impact (P0-C)", () => {
  it("does NOT say 'safe to go live' when the version rendered nothing for every order", () => {
    const orders = [unrenderable("PO-1"), unrenderable("PO-2"), unrenderable("PO-3")];
    const s = summariseReplay(orders);

    // The exact numbers the old predicate saw, asserted so this test cannot pass
    // for the wrong reason (e.g. a fixture that quietly changed the output).
    expect(s.total).toBe(3);
    expect(s.rendered).toBe(0);
    expect(s.outputChanges).toBe(0);
    expect(s.validationChanges).toBe(0);
    expect(s.startFailing).toBe(0);
    expect(s.errors).toBe(3);
    // ...and confirm the OLD predicate really would have fired on them.
    expect(s.outputChanges + s.validationChanges === 0 && s.startFailing === 0).toBe(true);

    const impact = replayImpact(s);
    expect(impact.headline).not.toContain("safe to go live");
    expect(impact.headline).not.toBe(SAFE_HEADLINE);
    expect(impact.headline).not.toMatch(/Good news/);
    expect(impact.safeToGoLive).toBe(false);
    expect(impact.tone).toBe("danger");
    expect(impact.headline).toContain("produced no output at all");
  });

  it("does NOT say 'safe to go live' when nothing was replayed at all", () => {
    const s = summariseReplay([]);
    expect(s.total).toBe(0);
    expect(s.outputChanges + s.validationChanges === 0 && s.startFailing === 0).toBe(true);

    const impact = replayImpact(s);
    expect(impact.headline).not.toContain("safe to go live");
    expect(impact.safeToGoLive).toBe(false);
    expect(impact.tone).toBe("warning");
  });

  it("does NOT say 'safe to go live' when some orders rendered and others did not", () => {
    const s = summariseReplay([order(), unrenderable("PO-2")]);
    expect(s.rendered).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.outputChanges + s.validationChanges).toBe(0);

    const impact = replayImpact(s);
    expect(impact.headline).not.toContain("safe to go live");
    expect(impact.safeToGoLive).toBe(false);
    // `danger`, not `warning`, since BE PR 207: one order rendering no longer carries
    // the leg for the others, so the pack FAILS and publish is refused outright.
    expect(impact.tone).toBe("danger");
    expect(impact.headline).toContain("The rest would process the same way");
    // And the state really is one the backend now refuses — asserted here so the
    // tone above is pinned to the reason for it, not just to a string.
    expect(backendWouldPassReplayLeg(s)).toBe(false);
    // The rule this state moved ACROSS. Under the old predicate it published.
    expect(legacyBackendWouldPassReplayLeg(s)).toBe(true);
  });

  it("leads with the render error even when the version also changes output", () => {
    // The branch order this pins: `errors` used to be read LAST, after `changedCount`,
    // so this exact state was headlined "review the details below" over a calm blue
    // fill while the backend was refusing to publish it.
    const s = summariseReplay([order({ outputChanged: true }), unrenderable("PO-2")]);
    expect(s.errors).toBe(1);
    expect(s.rendered).toBe(1);
    expect(s.outputChanges).toBe(1);

    const impact = replayImpact(s);
    expect(impact.tone).toBe("danger");
    expect(impact.safeToGoLive).toBe(false);
    expect(impact.headline).toContain("produced no output under this version");
    // The survivors-only claim must NOT be made here — the survivor changed.
    expect(impact.headline).not.toContain("The rest would process the same way");
    expect(backendWouldPassReplayLeg(s)).toBe(false);
  });

  it("still says 'safe to go live' — unchanged — when the version really is clean", () => {
    const s = summariseReplay([order(), order({ orderId: "ord-2", poNumber: "PO-2" })]);
    expect(s.rendered).toBe(2);
    expect(s.errors).toBe(0);

    const impact = replayImpact(s);
    expect(impact.headline).toBe(SAFE_HEADLINE);
    expect(impact.safeToGoLive).toBe(true);
    expect(impact.tone).toBe("calm");
  });

  it("keeps the changed-output and would-start-failing branches", () => {
    const changed = replayImpact(summariseReplay([order({ outputChanged: true })]));
    expect(changed.headline).toContain("changes the output for 1 order");
    expect(changed.safeToGoLive).toBe(false);
    expect(changed.tone).toBe("calm");

    const failing = replayImpact(
      summariseReplay([
        order({
          outputChanged: true,
          validationChanged: true,
          draftValidation: { passed: false, passCount: 0, failCount: 1, hasProfile: true },
        }),
      ]),
    );
    expect(failing.tone).toBe("danger");
    expect(failing.safeToGoLive).toBe(false);
  });

  it("only ONE branch may ever set safeToGoLive, and it requires rendered > 0", () => {
    // Exhaustive over the small state space, so a future branch cannot quietly
    // become a second producer of the recommendation.
    const cases = ALL_STATES;
    // Anti-vacuity: count the cases actually built. `[].every()` is true.
    expect(cases.length).toBeGreaterThanOrEqual(60);
    expect(cases.some((c) => c.rendered === 0 && c.total > 0)).toBe(true);

    let recommended = 0;
    for (const c of cases) {
      const impact = replayImpact(c);
      const saysSafe = impact.headline.includes("safe to go live");
      // The sentence and the flag can never disagree.
      expect(saysSafe, `headline/flag disagree for ${JSON.stringify(c)}`).toBe(impact.safeToGoLive);
      if (impact.safeToGoLive) {
        recommended += 1;
        expect(c.rendered, `recommended go-live with rendered=0: ${JSON.stringify(c)}`).toBeGreaterThan(0);
        expect(c.total, `recommended go-live with nothing replayed: ${JSON.stringify(c)}`).toBeGreaterThan(0);
        expect(c.errors, `recommended go-live with errors: ${JSON.stringify(c)}`).toBe(0);
        expect(c.outputChanges + c.validationChanges).toBe(0);
        expect(c.startFailing).toBe(0);
      }
    }
    // The recommendation must be reachable, or the loop above proved nothing.
    expect(recommended).toBeGreaterThan(0);
  });

  it("never recommends go-live where the backend would refuse to publish", () => {
    // Derived, not hand-listed. A hand-typed set of "refused" fixtures is how the
    // previous version of this test stayed green through BE PR 207: it enumerated
    // three rendered-nothing states, and the two states the new backend rule newly
    // refuses were not among them because nobody thought to add them.
    const refused = ALL_STATES.filter((s) => !backendWouldPassReplayLeg(s));
    expect(refused.length, "no refused state in the table — this loop proves nothing")
      .toBeGreaterThan(0);
    for (const s of refused) {
      expect(
        replayImpact(s).safeToGoLive,
        `recommends go-live for a state the backend refuses: ${JSON.stringify(s)}`,
      ).toBe(false);
    }

    // The three shapes of refusal, each present in the table. Named individually so
    // that losing one to a future change to `ALL_STATES` fails here rather than
    // quietly shrinking what the loop above covers.
    expect(refused.some((s) => s.total === 0), "no empty-window state").toBe(true);
    expect(refused.some((s) => s.total > 0 && s.rendered === 0), "no rendered-nothing state")
      .toBe(true);
    expect(
      refused.some((s) => s.rendered > 0 && s.errors > 0),
      "no partially-rendered state — the case BE PR 207 moved from pass to fail",
    ).toBe(true);
  });

  it("is stricter than the pre-PR-207 backend, so shipping it early cannot over-promise", () => {
    // The containment that makes one predicate safe against both deployed backends.
    // Asserted rather than claimed in a comment: if the two rules ever cross, a
    // frontend recommending go-live under the new rule could be recommending it for
    // a state the OLD backend refuses, and the "strictly stricter" note in
    // replayImpactModel.ts would be wrong in the direction that matters.
    const accepted = ALL_STATES.filter(backendWouldPassReplayLeg);
    expect(accepted.length, "nothing passes the current rule — containment is vacuous")
      .toBeGreaterThan(0);
    for (const s of accepted) {
      expect(
        legacyBackendWouldPassReplayLeg(s),
        `current rule accepts a state the pre-PR-207 rule refuses: ${JSON.stringify(s)}`,
      ).toBe(true);
    }

    // And STRICTLY stricter — otherwise the two functions are the same predicate
    // spelled twice and this file would be diffing nothing.
    const loosened = ALL_STATES.filter(
      (s) => legacyBackendWouldPassReplayLeg(s) && !backendWouldPassReplayLeg(s),
    );
    expect(loosened.length, "the two rules accept exactly the same states").toBeGreaterThan(0);
    expect(loosened.some((s) => s.total === 0)).toBe(true);
    expect(loosened.some((s) => s.rendered > 0 && s.errors > 0)).toBe(true);
  });
});

describe("replayRenderedCount — mirrors Count(o => o.DraftOutput is not null)", () => {
  it("counts the output, not the absence of an error", () => {
    // An order with no error AND no output is the case that separates the two
    // readings; it must count as NOT rendered.
    const orders = [
      order(),
      order({ orderId: "b", draftOutput: null, outputError: "boom" }),
      order({ orderId: "c", draftOutput: null, outputError: null }),
      order({ orderId: "d", draftOutput: "", outputError: null }),
    ];
    expect(replayRenderedCount(orders)).toBe(2); // the first, and the empty-string one
    expect(orders.filter((o) => !o.outputError).length).toBe(3); // the error-based reading disagrees
  });
});
