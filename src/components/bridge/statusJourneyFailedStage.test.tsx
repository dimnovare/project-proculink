import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// The red X must sit on the node that actually failed.
//
// `OrderStage`'s old `"failed"` variant carried no stage, so both renderers
// hardcoded the X to node 2 (Validate): a `delivery_failed` order — which got
// through Parse, Normalize, Validate AND Transform — rendered as a VALIDATION
// failure, and so did `transform_failed` and `rejected_by_supplier`. The stage
// now travels with the failure (`{ failed: n }`), and this file pins the
// derivation for every member of the failure bucket.
//
// Stage-of-failure ground truth (backend producers, not FE guesses):
//   `failed`            → Parse (0):    ParseOrderJob.cs:67-73 treats it as the
//                         parse-terminal status; StuckOrderDetectionService.cs:193-195
//                         writes it only for a `parsing` strand (a `transforming`
//                         strand recovers to `ready`, never `failed`, :143-156).
//   `transform_failed`  → Transform (3)
//   `delivery_failed`, `delivery_dead_letter`, `rejected_by_supplier` → Deliver (4)

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { StatusJourney, FAILURE_JOURNEY_STAGE, failedStageFor } from "./StatusJourney";
import { mapStatus, FAILED_BUCKET, journeyStage } from "./InboxView";
import { journeyStageFor } from "./BridgeDashboard";

afterEach(cleanup);

// All five dots of a rendered journey, compact or full (both variants give the
// dot div `rounded-full` + `flex-shrink-0`; connector segments are plain divs).
function dots(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll(".rounded-full.flex-shrink-0"));
}

describe("FAILURE_JOURNEY_STAGE — the stage each failure status points at", () => {
  it("pins all five mappings", () => {
    expect(FAILURE_JOURNEY_STAGE).toEqual({
      failed: 0,
      transform_failed: 3,
      delivery_failed: 4,
      delivery_dead_letter: 4,
      rejected_by_supplier: 4,
    });
  });

  it("covers exactly the FAILED_BUCKET — the two lists cannot drift", () => {
    // FAILED_BUCKET mirrors the backend's OrderStatusConstants.FailureBucket;
    // a sixth failure status added to one list without the other fails here.
    expect(new Set(Object.keys(FAILURE_JOURNEY_STAGE))).toEqual(new Set(FAILED_BUCKET));
  });
});

describe("journeyStage — the inbox Pipeline column's stage derivation", () => {
  it("derives the failed node from the RAW status, not a hardcoded Validate", () => {
    expect(journeyStage("failed", "delivery_failed")).toEqual({ failed: 4 });
    expect(journeyStage("failed", "rejected_by_supplier")).toEqual({ failed: 4 });
    expect(journeyStage("failed", "delivery_dead_letter")).toEqual({ failed: 4 });
    expect(journeyStage("failed", "transform_failed")).toEqual({ failed: 3 });
    expect(journeyStage("failed", "failed")).toEqual({ failed: 0 });
  });

  it("keeps the preset stage for non-failed statuses", () => {
    expect(journeyStage("sent", "delivered")).toBe(4);
    expect(journeyStage("new", "pending_parse")).toBe(0);
    expect(journeyStage("review", "pending_review")).toBe(2);
  });

  it("never renders a bucket member as plain stage 0 — failed-at-Parse is an X, not 'New'", () => {
    // `{ failed: 0 }` (parse failed, red X on Parse) must stay distinguishable
    // from plain `0` ("New", nothing ran) — the original fall-through lie.
    for (const status of FAILED_BUCKET) {
      const stage = journeyStage(mapStatus(status), status);
      expect(typeof stage).toBe("object");
      expect(stage).not.toBe(0);
    }
  });
});

describe("journeyStageFor — the dashboard in-transit stepper", () => {
  it("sends delivery_failed (and its stageLabel 'Failed') to the Deliver node", () => {
    // stageLabel maps ONLY delivery_failed to the "Failed" label
    // (BridgeDashboard stageLabel), so the label pins to Deliver too.
    expect(journeyStageFor("delivery_failed")).toEqual({ failed: 4 });
    expect(journeyStageFor("Failed")).toEqual({ failed: 4 });
  });

  it("covers every raw failure status, not just the one ACTIVE_STATUSES admits today", () => {
    // An ACTIVE_STATUSES expansion must not fall through to `default: 0` (X at Parse).
    expect(journeyStageFor("transform_failed")).toEqual({ failed: 3 });
    expect(journeyStageFor("delivery_dead_letter")).toEqual({ failed: 4 });
    expect(journeyStageFor("rejected_by_supplier")).toEqual({ failed: 4 });
    expect(journeyStageFor("failed")).toEqual({ failed: 0 });
  });

  it("keeps the non-failed lanes", () => {
    expect(journeyStageFor("parsing")).toBe(0);
    expect(journeyStageFor("pending_review")).toBe(2);
    expect(journeyStageFor("transforming")).toBe(3);
    expect(journeyStageFor("delivering")).toBe(4);
  });
});

describe("StatusJourney render — the X sits on the failing node", () => {
  it("compact: delivery failure marks node 4, not node 2", () => {
    const { container } = render(<StatusJourney stage={{ failed: 4 }} compact />);
    const d = dots(container);
    expect(d).toHaveLength(5);
    expect(d[4]).toHaveStyle({ background: "#B43838" });
    expect(d[2]).not.toHaveStyle({ background: "#B43838" });
  });

  it("compact: parse failure marks node 0", () => {
    const { container } = render(<StatusJourney stage={{ failed: 0 }} compact />);
    const d = dots(container);
    expect(d[0]).toHaveStyle({ background: "#B43838" });
    expect(d[2]).not.toHaveStyle({ background: "#B43838" });
  });

  it("full: transform failure puts the X svg on node 3 and reports 'Stage 4 of 5'", () => {
    const { container, getByText } = render(
      <StatusJourney stage={{ failed: 3 }} crossingRef="PO-1" />,
    );
    const d = dots(container);
    // On a failed journey no node is "done", so the only svg is the X.
    expect(d[3].querySelector("svg")).toBeTruthy();
    expect(d[2].querySelector("svg")).toBeNull();
    expect(getByText(/Stage 4 of 5/)).toBeInTheDocument();
  });

  it("failedStageFor wraps the map for producers", () => {
    expect(failedStageFor("transform_failed")).toEqual({ failed: 3 });
  });
});
