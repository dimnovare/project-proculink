import { describe, it, expect } from "vitest";
import type { ReplayOrderDiff } from "@/lib/api/types";
import {
  backendReplayLegOutcome,
  replayImpact,
  replayLegOutcomeIsFavourable,
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
    // `danger`, not `warning`: from BE PR 207 any render error FAILS the replay leg,
    // so this version cannot be published at all. The old rule passed it on the
    // strength of `rendered > 0` — four of five orders could fail to rebuild while
    // the summary printed the error count under a calm headline.
    expect(impact.tone).toBe("danger");
    expect(backendReplayLegOutcome(s)).toBe("failed");
  });

  it("keeps a failed leg ahead of the changed-output branch", () => {
    // The ordering is the point. `changedCount > 0` paints itself `calm` whenever
    // nothing would start failing, so a version with unrebuilt orders reaching that
    // branch gets a calm blue header for a version the backend now refuses to publish.
    const s = summariseReplay([order({ outputChanged: true }), unrenderable("PO-2")]);
    expect(s.outputChanges).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.rendered).toBe(1);

    const impact = replayImpact(s);
    expect(backendReplayLegOutcome(s)).toBe("failed");
    expect(impact.tone).toBe("danger");
    expect(impact.safeToGoLive).toBe(false);
    expect(impact.headline).toContain("produced no output under this version");
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
    const cases: ReplaySummary[] = [];
    for (const total of [0, 1, 3]) {
      for (const rendered of [0, 1, total]) {
        if (rendered > total) continue;
        for (const outputChanges of [0, 1]) {
          for (const validationChanges of [0, 1]) {
            for (const startFailing of [0, 1]) {
              for (const errors of [0, 1]) {
                cases.push({ total, rendered, outputChanges, validationChanges, startFailing, errors });
              }
            }
          }
        }
      }
    }
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
    const refused: ReplaySummary[] = [
      // Nothing rendered at all — refused by both backends.
      { total: 3, rendered: 0, outputChanges: 0, validationChanges: 0, startFailing: 0, errors: 3 },
      { total: 50, rendered: 0, outputChanges: 0, validationChanges: 0, startFailing: 0, errors: 0 },
      // Zero orders — the onboarding state. PASSED the pre-PR-207 predicate; PR 207
      // calls it `not_exercised` and PublishAsync refuses it by name.
      { total: 0, rendered: 0, outputChanges: 0, validationChanges: 0, startFailing: 0, errors: 0 },
      // Four of five errored. PASSED the pre-PR-207 predicate on `rendered > 0`.
      { total: 5, rendered: 1, outputChanges: 0, validationChanges: 0, startFailing: 0, errors: 4 },
    ];
    expect(refused.length).toBeGreaterThan(0);
    for (const s of refused) {
      expect(backendReplayLegOutcome(s), "fixture is not actually a refused case").not.toBe("passed");
      expect(replayImpact(s).safeToGoLive).toBe(false);
    }
  });
});

describe("backendReplayLegOutcome — transcribes the PR 207 ternary, arm for arm", () => {
  it("calls a zero-order replay not_exercised, which is the onboarding state", () => {
    // Every newly configured supplier is here, which is exactly the population that
    // runs checks. The old predicate returned a plain pass for it.
    const s = summariseReplay([]);
    expect(backendReplayLegOutcome(s)).toBe("not_exercised");
    expect(replayLegOutcomeIsFavourable(backendReplayLegOutcome(s))).toBe(false);
    expect(replayImpact(s).safeToGoLive).toBe(false);
  });

  it("fails the leg on ANY render error, not only on rendering nothing", () => {
    const partial = summariseReplay([order(), unrenderable("PO-2"), unrenderable("PO-3")]);
    expect(partial.rendered).toBe(1);
    expect(partial.errors).toBe(2);
    expect(backendReplayLegOutcome(partial)).toBe("failed");

    const none = summariseReplay([unrenderable("PO-1")]);
    expect(backendReplayLegOutcome(none)).toBe("failed");
  });

  it("passes only a replay that ran, rendered everything, and errored on nothing", () => {
    const clean = summariseReplay([order(), order({ orderId: "ord-2", poNumber: "PO-2" })]);
    expect(backendReplayLegOutcome(clean)).toBe("passed");
    expect(replayLegOutcomeIsFavourable("passed")).toBe(true);
  });

  it("orders its arms the way the C# orders them", () => {
    // `replay.OrderCount == 0` comes FIRST over there, so an empty replay is
    // `not_exercised` even though `rendered == 0` also holds and would say `failed`.
    // Getting this backwards would tell the operator their checks failed when in fact
    // nothing ran, which is its own lie.
    const empty: ReplaySummary = {
      total: 0, rendered: 0, outputChanges: 0, validationChanges: 0, startFailing: 0, errors: 0,
    };
    expect(backendReplayLegOutcome(empty)).toBe("not_exercised");
    // And `outputErrors > 0` comes before `rendered == 0`, so both holding still
    // reports `failed` — the same answer, but reached by the arm the backend uses.
    const both: ReplaySummary = {
      total: 2, rendered: 0, outputChanges: 0, validationChanges: 0, startFailing: 0, errors: 2,
    };
    expect(backendReplayLegOutcome(both)).toBe("failed");
  });
});

describe("replayLegOutcomeIsFavourable — an allow-list, never a deny-list", () => {
  it("admits `passed` and nothing else the backend can currently send", () => {
    expect(replayLegOutcomeIsFavourable("passed")).toBe(true);
    expect(replayLegOutcomeIsFavourable("failed")).toBe(false);
    expect(replayLegOutcomeIsFavourable("not_exercised")).toBe(false);
    // Leg-only, and the standards leg's answer rather than the replay leg's — but if it
    // ever arrived here it is still not evidence of anything.
    expect(replayLegOutcomeIsFavourable("not_applicable")).toBe(false);
  });

  it("refuses an outcome nothing in the manifest recognises", () => {
    // The mutation this guards: `outcome !== "failed"`. A deny-list that names only
    // failures lets `not_exercised` — and every outcome added upstream after this file
    // was written — through as approval. That is the defect one level down.
    for (const unknown of ["", "unrecognised", "probably_fine", "PASSED ", "pass", "skipped", "true"]) {
      expect(
        replayLegOutcomeIsFavourable(unknown),
        `\`${unknown}\` was treated as evidence the version is safe to make live`,
      ).toBe(false);
    }
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
