import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Order } from "@/types/procurement";

/* =====================================================================
   WP-27 fix — the mock's delivery ladder is pinned by something.

   WP-27 taught mock mode to fail a practice order whose supplier has no
   delivery setup, and introduced that branch as the thing that "keeps the
   first-run e2e honest". A refutation then disabled the whole branch
   (`if (false && …)`) and BOTH e2e specs still passed, exit 0: no vitest
   reaches it either, because every delivery spec vi.mocks the api-client
   wholesale. Newly-authored behaviour that mirrors production, with zero
   coverage, is behaviour every future spec inherits whatever it gets wrong.

   These tests talk to the real apiClient in mock mode — no vi.mock of the
   module under test — so they pin the branch AND its wording.
   ===================================================================== */

/** Verbatim DeliveryService.FailMissingConfigAsync (ProcuLink backend). */
const BACKEND_MISSING_CONFIG_MESSAGE =
  "Supplier delivery config is missing. Add a delivery endpoint before sending this order.";

let apiClient: typeof import("@/lib/api-client").apiClient;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_USE_MOCK", "true");
  vi.resetModules();
  ({ apiClient } = await import("@/lib/api-client"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("mock mode — a practice order with no delivery setup", () => {
  it("fails at delivery_failed, with the backend's exact wording", async () => {
    // No address → the backend seeds no delivery config → deliveryConfigured: false.
    const started = await apiClient.runSampleOrder();
    expect(started.deliveryConfigured).toBe(false);

    await apiClient.redeliverOrder(started.orderId);

    const after = (await apiClient.getOrderById(started.orderId)) as Order;
    expect(after.status).toBe("delivery_failed");
    // The review screen renders errorMessage VERBATIM (useOrderReview.finalDeliveryMessage),
    // so a mock sentence the product never emits is a sentence every mock-mode QA pass and
    // every future spec is calibrated against. Two comments in the tree claimed this string
    // was the backend's; it was not.
    expect(after.errorMessage).toBe(BACKEND_MISSING_CONFIG_MESSAGE);
  }, 15_000);

  it("reaches delivered — through `delivering`, never straight there — once an address is supplied", async () => {
    const started = await apiClient.runSampleOrder("coordinator@northgate.example");
    expect(started.deliveryConfigured).toBe(true);

    await apiClient.redeliverOrder(started.orderId);

    // The real backend's claim flips the row to `delivering` BEFORE the dispatch lands
    // (OrderStatusMachine: [Delivering] = Set(Delivered, …)). A mock that jumped straight
    // to `delivered` would let any assertion on the terminal state pass without a dispatch.
    const inFlight = (await apiClient.getOrderById(started.orderId)) as Order;
    expect(inFlight.status).toBe("delivering");

    await new Promise((r) => setTimeout(r, 900));
    const settled = (await apiClient.getOrderById(started.orderId)) as Order;
    expect(settled.status).toBe("delivered");
  }, 15_000);

  it("leaves transform at ready_to_deliver — reaching delivered requires a dispatch", async () => {
    const started = await apiClient.runSampleOrder("coordinator@northgate.example");

    // The fixture's deliberate 2-of-3 gap: transform refuses until line 3 is resolved.
    const order = (await apiClient.getOrderById(started.orderId)) as Order;
    const unresolved = order.lines.find((l) => l.needsReview)!;
    expect(unresolved).toBeDefined();
    await apiClient.resolveLine(started.orderId, unresolved.id, "SMP-BRACKET-S");

    await apiClient.transformOrder(started.orderId);
    await new Promise((r) => setTimeout(r, 3_600));

    const transformed = (await apiClient.getOrderById(started.orderId)) as Order;
    expect(transformed.status).toBe("ready_to_deliver");
    expect(transformed.artifacts.length).toBeGreaterThan(0);
  }, 20_000);
});
