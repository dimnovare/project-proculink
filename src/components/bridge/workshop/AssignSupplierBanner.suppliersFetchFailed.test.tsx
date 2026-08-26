import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Order } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT FAMILY: a failed fetch renders as a settled answer.
//
// The shape, everywhere it appeared: a useQuery result destructured WITHOUT
// `isError`, with a default (`data: xs = []` or `data?.field ?? "literal"`)
// that is then rendered as if the server had answered. A failed request and an
// empty/default answer become indistinguishable, and the UI states the default
// as fact.
//
// THIS banner is the worst instance. It is the BLOCKING banner of an `unrouted`
// order — the only in-app way to route it. Its suppliers query defaulted to []
// with no error branch, and `noSuppliers = !loading && suppliers.length === 0`
// treated a dead endpoint as an org with zero suppliers: an org with 40
// suppliers was told "Add a supplier →" and LOST the picker — the one control
// that routes the order.
//
// FAMILY GUARD — for the next audit, re-run these greps over src/ instead of a
// repo-wide scanner test (whole-tree scanners time out in this repo):
//
//     grep -rnE 'data: \w+ = \[\]'      src --include=*.ts --include=*.tsx
//     grep -rnE 'data\?\.\w+ \?\? "'    src --include=*.ts --include=*.tsx
//
// For every hit, check the destructuring for `isError` and check what the
// default renders as. A hit with no error branch whose default reaches copy
// like "No X yet", a checked radio, or a disabled control is this defect again.
// Fixed instances as of 2026-08-20: AssignSupplierBanner, settings page
// (suppliers + org-direction + plan label), useOrderDirection (exposes
// isDirectionKnown), SupplierIdentityCard, CommandPalette (suppliers/buyers),
// BridgeSidebar plan label, ConnectionDetail sample order.
// ─────────────────────────────────────────────────────────────────────────────

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
  getOrgSettings: vi.fn(),
};

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

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
  getOrgSettings: (...a: unknown[]) => api.getOrgSettings(...a),
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
  api.assignSupplier.mockReset().mockResolvedValue({ ...UNROUTED_ORDER, status: "parsing" });
  api.getAiCalibration.mockReset().mockResolvedValue({ isActive: false, buckets: [] });
  api.getOrgSettings.mockReset().mockResolvedValue({ direction: "outbound" });
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

describe("assign supplier — a failed supplier fetch is not an org with no suppliers", () => {
  it("on a failed fetch: says the list could not be loaded, offers a retry, and never claims the org has no suppliers", async () => {
    api.getSuppliers.mockReset().mockRejectedValue(new Error("network down"));

    renderBanner();
    const banner = within(screen.getByTestId("order-needs-supplier"));

    // The error branch must exist and say what actually happened…
    // (the query retries once with ~1s backoff before settling as an error)
    expect(await banner.findByText(/couldn.t load/i, undefined, { timeout: 5000 })).toBeInTheDocument();
    // …with a way back that is not "go create a duplicate supplier".
    expect(banner.getByRole("button", { name: /try again/i })).toBeInTheDocument();

    // The wrong claim. "Add a supplier →" on the blocking banner of an unrouted
    // order tells an org with 40 suppliers it has none and removes the only
    // control that routes the order.
    expect(banner.queryByText(/add a supplier/i)).not.toBeInTheDocument();
  });

  it("retry refetches: once the list loads, the picker is back", async () => {
    // The query auto-retries once (retry: 1), so fail BOTH attempts before the
    // manual retry is allowed to succeed.
    api.getSuppliers
      .mockReset()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(SUPPLIERS);

    renderBanner();
    const banner = within(screen.getByTestId("order-needs-supplier"));

    fireEvent.click(
      await banner.findByRole("button", { name: /try again/i }, { timeout: 5000 }),
    );

    // The manual refetch (third call) succeeds → the real picker returns.
    expect(await banner.findByRole("combobox", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(banner.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
    await waitFor(() => expect(api.getSuppliers).toHaveBeenCalledTimes(3));
  });

  // CONTROL — proves the assertions above bite on the real component and that
  // the happy path is unchanged: with a resolved list the picker renders and
  // neither the error branch nor the no-suppliers link appears.
  it("control: a resolved supplier list still renders the picker", async () => {
    renderBanner();
    const banner = within(screen.getByTestId("order-needs-supplier"));

    expect(await banner.findByRole("combobox")).toBeInTheDocument();
    expect(banner.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
    expect(banner.queryByText(/add a supplier/i)).not.toBeInTheDocument();
  });

  // CONTROL — a genuinely empty org (settled answer of zero) keeps the honest
  // "Add a supplier →" route. The error branch must not swallow this state.
  it("control: a settled empty list still says to add a supplier", async () => {
    api.getSuppliers.mockReset().mockResolvedValue([]);

    renderBanner();
    const banner = within(screen.getByTestId("order-needs-supplier"));

    expect(await banner.findByText(/add a supplier/i)).toBeInTheDocument();
    expect(banner.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });
});
