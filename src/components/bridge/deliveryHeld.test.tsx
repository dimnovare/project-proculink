import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";

// delivery_held (the A5 billing hold) — truthfulness guard.
//
// The backend pauses a transform-ready order into `delivery_held` when the org can't
// process orders at delivery time, and RELEASES it back to ready_to_deliver
// automatically once billing is good again (DeliveryService.Hold/ReleaseBillingHeld).
// Every assertion here exists because the surface previously said something FALSE or
// unhelpful about that state:
//   • the badge showed a humanized "Delivery held" with a neutral tone (no STATUS_META entry);
//   • the review hook said "Delivery is still processing" — nothing is processing;
//   • the workshop offered Send, which answers 400 (not in RedeliverableFrom).
//
// The negative assertions are the point: this status must never read as a failure.

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getOrderById: vi.fn(),
    getOrderPassport: vi.fn().mockResolvedValue(null),
    redeliverOrder: vi.fn(),
    markDelivered: vi.fn(),
    retryDelivery: vi.fn(),
    transformOrder: vi.fn(),
  },
  requeueDelivery: vi.fn(),
  getOpsHealth: vi.fn().mockResolvedValue({ workerHealthy: true }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

import { UnifiedStatusBadge, statusLabel, statusTone } from "./UnifiedStatusBadge";
import { finalDeliveryMessage, BILLING_HELD_MESSAGE } from "./review/hooks/useOrderReview";
import { OrderProblemPanel } from "./problem/OrderProblemPanel";
import { isRedeliverable } from "./inboxSend";
import type { Order } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";

afterEach(cleanup);

/**
 * The billing-pause panel. BillingHeldPanel was retired into the one
 * OrderProblemPanel (WP-24) — same status, same three claims, one component.
 */
function renderHeldPanel(order: Order = HELD_ORDER) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <OrderProblemPanel order={order} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

const LABELS: PartyLabels = {
  counterpartyNoun: "Supplier",
  deliveredLabel: "Delivered to supplier",
} as PartyLabels;

const HELD_ORDER = {
  id: "ord-held-1",
  poNumber: "PO-77120",
  status: "delivery_held",
  supplierId: "sup-1",
  supplierName: "Nordmark",
  errorMessage: null,
} as unknown as Order;

describe("delivery_held — the badge reads as paused, not failed", () => {
  it("has a real label instead of the humanized fallback", () => {
    expect(statusLabel("delivery_held")).toBe("Delivery paused");
    // The old fallback. If this ever comes back, STATUS_META lost its entry.
    expect(statusLabel("delivery_held")).not.toBe("Delivery held");
  });

  it("is amber (needs a human), never the red failure tone", () => {
    expect(statusTone("delivery_held")).toBe("warning");
    expect(statusTone("delivery_held")).not.toBe("danger");
    // ...and not the neutral tone the unknown-status fallback would give it.
    expect(statusTone("delivery_held")).not.toBe("neutral");
  });

  it("renders the paused label", () => {
    render(<UnifiedStatusBadge status="delivery_held" />);
    expect(screen.getByText("Delivery paused")).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });
});

describe("delivery_held — the review message tells the truth", () => {
  it("explains the billing pause and the automatic resume", () => {
    const msg = finalDeliveryMessage("delivery_held", null, LABELS);
    expect(msg).toBe(BILLING_HELD_MESSAGE);
    expect(msg).toMatch(/billing/i);
    expect(msg).toMatch(/automatically/i);
  });

  it("does not fall through to 'still processing' — nothing is processing", () => {
    const msg = finalDeliveryMessage("delivery_held", null, LABELS);
    expect(msg).not.toMatch(/still processing/i);
    expect(msg).not.toMatch(/failed/i);
  });

  it("ignores a stale errorMessage left by an earlier failed attempt", () => {
    // HoldForBillingAsync never sets ErrorMessage; a delivery_failed→delivery_held
    // order still carries the OLD failure text, which explains the wrong problem.
    const msg = finalDeliveryMessage("delivery_held", "Connection refused by supplier endpoint", LABELS);
    expect(msg).toBe(BILLING_HELD_MESSAGE);
    expect(msg).not.toMatch(/Connection refused/);
  });
});

describe("delivery_held — the workshop panel", () => {
  it("explains the pause and points at billing", () => {
    renderHeldPanel();
    expect(screen.getByText("Delivery paused")).toBeInTheDocument();
    // The three load-bearing claims BILLING_HELD_MESSAGE makes — the cause is
    // billing, nothing is lost, and the resume is automatic — asserted as claims
    // rather than as one exact sentence, because the panel now answers the five
    // problem questions in separate lines. `finalDeliveryMessage` below still pins
    // the shared constant itself for the two surfaces that print it whole.
    expect(screen.getByText(/about your plan, not the order/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing failed and nothing is lost/i)).toBeInTheDocument();
    expect(screen.getByText(/starts again by itself/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to billing/i })).toHaveAttribute(
      "href",
      "/settings?tab=billing",
    );
  });

  it("offers no Send action — the backend answers 400 and the release is automatic", () => {
    renderHeldPanel();
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /send/i })).not.toBeInTheDocument();
    expect(isRedeliverable("delivery_held")).toBe(false);
  });

  it("reassures that the mapping and upload survive", () => {
    renderHeldPanel();
    expect(screen.getByText(/don.t need to upload PO-77120 again/i)).toBeInTheDocument();
  });
});
