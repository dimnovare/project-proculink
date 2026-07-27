import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Order, SupplierSuggestion } from "@/types/procurement";

/* =====================================================================
   The assign-supplier banner, once the backend can say who it thinks the
   order is for (GET /api/orders/{id} → supplierSuggestions, PR #70).

   The whole contract here is SUGGEST-ONLY. The order is still `unrouted`
   and stays that way until a human posts assign-supplier, so nothing in
   this UI may read as a decision already taken: no preselection, no
   auto-assign at any score, and the manual picker never goes away.
   ===================================================================== */

const { StubApiHttpError, api } = vi.hoisted(() => ({
  StubApiHttpError: class extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body?: unknown) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
      this.body = body;
    }
  },
  api: {
    getSuppliers: vi.fn(),
    assignSupplier: vi.fn(),
  },
}));

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  ApiHttpError: StubApiHttpError,
  apiClient: {
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    assignSupplier: (...a: unknown[]) => api.assignSupplier(...a),
  },
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    direction: "outbound",
    labels: {
      counterpartyNoun: "Supplier",
      counterpartyPlural: "Suppliers",
      railHeader: "Buyer → Supplier",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent to supplier",
      deliveredLabel: "Delivered to supplier",
      unknownBuyer: "Unknown buyer",
    },
  }),
}));

import { AssignSupplierBanner } from "./AssignSupplierBanner";

const SUPPLIERS = [
  { id: "sup-fast", name: "FastParts Inc" },
  { id: "sup-electro", name: "ElectroSupply Co" },
  { id: "sup-global", name: "GlobalComponents" },
];

function suggestion(over: Partial<SupplierSuggestion> = {}): SupplierSuggestion {
  return {
    id: "sug-1",
    supplierId: "sup-fast",
    supplierName: "FastParts Inc",
    rank: 1,
    score: 0.72,
    reason: "FastParts Inc — the supplier name on the document matches theirs, and 8 of 10 item codes are in their catalog.",
    signals: [
      { signal: "supplier_name", contribution: 0.2, detail: "the supplier name on the document matches theirs" },
      { signal: "catalog_overlap", contribution: 0.52, detail: "8 of 10 item codes are in their catalog" },
    ],
    ...over,
  };
}

function order(over: Partial<Order> = {}): Order {
  return {
    id: "ord-004",
    poNumber: "PO-2024-011145",
    supplierId: "",
    supplierName: "",
    buyerName: "Acme Manufacturing",
    orderDate: "2024-01-16",
    currency: "EUR",
    status: "unrouted",
    createdAt: "2024-01-16T08:05:00Z",
    updatedAt: "2024-01-16T08:06:00Z",
    lines: [],
    artifacts: [],
    ...over,
  };
}

function renderBanner(o: Order) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AssignSupplierBanner order={o} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  api.getSuppliers.mockReset();
  api.assignSupplier.mockReset();
});

describe("AssignSupplierBanner — ranked supplier suggestions", () => {
  it("lists the candidates best-first, with each one's score and reason", async () => {
    api.getSuppliers.mockResolvedValue(SUPPLIERS);

    renderBanner(
      order({
        supplierSuggestions: [
          suggestion(),
          suggestion({
            id: "sug-2",
            supplierId: "sup-electro",
            supplierName: "ElectroSupply Co",
            rank: 2,
            score: 0.41,
            reason: "ElectroSupply Co — earlier orders from this sender were routed to them.",
            signals: [{ signal: "sender_domain_history", contribution: 0.41, detail: "earlier orders from this sender were routed to them" }],
          }),
        ],
      }),
    );

    const list = await screen.findByTestId("supplier-suggestions");
    const rows = within(list).getAllByTestId(/^supplier-suggestion-/);

    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("FastParts Inc")).toBeInTheDocument();
    expect(within(rows[0]).getByText("72%")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/8 of 10 item codes are in their catalog/i)).toBeInTheDocument();
    expect(within(rows[1]).getByText("ElectroSupply Co")).toBeInTheDocument();
    expect(within(rows[1]).getByText("41%")).toBeInTheDocument();
  });

  it("shows at most three candidates even when the backend sends more", async () => {
    api.getSuppliers.mockResolvedValue(SUPPLIERS);

    renderBanner(
      order({
        supplierSuggestions: [1, 2, 3, 4].map((n) =>
          suggestion({ id: `sug-${n}`, supplierId: `sup-${n}`, supplierName: `Candidate ${n}`, rank: n, score: 0.9 - n / 10 }),
        ),
      }),
    );

    const list = await screen.findByTestId("supplier-suggestions");
    expect(within(list).getAllByTestId(/^supplier-suggestion-/)).toHaveLength(3);
  });

  it("assigns the candidate the operator picked, and says which suggestion it came from", async () => {
    api.getSuppliers.mockResolvedValue(SUPPLIERS);
    api.assignSupplier.mockResolvedValue(order({ status: "parsing" }));

    renderBanner(
      order({
        supplierSuggestions: [
          suggestion(),
          suggestion({ id: "sug-2", supplierId: "sup-electro", supplierName: "ElectroSupply Co", rank: 2, score: 0.41 }),
        ],
      }),
    );

    const list = await screen.findByTestId("supplier-suggestions");
    const second = within(list).getByTestId("supplier-suggestion-sug-2");
    fireEvent.click(within(second).getByRole("button", { name: /assign ElectroSupply Co/i }));

    // suggestionId travels with the assign so the backend can record the decision as
    // an ACCEPTED suggestion rather than an unattributable manual pick.
    await waitFor(() => expect(api.assignSupplier).toHaveBeenCalledWith("ord-004", "sup-electro", "sug-2"));
  });

  it("keeps the per-signal breakdown behind a toggle rather than in the operator's face", async () => {
    api.getSuppliers.mockResolvedValue(SUPPLIERS);

    renderBanner(order({ supplierSuggestions: [suggestion()] }));

    const row = await screen.findByTestId("supplier-suggestion-sug-1");
    const toggle = within(row).getByRole("button", { name: /why this match/i });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(row).queryByTestId("supplier-suggestion-signals")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const signals = within(row).getByTestId("supplier-suggestion-signals");
    expect(within(signals).getByText(/name on the document/i)).toBeInTheDocument();
    expect(within(signals).getByText(/item codes are in their catalog/i)).toBeInTheDocument();
  });

  it("never preselects a candidate — the manual picker stays empty and available", async () => {
    api.getSuppliers.mockResolvedValue(SUPPLIERS);

    renderBanner(order({ supplierSuggestions: [suggestion()] }));

    await screen.findByTestId("supplier-suggestions");

    // The picker is still there for "none of these", and its own Assign button is
    // disabled because nothing has been chosen. A suggestion sitting pre-selected
    // would read as a routing decision the operator never made.
    expect(screen.getByRole("button", { name: /^assign supplier$/i })).toBeDisabled();
    expect(screen.getByText(/none of these/i)).toBeInTheDocument();
  });

  it("leaves the banner exactly as it was when there is nothing to suggest", async () => {
    api.getSuppliers.mockResolvedValue(SUPPLIERS);

    renderBanner(order({ supplierSuggestions: [] }));

    await screen.findByRole("button", { name: /^assign supplier$/i });

    expect(screen.queryByTestId("supplier-suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText(/none of these/i)).not.toBeInTheDocument();
    expect(screen.getByText(/needs a supplier/i)).toBeInTheDocument();
  });

  it("treats an order with no suggestions field at all the same way", async () => {
    api.getSuppliers.mockResolvedValue(SUPPLIERS);

    renderBanner(order());

    await screen.findByRole("button", { name: /^assign supplier$/i });
    expect(screen.queryByTestId("supplier-suggestions")).not.toBeInTheDocument();
  });

  it("reports a 409 on an accepted suggestion as 'already routed', not as a failure", async () => {
    api.getSuppliers.mockResolvedValue(SUPPLIERS);
    api.assignSupplier.mockRejectedValue(
      new StubApiHttpError("assign-supplier failed: Order is not awaiting routing", 409, null),
    );

    renderBanner(order({ supplierSuggestions: [suggestion()] }));

    const row = await screen.findByTestId("supplier-suggestion-sug-1");
    fireEvent.click(within(row).getByRole("button", { name: /assign FastParts Inc/i }));

    expect(await screen.findByText(/already been routed/i)).toBeInTheDocument();
  });

  it("surfaces the backend's own words when an accepted suggestion is rejected (400)", async () => {
    api.getSuppliers.mockResolvedValue(SUPPLIERS);
    api.assignSupplier.mockRejectedValue(
      new StubApiHttpError("assign-supplier failed: Supplier not found", 400, null),
    );

    renderBanner(order({ supplierSuggestions: [suggestion()] }));

    const row = await screen.findByTestId("supplier-suggestion-sug-1");
    fireEvent.click(within(row).getByRole("button", { name: /assign FastParts Inc/i }));

    expect(await screen.findByText(/supplier not found/i)).toBeInTheDocument();
  });
});
