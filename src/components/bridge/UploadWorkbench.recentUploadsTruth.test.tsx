/* ── /upload: what a failed fetch is allowed to claim, and which side is which ──
 *
 * THREE DEFECTS, all in the same region of UploadWorkbench.tsx.
 *
 * (1) A FAILED FETCH READ AS AN EMPTY WORKSPACE.
 *
 *       const isEmptyOrg = !isApiMockMode && suppliers.length === 0 && recentRows.length === 0;
 *
 *     Both queries destructure `data = []`, and the orders query had no `isError` read at
 *     all. So a workspace with 30 suppliers whose API call failed reached that line looking
 *     exactly like a brand-new one, and was greeted with "New here? Start with a sample
 *     order" — rendered directly above its own "We couldn't load your suppliers". Two
 *     statements on one screen, one of them fabricated out of an error.
 *
 *     The distinction the fix has to make is "the fetch failed" vs "there is genuinely
 *     nothing": same component, same rendered value, different query state. That is the
 *     whole defect, so both states are driven below.
 *
 * (2) BOTH ENDS OF THE ROUTE PRINTED GREEN.
 *
 *       <span style={{ color: "#1E6D29" }}>{row.buyer}</span>
 *       <span style={{ background: "linear-gradient(90deg, #2E8E3A, #1E6D29)" }} />
 *       <span style={{ color: "#1E6D29" }}>{row.supplier}</span>
 *
 *     Buyer and supplier in the same green, with a green→green arrow between them. Per
 *     CLAUDE.md §2 the label/colour pair is one of only TWO surviving buyer-left /
 *     supplier-right signatures now that the edge rails are struck, and this cell was
 *     carrying none of it. InboxView.tsx renders the same two values correctly.
 *
 * (3) A COLUMN THAT COULD ONLY EVER SAY "UNKNOWN".
 *
 *       size: "—",
 *
 *     Hardcoded at the real-order mapping, because the orders API carries no file size. So
 *     the Size column was an em-dash in every row, for every real user, forever.
 *
 * jsdom applies no Tailwind, so the mobile card list (`lg:hidden`) AND the desktop table
 * (`hidden lg:block`) both mount. Every assertion below is scoped with
 * `within(getByTestId(...))`, and each block asserts the OTHER tree exists too — an
 * unscoped query here would be answering a different question on whichever tree it hit
 * first, and a scoping that silently matched nothing would pass every negative.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Supplier } from "@/types/procurement";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/upload",
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  getSuppliers: vi.fn(),
  getOrders: vi.fn(),
  detectFormat: vi.fn(),
  uploadPurchaseOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
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
  getBillingStatus: () =>
    Promise.resolve({ canProcessOrders: true, isTrialExpired: false, plan: "growth", accountStatus: "active" }),
  getOrgSettings: () => Promise.resolve({ direction: "outbound" }),
  apiClient: {
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    detectFormat: (...a: unknown[]) => api.detectFormat(...a),
    uploadPurchaseOrder: (...a: unknown[]) => api.uploadPurchaseOrder(...a),
  },
}));

vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOnboardingStatus", () => ({ useOnboardingStatus: () => ({ data: undefined }) }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
  usePracticeOrderEmail: () => "",
}));

import { UploadWorkbench } from "./UploadWorkbench";

const SUPPLIER: Supplier = { id: "sup-1", name: "BoltWorks BV", code: "BOLT", status: "active" } as Supplier;

function order(over: Record<string, unknown> = {}) {
  return {
    id: "ord-77",
    poNumber: "PO-77.csv",
    supplierId: "sup-1",
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-08-01",
    currency: "EUR",
    status: "delivered",
    sourceFormat: "csv",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lines: [],
    artifacts: [],
    ...over,
  };
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UploadWorkbench />
    </QueryClientProvider>,
  );
  // Wait for BOTH queries to settle — the claim under test is about their settled states.
  await waitFor(() => {
    if (api.getSuppliers.mock.calls.length === 0 || api.getOrders.mock.calls.length === 0) {
      throw new Error("queries have not been issued yet");
    }
  });
}

/** The first-run promotion, in the words it ships with. */
const FIRST_RUN_COPY = /New here\?/i;

/**
 * Is the sample-order card PROMOTED above the dropzone?
 *
 * `isEmptyOrg` controls position, not existence — the card renders either way
 * (`{isEmptyOrg && sampleCard}` above, `{!isEmptyOrg && sampleCard}` below), so a
 * presence assertion would be green against the defect. Reading document order is what
 * actually distinguishes "we think you are new here" from "here it is if you want it".
 *
 * Throws when either landmark is missing, so no caller can get a free pass.
 */
function samplePromotedAboveDropzone(): boolean {
  const sample = screen.getByText(FIRST_RUN_COPY);
  const dropzone = screen.getByLabelText("Upload area");
  return (sample.compareDocumentPosition(dropzone) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.detectFormat.mockReturnValue(new Promise(() => {}));
});
afterEach(() => cleanup());

describe("first-run promotion — 'you have nothing' is a claim about the server", () => {
  it("does not greet a workspace as new when the supplier fetch FAILED", async () => {
    api.getSuppliers.mockRejectedValue(new Error("network"));
    api.getOrders.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 });
    await mount();

    // The failure really did surface — this is the sentence the promotion was
    // rendering directly beneath.
    const failureNotice = await screen.findByText(/couldn.t load your (suppliers|customers)/i);
    expect(failureNotice).toBeTruthy();
    expect(samplePromotedAboveDropzone()).toBe(false);
  });

  it("does not greet a workspace as new when the ORDERS fetch failed", async () => {
    // The half with no `isError` read at all. The suppliers half is deliberately
    // ANSWERED and empty here — that is what isolates the orders query: pre-fix, its
    // failure and its emptiness were the same `[]`, so this workspace (which may well
    // have a hundred orders behind that failed call) was promoted as a first run.
    api.getSuppliers.mockResolvedValue([]);
    api.getOrders.mockRejectedValue(new Error("network"));
    await mount();

    await waitFor(() => {
      if (api.getOrders.mock.calls.length === 0) throw new Error("orders were never requested");
    });
    await waitFor(() => expect(samplePromotedAboveDropzone()).toBe(false));
  });

  it("still greets a genuinely empty workspace", async () => {
    // ANTI-VACUITY, and the distinction that IS the defect: identical rendered values
    // (no suppliers, no orders), different query state — this one answered.
    api.getSuppliers.mockResolvedValue([]);
    api.getOrders.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 });
    await mount();

    await waitFor(() => expect(samplePromotedAboveDropzone()).toBe(true));
  });
});

describe("recent uploads — buyer left in blue, supplier right in green", () => {
  beforeEach(() => {
    api.getSuppliers.mockResolvedValue([SUPPLIER]);
    api.getOrders.mockResolvedValue({ items: [order()], totalCount: 1, page: 1, pageSize: 100 });
  });

  it("colours the two ends differently, on both breakpoint trees", async () => {
    await mount();
    await screen.findByTestId("recent-uploads-table");

    for (const tree of ["recent-uploads-cards", "recent-uploads-table"]) {
      const scope = within(screen.getByTestId(tree));
      const buyer = scope.getByTestId("recent-buyer");
      const supplier = scope.getByTestId("recent-supplier");

      // The floor: the scoping really bit, on this tree, on this row.
      expect(buyer.textContent, tree).toBe("Heinrich Industries");
      expect(supplier.textContent, tree).toBe("BoltWorks BV");

      // The defect: both ends were the same green.
      expect(buyer.style.color, tree).not.toBe(supplier.style.color);
      // And the buyer's is the blue InboxView already uses for the same value.
      expect(buyer.style.color, tree).toBe("rgb(15, 79, 168)"); // #0F4FA8
      expect(supplier.style.color, tree).toBe("rgb(30, 109, 41)"); // #1E6D29
    }
  });
});

describe("recent uploads — no column that can only print an em-dash", () => {
  it("drops Size rather than shipping '—' in every row", async () => {
    api.getSuppliers.mockResolvedValue([SUPPLIER]);
    api.getOrders.mockResolvedValue({ items: [order()], totalCount: 1, page: 1, pageSize: 100 });
    await mount();

    const table = within(await screen.findByTestId("recent-uploads-table"));
    const headers = table.getAllByRole("columnheader").map((h) => h.textContent?.trim());

    // Floor first: the header row really rendered, so the negative is not free.
    expect(headers).toContain("File");
    expect(headers).toContain("Status");
    expect(headers).not.toContain("Size");

    // And no row cell is left holding the em-dash the dropped column supplied.
    const row = table.getAllByRole("row")[1];
    expect(within(row).queryByText("—")).toBeNull();
  });
});
