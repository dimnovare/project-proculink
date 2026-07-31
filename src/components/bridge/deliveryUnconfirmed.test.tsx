import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";

// delivery_unconfirmed (the crash-recovery park) — truthfulness + action guard.
//
// The backend parks a sent-but-unconfirmed order into `delivery_unconfirmed` when a
// crash loses the delivery outcome on a channel that can't tell us whether it arrived
// (backend PR #27). Unlike `delivery_held` (the sibling billing pause), this status:
//   • is a fault (backend counts it in totalProblemOrders) — not a deliberate pause;
//   • resolves ONLY via an operator action, never on its own;
//   • offers TWO actions (send again / mark delivered), not one link to Settings.
// The negative assertions are the point: this status must never read as a failure,
// and the workshop panel must never let a click through without a confirm step that
// states the risk (duplicate vs. never-arrived) in the direction the operator moves.

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  redeliverOrder: vi.fn(),
  markDelivered: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    markDelivered: (...a: unknown[]) => api.markDelivered(...a),
    getOrderById: vi.fn(),
    getOrderPassport: vi.fn().mockResolvedValue(null),
  },
  requeueDelivery: vi.fn(),
  getOpsHealth: vi.fn().mockResolvedValue({ workerHealthy: true }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

import { UnifiedStatusBadge, statusLabel, statusTone } from "./UnifiedStatusBadge";
import { finalDeliveryMessage, DELIVERY_UNCONFIRMED_MESSAGE } from "./review/hooks/useOrderReview";
import { OrderProblemPanel } from "./problem/OrderProblemPanel";
import { isRedeliverable } from "./inboxSend";
import type { Order } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";

afterEach(() => {
  cleanup();
  api.redeliverOrder.mockReset();
  api.markDelivered.mockReset();
});

const LABELS: PartyLabels = {
  counterpartyNoun: "Supplier",
  deliveredLabel: "Delivered to supplier",
} as PartyLabels;

const PARKED_ORDER = {
  id: "ord-parked-1",
  poNumber: "PO-88231",
  status: "delivery_unconfirmed",
  supplierId: "sup-1",
  supplierName: "Nordmark",
  errorMessage: null,
} as unknown as Order;

// Wrapped in the REAL ConfirmProvider (mounted app-wide in src/app/(app)/layout.tsx,
// which is exactly where this panel renders) rather than mocking useConfirm — a
// mocked confirm would prove nothing about the shared dialog actually appearing.
function renderPanel(order: Order = PARKED_ORDER) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <OrderProblemPanel order={order} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe("delivery_unconfirmed — the badge reads as unknown, not failed", () => {
  it("has a real label instead of the humanized fallback", () => {
    expect(statusLabel("delivery_unconfirmed")).toBe("Delivery unknown");
  });

  it("is amber (needs a human), never the red failure tone", () => {
    expect(statusTone("delivery_unconfirmed")).toBe("warning");
    expect(statusTone("delivery_unconfirmed")).not.toBe("danger");
    expect(statusTone("delivery_unconfirmed")).not.toBe("neutral");
  });

  it("renders the unknown label, not 'failed'", () => {
    render(<UnifiedStatusBadge status="delivery_unconfirmed" />);
    expect(screen.getByText("Delivery unknown")).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });
});

describe("delivery_unconfirmed — the review message tells the truth", () => {
  it("says 'may have sent', never 'has not been sent' or 'still processing'", () => {
    const msg = finalDeliveryMessage("delivery_unconfirmed", null, LABELS);
    expect(msg).toBe(DELIVERY_UNCONFIRMED_MESSAGE);
    expect(msg).toMatch(/may have sent/i);
    expect(msg).not.toMatch(/has not been sent/i);
    expect(msg).not.toMatch(/still processing/i);
  });

  it("prefers the backend's pinned park sentence when present", () => {
    const msg = finalDeliveryMessage("delivery_unconfirmed", "Custom park detail from the backend.", LABELS);
    expect(msg).toBe("Custom park detail from the backend.");
  });
});

describe("delivery_unconfirmed — it is redeliverable (unlike delivery_held)", () => {
  it("the backend accepts a redeliver from this status", () => {
    expect(isRedeliverable("delivery_unconfirmed")).toBe(true);
  });
});

describe("delivery_unconfirmed — the workshop panel explains the park", () => {
  it("explains the park using the shared message", () => {
    renderPanel();
    expect(screen.getByText("Delivery unknown")).toBeInTheDocument();
    // The park sentence is the panel's BODY claim. The five-question layout says the
    // rest (what happens automatically — deliberately nothing — and the cost of
    // leaving it), so the assertion is the claim, not one exact sentence.
    expect(screen.getByText(/may have sent this/i)).toBeInTheDocument();
    expect(screen.getByText(/will not send this again by ourselves/i)).toBeInTheDocument();
  });

  it("prefers the backend's errorMessage over the shared fallback", () => {
    renderPanel({ ...PARKED_ORDER, errorMessage: "We sent this at 14:02 but lost the connection before Nordmark confirmed it." } as Order);
    expect(screen.getByText(/lost the connection before Nordmark confirmed/)).toBeInTheDocument();
  });

  // ── The contract CHANGED here, on purpose (WP-24 §5) ───────────────────────
  //
  // This block used to assert "shows BOTH actions — Send again and Mark as
  // delivered", i.e. two buttons that were each ONE click away from a POST behind a
  // single confirm. That is precisely what the packet forbids: re-sending may hand
  // the supplier a duplicate PO on a channel that de-duplicates nothing, and marking
  // delivered may leave them without the order forever. The two resolutions are
  // irreversible in OPPOSITE directions and only the supplier knows which is right.
  //
  // So the actions are now REVEALED by a stated fact ("what did the supplier say?"),
  // one per answer, and the shipped confirm dialog remains the second gate. The full
  // interaction — reveal, single action, confirm copy, answer switching, the recorded
  // assertion — is pinned in problem/__tests__/unconfirmedFriction.test.tsx. What
  // stays here is the negative that this file was written to guard.
  it("offers NO one-click send or mark-delivered — the friction is a stated fact", () => {
    renderPanel();
    for (const b of screen.queryAllByRole("button")) {
      expect(b.textContent ?? "").not.toMatch(/^\s*send again\s*$/i);
      expect(b.textContent ?? "").not.toMatch(/^\s*mark as delivered\s*$/i);
    }
    expect(api.redeliverOrder).not.toHaveBeenCalled();
    expect(api.markDelivered).not.toHaveBeenCalled();
  });
});
