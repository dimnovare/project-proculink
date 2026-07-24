// B11 — "Accept all AI suggestions" must not re-accept a line the user locally rejected. The
// badge count drops when a suggested line is rejected, and the bulk action skips it (routing to
// explicit commitMappings, never the broad accept-all that has no per-line exclusion).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MappingPreview } from "@/lib/api-client";

const getMappingPreview = vi.fn();
const acceptAiSuggestions = vi.fn();
const commitMappings = vi.fn();

const getOrderById = vi.fn();
const getSupplierCatalog = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getMappingPreview: (...a: unknown[]) => getMappingPreview(...a),
    acceptAiSuggestions: (...a: unknown[]) => acceptAiSuggestions(...a),
    commitMappings: (...a: unknown[]) => commitMappings(...a),
    getOrderById: (...a: unknown[]) => getOrderById(...a),
  },
  // The manual-entry typeahead's lookup — unused here (every line has a
  // suggestion), but the module must expose it or the import is undefined.
  getSupplierCatalog: (...a: unknown[]) => getSupplierCatalog(...a),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({ direction: "outbound", labels: { counterpartyNoun: "Supplier" } }),
}));

import { MagicMappingPreview } from "./MagicMappingPreview";

const PREVIEW: MappingPreview = {
  orderId: "ord-1",
  orderStatus: "pending_review",
  sourceFormat: "csv",
  lines: [
    { lineNumber: 1, sourceFields: {}, canonicalField: "supplierItemCode", buyerItemCode: "B-1", resolvedSupplierCode: null, aiSuggestedSupplierCode: "S-1", confidence: 0.9, provenance: null, reason: null, status: "suggested" },
    { lineNumber: 2, sourceFields: {}, canonicalField: "supplierItemCode", buyerItemCode: "B-2", resolvedSupplierCode: null, aiSuggestedSupplierCode: "S-2", confidence: 0.9, provenance: null, reason: null, status: "suggested" },
  ],
} as unknown as MappingPreview;

function renderPreview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MagicMappingPreview orderId="ord-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMappingPreview.mockReset().mockResolvedValue(PREVIEW);
  acceptAiSuggestions.mockReset().mockResolvedValue({ accepted: 2 });
  commitMappings.mockReset().mockResolvedValue({ order: { id: "ord-1" } });
  getOrderById.mockReset().mockResolvedValue({ id: "ord-1", supplierId: "sup-1", lines: [] });
  getSupplierCatalog.mockReset().mockResolvedValue({ total: 0, items: [] });
});

afterEach(cleanup);

describe("MagicMappingPreview — bulk accept skips locally-rejected lines (B11)", () => {
  it("drops the badge count and skips the rejected line in the action", async () => {
    renderPreview();

    // Badge starts at 2 (both lines suggested + unresolved).
    const bulkBtn = await screen.findByRole("button", { name: /Accept all AI suggestions/i });
    expect(within(bulkBtn).getByText("2")).toBeInTheDocument();

    // Reject line 2 (the second row's Reject button).
    const rejectButtons = screen.getAllByRole("button", { name: /^Reject$/i });
    expect(rejectButtons).toHaveLength(2);
    fireEvent.click(rejectButtons[1]);

    // Badge now reads 1 — the rejected line is excluded.
    await waitFor(() => expect(within(bulkBtn).getByText("1")).toBeInTheDocument());

    // Click bulk accept → routes to explicit commitMappings (line 1 only); the broad
    // accept-all endpoint is NOT called, so the rejected line is never re-accepted.
    fireEvent.click(bulkBtn);

    await waitFor(() => expect(commitMappings).toHaveBeenCalled());
    expect(acceptAiSuggestions).not.toHaveBeenCalled();

    // The committed resolutions contain ONLY line 1 (the surviving suggestion).
    const lastCall = commitMappings.mock.calls[commitMappings.mock.calls.length - 1];
    const resolutions = lastCall[1] as { lineNumber: number; supplierItemCode: string }[];
    expect(resolutions).toEqual([{ lineNumber: 1, supplierItemCode: "S-1" }]);
  });

  it("with no rejections, still uses the cheaper server-side accept-all endpoint", async () => {
    renderPreview();
    const bulkBtn = await screen.findByRole("button", { name: /Accept all AI suggestions/i });
    fireEvent.click(bulkBtn);

    await waitFor(() => expect(acceptAiSuggestions).toHaveBeenCalledWith("ord-1", 0));
    // No local decisions and no rejections → no explicit commit pre-step.
    expect(commitMappings).not.toHaveBeenCalled();
  });
});
