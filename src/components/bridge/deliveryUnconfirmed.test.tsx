import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
  apiClient: {
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    markDelivered: (...a: unknown[]) => api.markDelivered(...a),
  },
}));

import { UnifiedStatusBadge, statusLabel, statusTone } from "./UnifiedStatusBadge";
import { finalDeliveryMessage, DELIVERY_UNCONFIRMED_MESSAGE } from "./review/hooks/useOrderReview";
import { DeliveryUnconfirmedPanel } from "./workshop/DeliveryUnconfirmedPanel";
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

function renderPanel(order: Order = PARKED_ORDER) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <DeliveryUnconfirmedPanel order={order} />
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

describe("delivery_unconfirmed — the workshop panel offers both actions", () => {
  it("explains the park using the shared message", () => {
    renderPanel();
    expect(screen.getByText("Delivery unknown")).toBeInTheDocument();
    expect(screen.getByText(DELIVERY_UNCONFIRMED_MESSAGE)).toBeInTheDocument();
  });

  it("prefers the backend's errorMessage over the shared fallback", () => {
    renderPanel({ ...PARKED_ORDER, errorMessage: "We sent this at 14:02 but lost the connection before Nordmark confirmed it." } as Order);
    expect(screen.getByText(/lost the connection before Nordmark confirmed/)).toBeInTheDocument();
    expect(screen.queryByText(DELIVERY_UNCONFIRMED_MESSAGE)).not.toBeInTheDocument();
  });

  it("shows BOTH actions — Send again and Mark as delivered", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Send again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as delivered" })).toBeInTheDocument();
  });

  it("Send again requires confirmation with the spec-pinned duplicate-risk copy before calling redeliverOrder", async () => {
    api.redeliverOrder.mockResolvedValue(undefined);
    const { invalidateSpy } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    // The confirm dialog states the risk BEFORE the call happens.
    expect(screen.getByText("Send this order again?")).toBeInTheDocument();
    expect(
      screen.getByText("If the supplier already received this order, sending again may give them a duplicate."),
    ).toBeInTheDocument();
    expect(api.redeliverOrder).not.toHaveBeenCalled();

    // Two "Send again" buttons now exist: the panel's original trigger (still
    // mounted behind the dialog) and the dialog's own confirm button, rendered
    // after it in document order — the confirm button is the LAST match.
    const sendAgainButtons = screen.getAllByRole("button", { name: "Send again" });
    fireEvent.click(sendAgainButtons[sendAgainButtons.length - 1]);

    await waitFor(() => expect(api.redeliverOrder).toHaveBeenCalledWith("ord-parked-1"));
    expect(api.markDelivered).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["order", "ord-parked-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["orders"] });
  });

  it("Mark as delivered requires confirmation with the spec-pinned never-arrived copy before calling markDelivered", async () => {
    api.markDelivered.mockResolvedValue(undefined);
    const { invalidateSpy } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Mark as delivered" }));
    expect(screen.getByText("Mark this order as delivered?")).toBeInTheDocument();
    expect(
      screen.getByText("If the supplier never received this order, marking it delivered means it will not be sent."),
    ).toBeInTheDocument();
    expect(api.markDelivered).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mark delivered" }));

    await waitFor(() => expect(api.markDelivered).toHaveBeenCalledWith("ord-parked-1"));
    expect(api.redeliverOrder).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["order", "ord-parked-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["orders"] });
  });

  it("Cancel dismisses the confirm dialog without calling either client method", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    expect(screen.getByText("Send this order again?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Send this order again?")).not.toBeInTheDocument();
    expect(api.redeliverOrder).not.toHaveBeenCalled();
    expect(api.markDelivered).not.toHaveBeenCalled();
  });
});
