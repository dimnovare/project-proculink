import { describe, it, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { Order } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// delivery_unconfirmed — the hard constraint, tested as a hard constraint.
//
// The whole point of this status is that re-sending MAY hand the supplier a
// second copy of the same PO on a channel that de-duplicates nothing. So the
// screen must not carry a control that sends on one click. The friction is a
// factual assertion — what the supplier actually said — because that is the one
// gate an operator cannot satisfy without picking up the phone.
//
// The shipped panel failed this twice: "Send again" was one click away from a
// POST (behind a single confirm), and the inbox's bulk bar could sweep N parked
// rows through one boolean dialog.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox/ord-parked-1",
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  redeliverOrder: vi.fn(),
  markDelivered: vi.fn(),
  requeueDelivery: vi.fn(),
  transformOrder: vi.fn(),
  retryDelivery: vi.fn(),
  getOrderById: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    markDelivered: (...a: unknown[]) => api.markDelivered(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
    retryDelivery: (...a: unknown[]) => api.retryDelivery(...a),
    getOrderById: (...a: unknown[]) => api.getOrderById(...a),
    getOrderPassport: vi.fn().mockResolvedValue(null),
  },
  requeueDelivery: (...a: unknown[]) => api.requeueDelivery(...a),
  getOpsHealth: vi.fn().mockResolvedValue({ workerHealthy: true }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import { OrderProblemPanel } from "../OrderProblemPanel";
import { isBulkSelectable } from "../../inboxSend";

const PARKED = {
  id: "ord-parked-1",
  poNumber: "PO-88231",
  status: "delivery_unconfirmed",
  supplierId: "sup-1",
  supplierName: "Nordmark",
  currency: "EUR",
  orderDate: "2026-07-14",
  lines: [],
  artifacts: [],
  errorMessage: null,
} as unknown as Order;

function renderPanel(order: Order = PARKED) {
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

/** Every button on screen, by its visible text. */
function buttonTexts(): string[] {
  return Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.redeliverOrder.mockResolvedValue(undefined);
  api.markDelivered.mockResolvedValue(undefined);
  sessionStorage.clear();
});
afterEach(cleanup);

describe("delivery_unconfirmed — nothing sends on one click", () => {
  it("renders NO send-shaped control before the operator states what the supplier said", () => {
    renderPanel();

    // The claim below is a NEGATIVE one, and a negative claim about an empty tree is
    // free. Every assertion used to live inside `for (const label of buttonTexts())`,
    // so a panel that rendered nothing at all — a crashed query, a dropped status
    // branch, a `return null` — passed with exactly the same green as correct
    // behaviour. Prove the panel is really on screen FIRST, then prove what it omits.
    const labels = buttonTexts();
    expect(labels.length, "the panel rendered no buttons at all").toBeGreaterThan(0);
    expect(screen.getByRole("group")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      labels.some((l) => /copy details/i.test(l)),
      `no "Copy details" control among: ${labels.join(" | ")}`,
    ).toBe(true);

    for (const label of labels) {
      expect(label).not.toMatch(/send (it )?(to them )?again/i);
      expect(label).not.toMatch(/mark (it )?(as )?delivered/i);
    }
  });

  it("asks the question as a real radio group, so the answer is a stated fact", () => {
    renderPanel();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("group")).toBeTruthy();
    for (const r of radios) expect((r as HTMLInputElement).checked).toBe(false);
  });

  it("gives the operator the details they need for the phone call", () => {
    renderPanel();
    expect(screen.getByText(/PO-88231/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy details/i })).toBeTruthy();
  });
});

describe("delivery_unconfirmed — one answer, one action", () => {
  it("'they don't have it' reveals only the re-send, and it still confirms first", async () => {
    const { invalidateSpy } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /don.t have it/i }));

    const send = screen.getByRole("button", { name: /send it to them again/i });
    expect(screen.queryByRole("button", { name: /mark it as delivered/i })).toBeNull();
    expect(screen.getByText(/will receive this order for the first time/i)).toBeTruthy();

    fireEvent.click(send);
    // Gate two: the risk is stated in the direction the operator is moving.
    expect(screen.getByText("Send this order again?")).toBeTruthy();
    expect(
      screen.getByText("If the supplier already received this order, sending again may give them a duplicate."),
    ).toBeTruthy();
    expect(api.redeliverOrder).not.toHaveBeenCalled();

    const confirms = screen.getAllByRole("button", { name: "Send again" });
    fireEvent.click(confirms[confirms.length - 1]);

    await waitFor(() => expect(api.redeliverOrder).toHaveBeenCalledWith("ord-parked-1"));
    expect(api.markDelivered).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["order", "ord-parked-1"] });
  });

  it("'they have it' reveals only mark-delivered, and confirms the opposite risk", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /they have it/i }));

    expect(screen.queryByRole("button", { name: /send it to them again/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /mark it as delivered/i }));

    expect(screen.getByText("Mark this order as delivered?")).toBeTruthy();
    expect(
      screen.getByText("If the supplier never received this order, marking it delivered means it will not be sent."),
    ).toBeTruthy();
    expect(api.markDelivered).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mark delivered" }));
    await waitFor(() => expect(api.markDelivered).toHaveBeenCalledWith("ord-parked-1"));
    expect(api.redeliverOrder).not.toHaveBeenCalled();
  });

  it("'haven't reached them yet' offers no resolution at all — that is the honest answer", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /haven.t been able to reach/i }));

    expect(screen.queryByRole("button", { name: /send it to them again/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark it as delivered/i })).toBeNull();
    expect(screen.getByText(/We won.t send anything until you know/i)).toBeTruthy();
  });

  it("changing the answer withdraws the previous action — never both at once", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /don.t have it/i }));
    expect(screen.getByRole("button", { name: /send it to them again/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /they have it/i }));
    expect(screen.queryByRole("button", { name: /send it to them again/i })).toBeNull();
    expect(screen.getByRole("button", { name: /mark it as delivered/i })).toBeTruthy();
  });

  it("cancelling the confirm sends nothing", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /don.t have it/i }));
    fireEvent.click(screen.getByRole("button", { name: /send it to them again/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.redeliverOrder).not.toHaveBeenCalled();
    expect(api.markDelivered).not.toHaveBeenCalled();
  });

  it("records the operator's assertion, because the endpoints cannot carry it yet", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /they have it/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark it as delivered/i }));
    fireEvent.click(screen.getByRole("button", { name: "Mark delivered" }));

    await waitFor(() => expect(api.markDelivered).toHaveBeenCalled());
    expect(screen.getByText(/You recorded:/i)).toBeTruthy();
    expect(sessionStorage.getItem("problemAssertion:ord-parked-1")).toMatch(/already in their system/i);
  });
});

describe("delivery_unconfirmed — the inbox is not a way around the question", () => {
  test("a parked row is not bulk-selectable, so one confirm can never send N of them", () => {
    expect(isBulkSelectable("delivery_unconfirmed")).toBe(false);
    // The set the bulk bar may act on is exactly the backend's
    // ClaimableForRetryFrom — an automatic path never claims a park.
    expect(isBulkSelectable("ready_to_deliver")).toBe(true);
    expect(isBulkSelectable("delivery_failed")).toBe(true);
    for (const s of ["delivery_held", "delivery_dead_letter", "rejected_by_supplier", "failed", "pending_review"]) {
      expect(isBulkSelectable(s), s).toBe(false);
    }
  });
});
