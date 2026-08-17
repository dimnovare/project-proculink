import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrderPassport, deriveTimeline, FAILURE_STAGE, PARKED_FINAL } from "./OrderPassport";
import {
  FAILURE_STATUSES,
  PARKED_STATUSES,
  PROBLEM_BUCKET_STATUSES,
  REACHABLE_STATUSES,
} from "@/lib/orderStatusManifest";
import type { PassportDeliveryAttempt, PassportDto } from "@/types/procurement";

/**
 * THE ORDER'S OWN STATUS DECIDES THIS TIMELINE, AND IT IS READ FROM THE MANIFEST.
 *
 * `deriveTimeline` decided the shape of the whole screen with hand-written substring
 * tests — `fs.includes("delivered")`, `includes("delivery_failed")`,
 * `includes("dead_letter")`, `includes("transform_failed")`, `=== "failed"`,
 * `includes("review")` — while `src/lib/orderStatusManifest.ts` existed to be exactly
 * this allow-list and carried FAILURE_STATUSES / PARKED_STATUSES. The file did not
 * import it, and three real statuses had no arm in the chain:
 *
 *   delivery_held         (parked)  → drew node 5 "Delivered" as CURRENT / "in progress",
 *                                     final node "In progress"
 *   delivery_unconfirmed  (parked)  → the same — and in direct conflict with
 *                                     auditActionRemedy.ts, which tells the operator to
 *                                     ASK THE SUPPLIER before resending because a second
 *                                     copy would be a duplicate
 *   rejected_by_supplier  (failure) → NO ARM AT ALL. A refused order's transport really
 *                                     did succeed, so it fell forward onto `deliveredOk`
 *                                     and rendered "Awaiting response" /
 *                                     "Delivered — no supplier confirmation yet" with a
 *                                     "Download what we sent" button.
 *
 * `rejected_by_supplier` with a null `supplierResponse` is reachable:
 * `POST /api/orders/{id}/mark-rejected` sets the status, and the field is
 * `PassportSupplierResponse | null` (src/types/procurement.ts:851). The pre-existing
 * rejection test supplies `outcome: "rejected"`, so it goes through the `respOutcome`
 * arm and never exercises the status at all — every test here drives the STATUS.
 */

const ARTIFACT_ID = "6f1c9a1e-0000-4000-8000-000000000002";

/** An attempt the channel CONFIRMED. This is the evidence that used to override the status. */
function sentAttempt(): PassportDeliveryAttempt {
  return {
    attemptNumber: 1,
    status: "success",
    channel: "email",
    destination: "orders@supplier.example",
    attemptedAt: "2026-08-15T09:00:00Z",
    responseCode: 200,
    transportAcceptedAt: "2026-08-15T09:00:01Z",
    rejectionReason: null,
    errorMessage: null,
    artifactId: ARTIFACT_ID,
    artifactSha256: "b".repeat(64),
  };
}

/**
 * A passport carrying every piece of POSITIVE evidence a happy order has — parsed lines,
 * an output artifact, and a delivery attempt the channel confirmed — so the ONLY thing
 * deciding the timeline is the order status under test. That is the point: the defect was
 * this evidence outvoting a status that contradicted it.
 */
function passportWithStatus(status: string, over: Partial<PassportDto> = {}): PassportDto {
  return {
    order: {
      id: "ord-2",
      poNumber: "PO-9001",
      status,
      supplierId: "sup-1",
      supplierName: "Supplier",
      buyerName: "Buyer",
      currency: "EUR",
      orderDate: "2026-08-15",
      createdAt: "2026-08-15T08:00:00Z",
      updatedAt: "2026-08-15T09:00:00Z",
      isSample: false,
    },
    sourceArtifact: { storageKey: "src/po.csv", detectedFormat: "csv" },
    canonical: { lineCount: 3, currency: "EUR", totalValue: 100, totalQuantity: 3 },
    supplierProfile: null,
    validationResults: [],
    mappingDecisions: [],
    manualCorrections: [],
    aiSuggestions: [],
    outputArtifact: {
      artifactId: ARTIFACT_ID,
      format: "csv",
      fileKey: "out/po.csv",
      createdAt: "2026-08-15T08:45:00Z",
      artifactSha256: "b".repeat(64),
    },
    deliveryAttempts: [sentAttempt()],
    supplierResponse: null,
    finalStatus: status,
    timeline: [],
    notes: [],
    ...over,
  };
}

/** Index of the `Delivered` node in the six-node pipeline. */
const DELIVERED_NODE = 5;

/** The two strings the defect put on screen, named so they cannot come back by another route. */
const DELIVERED_CLAIM_LABEL = "Awaiting response";
const DELIVERED_CLAIM_DETAIL = "Delivered — no supplier confirmation yet";

// ── The three statuses that had no arm ───────────────────────────────────────

describe("a PARKED status is neither delivered nor in progress", () => {
  test("delivery_held draws the Delivered node as blocked, not as in-progress", () => {
    const { stages, final } = deriveTimeline(passportWithStatus("delivery_held"));

    expect(stages[DELIVERED_NODE].label).toBe("Delivered");
    expect(stages[DELIVERED_NODE].state).toBe("blocked");
    // "current" is the state that literally prints "in progress" beside the node.
    expect(stages[DELIVERED_NODE].state).not.toBe("current");
    expect(stages[DELIVERED_NODE].state).not.toBe("done");

    expect(final.label).toBe("Delivery paused");
    expect(final.state).toBe("blocked");
    expect(final.label).not.toBe("In progress");
    expect(final.label).not.toBe(DELIVERED_CLAIM_LABEL);
    expect(final.detail).toContain("releases automatically");
  });

  test("delivery_unconfirmed says the outcome is unknown, and says to ask the supplier", () => {
    const { stages, final } = deriveTimeline(passportWithStatus("delivery_unconfirmed"));

    expect(stages[DELIVERED_NODE].state).toBe("blocked");
    expect(final.label).toBe("Delivery unknown");
    expect(final.state).toBe("blocked");
    expect(final.label).not.toBe("In progress");
    expect(final.detail).not.toBe(DELIVERED_CLAIM_DETAIL);
    // The remedy this screen was contradicting — auditActionRemedy.ts:174-179.
    expect(final.detail).toContain("Ask the supplier");
    expect(final.detail).toContain("duplicate");
  });

  test("unrouted is parked before the pipeline, so it claims no node of its own", () => {
    const { stages, final } = deriveTimeline(passportWithStatus("unrouted"));
    expect(final.label).toBe("Needs a supplier");
    expect(final.state).toBe("blocked");
    expect(stages.every((s) => s.state !== "blocked")).toBe(true);
  });
});

describe("rejected_by_supplier is a refusal even when no supplier response was recorded", () => {
  // `supplierResponse: null` is the whole point — the pre-existing test supplies
  // `outcome: "rejected"` and therefore never touches the status arm.
  const rejected = () => deriveTimeline(passportWithStatus("rejected_by_supplier"));

  test("the final node is the rejection, not a delivery", () => {
    const { final } = rejected();
    expect(final.label).toBe("Supplier rejected");
    expect(final.state).toBe("failed");
    expect(final.label).not.toBe(DELIVERED_CLAIM_LABEL);
    expect(final.detail).not.toBe(DELIVERED_CLAIM_DETAIL);
    expect(final.detail).toBe("The supplier read this order and refused it.");
  });

  test("a confirmed transport does not turn the Delivered node green", () => {
    // The attempt really did succeed — that is exactly why the attempt evidence alone
    // could not be trusted to answer "did this order arrive and stand".
    const { stages } = rejected();
    expect(stages[DELIVERED_NODE].state).toBe("failed");
    expect(stages[DELIVERED_NODE].state).not.toBe("done");
  });
});

describe("a status this build cannot read is not reported as progress", () => {
  const UNKNOWN_STATUS = "delivery_quarantined";

  test("it gets its own face, never 'In progress' and never a delivery", () => {
    const { stages, final } = deriveTimeline(passportWithStatus(UNKNOWN_STATUS));
    expect(final.label).toBe("Status not recognised");
    expect(final.state).toBe("blocked");
    expect(final.label).not.toBe("In progress");
    expect(final.label).not.toBe(DELIVERED_CLAIM_LABEL);
    expect(stages[DELIVERED_NODE].state).not.toBe("done");
    // The raw value is quoted, because it is the one thing the operator can act on.
    expect(final.detail).toContain(UNKNOWN_STATUS);
  });
});

// ── ANTI-VACUITY ─────────────────────────────────────────────────────────────
// Every assertion above is "not delivered". A suite of only those passes just as well
// when the derivation returns nothing at all.

describe("ANTI-VACUITY — the statuses that DO earn each face still earn it", () => {
  test("delivered reaches the Delivered node and awaits a response", () => {
    const { stages, final } = deriveTimeline(passportWithStatus("delivered"));
    expect(stages[DELIVERED_NODE].state).toBe("done");
    expect(final.label).toBe(DELIVERED_CLAIM_LABEL);
    expect(final.detail).toBe(DELIVERED_CLAIM_DETAIL);
  });

  test("a healthy in-flight status without a confirmed send is still 'In progress'", () => {
    const { final } = deriveTimeline(
      passportWithStatus("transforming", { deliveryAttempts: [], outputArtifact: null }),
    );
    expect(final.label).toBe("In progress");
    expect(final.state).toBe("pending");
  });

  test("delivering plus a confirmed attempt still reaches Delivered", () => {
    // The pre-existing behaviour the manifest read must not have broken: a healthy status
    // does not veto attempt evidence, it simply stops contradicting it.
    const { stages, final } = deriveTimeline(passportWithStatus("delivering"));
    expect(stages[DELIVERED_NODE].state).toBe("done");
    expect(final.label).toBe(DELIVERED_CLAIM_LABEL);
  });

  test("pending_review still routes to review, and delivery_failed still fails", () => {
    expect(
      deriveTimeline(passportWithStatus("pending_review", { deliveryAttempts: [] })).final.label,
    ).toBe("Needs review");
    expect(deriveTimeline(passportWithStatus("delivery_failed")).final.label).toBe("Failed");
    expect(deriveTimeline(passportWithStatus("failed")).stages[1].state).toBe("failed");
    expect(deriveTimeline(passportWithStatus("transform_failed")).stages[4].state).toBe("failed");
  });
});

// ── The manifest coverage the substring chain could never have ───────────────

describe("every problem status the manifest names has a face here", () => {
  test("FAILURE_STAGE covers FAILURE_STATUSES exactly", () => {
    // Anti-vacuity floor: a manifest that lost its rows would make this trivially true.
    expect(FAILURE_STATUSES.length).toBeGreaterThanOrEqual(5);
    for (const status of FAILURE_STATUSES) {
      expect(FAILURE_STAGE[status], `no pipeline node for failure status "${status}"`)
        .toBeTypeOf("number");
    }
    // And nothing extra: an entry for a status the manifest does not call a failure is
    // dead code that would never be reached by the bucket read.
    for (const status of Object.keys(FAILURE_STAGE)) {
      expect(FAILURE_STATUSES, `FAILURE_STAGE names "${status}", which is not a failure status`)
        .toContain(status);
    }
  });

  test("PARKED_FINAL covers PARKED_STATUSES exactly", () => {
    expect(PARKED_STATUSES.length).toBeGreaterThanOrEqual(3);
    for (const status of PARKED_STATUSES) {
      const face = PARKED_FINAL[status];
      expect(face, `no final-node face for parked status "${status}"`).toBeTruthy();
      expect(face.label.length).toBeGreaterThan(0);
      expect(face.detail.length).toBeGreaterThan(0);
      // A parked order stopped; it did not break. Neither may it read as a failure.
      expect(face.label.toLowerCase()).not.toContain("failed");
    }
    for (const status of Object.keys(PARKED_FINAL)) {
      expect(PARKED_STATUSES, `PARKED_FINAL names "${status}", which is not a parked status`)
        .toContain(status);
    }
  });

  /**
   * The property, stated over the whole machine rather than over the three statuses that
   * happened to be reported: NO status in either problem bucket may render the delivered
   * claim or the in-progress claim, no matter how much positive evidence the passport
   * carries beside it. The fixture below carries the maximum.
   */
  test("no problem-bucket status can render a delivery or a progress claim", () => {
    expect(PROBLEM_BUCKET_STATUSES.length).toBeGreaterThanOrEqual(8);
    for (const status of PROBLEM_BUCKET_STATUSES) {
      const { stages, final } = deriveTimeline(passportWithStatus(status));
      expect(stages[DELIVERED_NODE].state, `Delivered node for "${status}"`).not.toBe("done");
      expect(final.label, `final label for "${status}"`).not.toBe(DELIVERED_CLAIM_LABEL);
      expect(final.label, `final label for "${status}"`).not.toBe("In progress");
      expect(final.detail, `final detail for "${status}"`).not.toBe(DELIVERED_CLAIM_DETAIL);
    }

    // The control for the walk. Same fixture, the healthy statuses — at least one of them
    // MUST reach the claim, or the assertions above are satisfied by a derivation that
    // never returns it at all.
    const healthy = REACHABLE_STATUSES.filter((s) => !PROBLEM_BUCKET_STATUSES.includes(s));
    expect(healthy.length).toBeGreaterThan(0);
    expect(
      healthy.some((s) => deriveTimeline(passportWithStatus(s)).final.label === DELIVERED_CLAIM_LABEL),
    ).toBe(true);
  });
});

// ── What the operator actually sees ──────────────────────────────────────────

const getOrderPassport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  apiClient: { getOrderPassport, getDownloadUrl: vi.fn() },
  ApiHttpError: class ApiHttpError extends Error {
    status = 0;
  },
}));

afterEach(() => {
  cleanup();
  getOrderPassport.mockReset();
});

async function renderStatus(status: string): Promise<HTMLElement> {
  getOrderPassport.mockResolvedValue(passportWithStatus(status));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OrderPassport orderId="ord-2" />
    </QueryClientProvider>,
  );
  return screen.findByTestId("timeline-node-final");
}

/**
 * jsdom applies no Tailwind, so a component's responsive branches all mount and an
 * unscoped query can answer from the wrong one. These assertions are scoped to the final
 * timeline node, and "the scoping bites" is the control proving that scope is real.
 */
describe("the rendered timeline agrees with the derivation", () => {
  test("a refused order does not offer the operator a delivery to read", async () => {
    const node = await renderStatus("rejected_by_supplier");
    expect(within(node).getByText("Supplier rejected")).toBeTruthy();
    expect(within(node).queryByText(DELIVERED_CLAIM_LABEL)).toBeNull();
    expect(within(node).queryByText(DELIVERED_CLAIM_DETAIL)).toBeNull();
    // And nowhere else on the screen either.
    expect(screen.queryByText(DELIVERED_CLAIM_DETAIL)).toBeNull();
  });

  test("a paused delivery never wears the words 'in progress'", async () => {
    const node = await renderStatus("delivery_held");
    expect(within(node).getByText("Delivery paused")).toBeTruthy();
    expect(within(node).queryByText("in progress")).toBeNull();
    expect(within(node).getByText("waiting on you")).toBeTruthy();
  });

  test("the scoping bites — the final node really excludes the rest of the timeline", async () => {
    // Both nodes are in the same DOM; only the scope keeps them apart. If the scope
    // stopped applying, this fails while the assertions it protects keep passing.
    const node = await renderStatus("delivery_held");
    expect(screen.getByTestId("timeline-node-uploaded")).toBeTruthy();
    expect(within(node).queryByText("Uploaded")).toBeNull();
    expect(node.textContent).toContain("Delivery paused");
  });

  test("ANTI-VACUITY — a delivered order still renders the delivery it earned", async () => {
    const node = await renderStatus("delivered");
    expect(within(node).getByText(DELIVERED_CLAIM_LABEL)).toBeTruthy();
    expect(within(node).getByText(DELIVERED_CLAIM_DETAIL)).toBeTruthy();
  });
});
