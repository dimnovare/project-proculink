import { describe, it, expect, afterEach } from "vitest";
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
//   `failed`            → Parse (0):    the parse job (deleted in plan 13b) treated it as the
//                         parse-terminal status; the stuck-order sweep wrote it only
//                         for a `parsing` strand (a `transforming` strand recovered to
//                         `ready`, never `failed`).
//   `transform_failed`  → Transform (3)
//   `delivery_failed`, `delivery_dead_letter`, `rejected_by_supplier` → Deliver (4)

import { StatusJourney, FAILURE_JOURNEY_STAGE, failedStageFor } from "./StatusJourney";
import { FAILURE_STATUSES } from "@/lib/orderStatusManifest";

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

  it("covers exactly the failure bucket — the two lists cannot drift", () => {
    // FAILURE_STATUSES mirrors the backend's OrderStatusConstants.FailureBucket
    // (it was the inbox's FAILED_BUCKET until the inbox went, 2026-11-13); a
    // sixth failure status added to one list without the other fails here.
    expect(new Set(Object.keys(FAILURE_JOURNEY_STAGE))).toEqual(new Set(FAILURE_STATUSES));
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
