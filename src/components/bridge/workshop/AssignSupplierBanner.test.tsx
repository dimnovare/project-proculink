import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Order } from "@/types/procurement";

// AssignSupplierBanner — the only in-app way out of `unrouted`.
//
// An order ingested on a content-routed channel (SFTP / S3 / IMAP) with no resolvable
// supplier parses and parks as `unrouted`: header and lines are persisted, but nothing
// can be normalised because there is no supplier to resolve item codes against. The
// backend has always exposed the fix (POST /orders/{id}/assign-supplier); until this
// banner the frontend never called it, so the one order that REQUIRED an operator was
// the one the product gave no way to act on.
//
// Two things these tests exist to stop:
//
//  1. A banner nobody mounts. The workshop's own topbar badge reads "Needs review" for
//     an unrouted order (the line-level exception flag outranks the routing one), so the
//     mount MUST key on order.status. The wiring test at the bottom is the guard — an
//     exported-but-unrendered panel is dead UI, not a feature.
//  2. A 409 reported as a failure. The assign is an ATOMIC claim (`unrouted` → `parsing`
//     conditional update); a second operator, a second tab, or an ingress re-route makes
//     it match no row. That is not the operator's click failing — it is the work already
//     being done, and it reads completely differently.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

const api = {
  getSuppliers: vi.fn(),
  assignSupplier: vi.fn(),
  getAiCalibration: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox/ord-unrouted",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    assignSupplier: (...a: unknown[]) => api.assignSupplier(...a),
    getAiCalibration: (...a: unknown[]) => api.getAiCalibration(...a),
  },
  getMappingOverride: vi.fn().mockResolvedValue(null),
  previewMappingOverride: vi.fn().mockResolvedValue(null),
  ApiHttpError: class ApiHttpError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown = null) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
      this.body = body;
    }
  },
}));

import { ApiHttpError } from "@/lib/api-client";

const SUPPLIERS = [
  { id: "sup-nordmark", name: "Nordmark Logistics" },
  { id: "sup-boltworks", name: "BoltWorks BV" },
];

const UNROUTED_ORDER = {
  id: "ord-unrouted",
  poNumber: "PO-55031",
  status: "unrouted",
  supplierId: null,
  supplierName: "",
  buyerName: "Heinrich Industries GmbH",
  orderDate: "2026-07-20",
  currency: "EUR",
  lines: [],
  artifacts: [],
} as unknown as Order;

beforeEach(() => {
  api.getSuppliers.mockReset().mockResolvedValue(SUPPLIERS);
  api.assignSupplier.mockReset().mockResolvedValue({ ...UNROUTED_ORDER, status: "parsing", supplierId: "sup-nordmark" });
  api.getAiCalibration.mockReset().mockResolvedValue({ isActive: false, buckets: [] });
});

afterEach(cleanup);

import { AssignSupplierBanner } from "./AssignSupplierBanner";

function renderBanner(order: Order = UNROUTED_ORDER) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <AssignSupplierBanner order={order} />
      </QueryClientProvider>,
    ),
  };
}

/** Open the combobox and choose a supplier by its visible name. */
async function pickSupplier(name: string) {
  fireEvent.click(await screen.findByRole("combobox"));
  fireEvent.click(await screen.findByText(name));
}

describe("assign supplier — the banner asks for the one missing thing", () => {
  it("says what is missing and what happens next", async () => {
    renderBanner();

    expect(screen.getByText(/needs a supplier/i)).toBeInTheDocument();
    // The assign re-runs the parse against the chosen supplier — an operator who
    // isn't told that reads the order flipping back to "reading" as a regression.
    expect(screen.getByText(/read .*again|re-read/i)).toBeInTheDocument();
  });

  it("will not fire an assign with no supplier chosen", async () => {
    renderBanner();

    const btn = screen.getByRole("button", { name: /assign supplier/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(api.assignSupplier).not.toHaveBeenCalled();
  });

  it("posts the supplier the operator actually picked", async () => {
    renderBanner();
    await pickSupplier("BoltWorks BV");

    fireEvent.click(screen.getByRole("button", { name: /assign supplier/i }));

    await waitFor(() =>
      expect(api.assignSupplier).toHaveBeenCalledWith("ord-unrouted", "sup-boltworks"),
    );
  });

  it("tells the operator the document is being read again, and refreshes the order", async () => {
    const { qc } = renderBanner();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await pickSupplier("Nordmark Logistics");

    fireEvent.click(screen.getByRole("button", { name: /assign supplier/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/supplier assigned/i);
    // Without the invalidation the order sits on `unrouted` in cache and the banner
    // stays up, so the assign looks like it did nothing.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["order", "ord-unrouted"] })),
    );
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["orders"] }));
  });

  it("does not let a double click send a second assign", async () => {
    let resolve!: (v: unknown) => void;
    api.assignSupplier.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderBanner();
    await pickSupplier("Nordmark Logistics");

    const btn = screen.getByRole("button", { name: /assign supplier/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(api.assignSupplier).toHaveBeenCalledTimes(1);

    resolve({ ...UNROUTED_ORDER, status: "parsing" });
    // Let the in-flight assign settle inside the test, so its state update isn't
    // left to land after teardown (which React reports as an act() warning).
    await screen.findByRole("status");
  });
});

describe("assign supplier — a rejected assign says which kind of rejection", () => {
  it("reports a 409 as someone else having routed it, not as a failed click", async () => {
    api.assignSupplier.mockRejectedValue(
      new ApiHttpError(
        "assign-supplier failed: Order is not awaiting routing (it already has a supplier or is in another state).",
        409,
        { error: "Order is not awaiting routing (it already has a supplier or is in another state)." },
      ),
    );
    const { qc } = renderBanner();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await pickSupplier("Nordmark Logistics");

    fireEvent.click(screen.getByRole("button", { name: /assign supplier/i }));

    // Deliberately NOT /already/i: the raw backend string ("it already has a
    // supplier or is in another state") contains that word too, so a generic
    // error path would satisfy the loose match and this test would prove nothing.
    expect(await screen.findByText(/already been routed/i)).toBeInTheDocument();
    expect(screen.queryByText(/not awaiting routing/i)).not.toBeInTheDocument();
    // A 409 means the SERVER holds a newer truth than this screen — refetching is the
    // only thing that ends the confusion.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["order", "ord-unrouted"] })),
    );
  });

  it("shows the backend's own words when the supplier is rejected", async () => {
    api.assignSupplier.mockRejectedValue(
      new ApiHttpError("assign-supplier failed: Supplier not found.", 400, { error: "Supplier not found." }),
    );
    renderBanner();
    await pickSupplier("Nordmark Logistics");

    fireEvent.click(screen.getByRole("button", { name: /assign supplier/i }));

    expect(await screen.findByText(/supplier not found/i)).toBeInTheDocument();
    // The 409 copy would be a lie here — nobody else touched this order.
    expect(screen.queryByText(/already/i)).not.toBeInTheDocument();
    // ...and the operator gets their button back to pick a different supplier.
    await waitFor(() => expect(screen.getByRole("button", { name: /assign supplier/i })).toBeEnabled());
  });

  it("offers to add a supplier instead of an empty picker when the org has none", async () => {
    api.getSuppliers.mockResolvedValue([]);
    renderBanner();

    // Offering a picker that cannot pick anything is the offer⇔works violation this
    // guards: with no suppliers the only real next step is creating one.
    expect(await screen.findByRole("link", { name: /add a supplier/i })).toHaveAttribute("href", "/library/suppliers");
    expect(screen.queryByRole("button", { name: /assign supplier/i })).not.toBeInTheDocument();
  });
});

// ── Workshop wiring ──────────────────────────────────────────────────────────
// Everything below proves the banner is MOUNTED, keyed on the order's status.

const workshopState: { order: Order | null; exceptionCount: number } = {
  order: null,
  exceptionCount: 0,
};

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    direction: "outbound",
    labels: {
      counterpartyNoun: "Supplier",
      counterpartyPlural: "Suppliers",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent",
      deliveredLabel: "Delivered to supplier",
      unknownBuyer: "Unknown buyer",
    },
  }),
}));
vi.mock("../review/hooks/useOrderReview", () => ({
  useOrderReview: () => ({
    order: workshopState.order,
    isLoading: false,
    isError: false,
    refetchOrder: vi.fn().mockResolvedValue(undefined),
    exceptionCount: workshopState.exceptionCount,
  }),
}));
vi.mock("../review/hooks/useSendFlow", () => ({
  useSendFlow: () => ({
    flowNotice: null, flowSeverity: "info", setFlow: vi.fn(), sendState: "idle",
    crossed: false, confirmSend: vi.fn(), showConfirm: false, setShowConfirm: vi.fn(),
  }),
}));
vi.mock("../review/hooks/useResolveActions", () => ({
  useResolveActions: () => ({
    acceptSuggestion: vi.fn(), commitVersion: 0, lineEditId: null, lineDraft: "",
    setLineDraft: vi.fn(), startLineEdit: vi.fn(), commitLineCode: vi.fn(),
    cancelLineEdit: vi.fn(), confirmFlaggedLine: vi.fn(), acceptingLineId: null,
    bulkAcceptSuggestions: vi.fn(), bulkAccepting: false,
  }),
}));
vi.mock("../review/hooks/useAcceptanceValidation", () => ({
  useAcceptanceValidation: () => ({ validationResult: null, failingRuleCount: 0, isStale: false }),
}));
vi.mock("../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: Record<string, unknown>) => {
    const onToolbarState = props.onToolbarState as ((s: unknown) => void) | undefined;
    useEffect(() => {
      onToolbarState?.({ mapped: 0, total: 0, requiredUnmapped: 0, saving: false, justSaved: false, error: null, aiUnavailable: false, showConnections: true, toggleConnections: vi.fn(), openLayoutDesigner: vi.fn(), openTemplateEditor: vi.fn(), catalogHintCount: 0, fillFromCatalog: null });
    }, [onToolbarState]);
    return <div data-testid="mock-mapper-workbench" />;
  },
}));

import { OrderWorkshop } from "./OrderWorkshop";

function renderWorkshop(order: Order, exceptionCount = 0) {
  workshopState.order = order;
  workshopState.exceptionCount = exceptionCount;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderWorkshop orderId={order.id} />
    </QueryClientProvider>,
  );
}

describe("assign supplier — the workshop actually mounts the banner", () => {
  it("shows it for an unrouted order", async () => {
    renderWorkshop(UNROUTED_ORDER);

    expect(await screen.findByText(/needs a supplier/i)).toBeInTheDocument();
  });

  it("shows it even though the status badge on this screen says 'Needs review'", async () => {
    // The unrouted order's line-level exception flag drives that badge, so keying the
    // banner off anything but order.status hides it exactly when it is needed.
    renderWorkshop(UNROUTED_ORDER, 4);

    expect(await screen.findByText(/needs a supplier/i)).toBeInTheDocument();
  });

  it("does not show it once the order has a supplier", async () => {
    const routed = { ...UNROUTED_ORDER, status: "pending_review", supplierId: "sup-nordmark", supplierName: "Nordmark Logistics" } as unknown as Order;
    renderWorkshop(routed);

    await screen.findByTestId("order-workshop");
    expect(screen.queryByText(/needs a supplier/i)).not.toBeInTheDocument();
  });
});
