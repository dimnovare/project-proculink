import { describe, it, expect, vi } from "vitest";

// The failure bucket — the inbox pill must agree with the inbox count.
//
// `FAILED_BUCKET` (this file's own list, mirroring the backend's
// OrderStatusConstants.FailureBucket) is what the "Failed" chip SUMS. The backend's
// doc-comment on that set states the contract: "Every status the UI renders as the
// single red 'Failed' pill."
//
// mapStatus honoured only three of the five. `rejected_by_supplier` and
// `delivery_dead_letter` had no arm, so they fell through to `return "new"` — the same
// defect class the `delivery_held` and `delivering` arms were added to fix. The result
// was a surface contradicting itself about ONE order: the chip counted it as Failed
// while its row rendered "New" at stage 0.
//
// The invariant test below is the point. Asserting the two statuses individually would
// fix today's bug; asserting over the whole bucket means the NEXT status added to it
// cannot silently regress to "new" — it fails here first.

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { mapStatus, FAILED_BUCKET, STATUS_PRESENTATION, journeyStage } from "./InboxView";

describe("every status the Failed chip counts renders as the Failed pill", () => {
  it.each(FAILED_BUCKET)("%s maps to the failed pill, not the `new` fall-through", (status) => {
    expect(mapStatus(status)).toBe("failed");
    expect(mapStatus(status)).not.toBe("new");
  });

  it("covers the two that regressed, so the list can't shrink and still pass", () => {
    // Guards the it.each above: if FAILED_BUCKET were emptied or trimmed, it.each
    // would vacuously pass. These two are the statuses that were actually broken.
    expect(FAILED_BUCKET).toContain("rejected_by_supplier");
    expect(FAILED_BUCKET).toContain("delivery_dead_letter");
    // A FLOOR, not a pin. This was `toHaveLength(5)`, which was a fair description of a
    // hand-typed array; FAILED_BUCKET is now DERIVED from FAILURE_STATUSES in
    // src/lib/orderStatusManifest.ts, so an exact length turns the legitimate act of
    // recording a new backend failure status into a build break here — in the one test
    // whose job is to prove that status reaches the failed pill. The vacuity this line
    // exists to prevent is an EMPTY or shrunken bucket, and >= 5 with the two named
    // members above says exactly that.
    expect(FAILED_BUCKET.length).toBeGreaterThanOrEqual(5);
  });

  it("renders them at a failed stage, never plain stage 0", () => {
    // "new" is plain stage 0 — the specific lie: a supplier-rejected order looking
    // untouched. The failed slot has NO preset stage (null): the node is derived
    // per-row from the raw status via journeyStage — statusJourneyFailedStage.test.tsx
    // pins which node each raw failure gets.
    expect(STATUS_PRESENTATION.failed.stage).toBe(null);
    expect(STATUS_PRESENTATION.new.stage).toBe(0);
    for (const status of FAILED_BUCKET) {
      const stage = journeyStage(mapStatus(status), status);
      expect(typeof stage).toBe("object"); // { failed: n }, distinguishable from plain 0
      expect(stage).not.toBe(0);
    }
  });
});

describe("pending_parse — the `new` default is correct, not a fall-through bug", () => {
  it("maps to `new`, because queued-not-yet-parsed IS stage 0", () => {
    // Pinned deliberately. `pending_parse` reaching `return "new"` looks like the same
    // defect as the arms above, but it is the RIGHT answer: the order is queued and
    // nothing has run on it yet, which is exactly what "New" at stage 0 means. Adding
    // an arm for it would be churn; changing its slot would be a regression.
    expect(mapStatus("pending_parse")).toBe("new");
    expect(STATUS_PRESENTATION.new.stage).toBe(0);
  });
});
