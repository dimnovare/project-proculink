// FE-3(b) — the upload-preview manual entry must offer the catalog typeahead the
// help pages promise ("manual entry gets a typeahead of codes that actually
// exist" — help/item-codes, help/managing-suppliers). It was a plain text input,
// so an operator had to know the supplier's code by heart at the exact moment
// the product knows it and they don't.
//
// The lookup is SERVER-side (GET /api/suppliers/{id}/catalog?q=) — same hook as
// the review-screen picker — so a code at row 90,000 of a distributor catalog is
// reachable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MappingPreview } from "@/lib/api-client";

const getMappingPreview = vi.fn();
const getOrderById = vi.fn();
const commitMappings = vi.fn();
const getSupplierCatalog = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getMappingPreview: (...a: unknown[]) => getMappingPreview(...a),
    getOrderById: (...a: unknown[]) => getOrderById(...a),
    commitMappings: (...a: unknown[]) => commitMappings(...a),
    acceptAiSuggestions: vi.fn(),
  },
  getSupplierCatalog: (...a: unknown[]) => getSupplierCatalog(...a),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({ direction: "outbound", labels: { counterpartyNoun: "Supplier" } }),
}));

import { CATALOG_CODES_TAKE } from "@/lib/catalogCodes";
import { MagicMappingPreview } from "./MagicMappingPreview";

/** One unresolved line with NO AI suggestion — the manual-entry path. */
const PREVIEW: MappingPreview = {
  orderId: "ord-1",
  orderStatus: "pending_review",
  sourceFormat: "csv",
  lines: [
    {
      lineNumber: 1,
      sourceFields: {},
      canonicalField: "supplierItemCode",
      buyerItemCode: "MICH-CROSSCLIM",
      resolvedSupplierCode: null,
      aiSuggestedSupplierCode: null,
      confidence: null,
      provenance: null,
      reason: null,
      status: "unresolved",
    },
  ],
} as unknown as MappingPreview;

function renderPreview() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MagicMappingPreview orderId="ord-1" />
    </QueryClientProvider>,
  );
}

async function openManualEntry() {
  fireEvent.click(await screen.findByRole("button", { name: /Enter supplier code/i }));
  return screen.getByPlaceholderText(/Supplier item code/i);
}

beforeEach(() => {
  getMappingPreview.mockReset().mockResolvedValue(PREVIEW);
  getOrderById.mockReset().mockResolvedValue({
    id: "ord-1",
    supplierId: "sup-1",
    supplierName: "Demo Supplier",
    lines: [],
  });
  commitMappings.mockReset().mockResolvedValue({ order: { id: "ord-1" } });
  getSupplierCatalog.mockReset().mockResolvedValue({ total: 0, items: [] });
});

afterEach(cleanup);

describe("MagicMappingPreview — manual entry has the promised catalog typeahead", () => {
  it("searches the supplier's catalog SERVER-side as the operator types", async () => {
    getSupplierCatalog.mockImplementation(async (_id: string, q?: string) =>
      q === "cross"
        ? { total: 120_000, items: [{ id: "p9", code: "TY-90112", name: "CrossClimate 2" }] }
        : { total: 120_000, items: [] },
    );
    renderPreview();
    const input = await openManualEntry();
    fireEvent.change(input, { target: { value: "cross" } });

    await waitFor(
      () => expect(getSupplierCatalog).toHaveBeenCalledWith("sup-1", "cross", CATALOG_CODES_TAKE),
      { timeout: 3000 },
    );
    expect(await screen.findByRole("option", { name: /TY-90112/ })).toBeTruthy();
    // The input is a real combobox pointing at the popup it controls.
    const combo = screen.getByRole("combobox");
    expect(combo.getAttribute("aria-controls")).toBe("catalog-typeahead-1");
    expect(document.getElementById("catalog-typeahead-1")).toBeTruthy();
  });

  it("picking a suggestion sets that line's code — the operator never retypes it", async () => {
    getSupplierCatalog.mockResolvedValue({
      total: 120_000,
      items: [{ id: "p9", code: "TY-90112", name: "CrossClimate 2" }],
    });
    renderPreview();
    const input = await openManualEntry();
    fireEvent.change(input, { target: { value: "cross" } });

    const option = await screen.findByRole("option", { name: /TY-90112/ }, { timeout: 3000 });
    fireEvent.click(option);

    // The row now carries the picked code, and Commit sends exactly that.
    await waitFor(() => expect(screen.getByText("TY-90112")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Confirm mapping/i }));
    await waitFor(() =>
      expect(commitMappings).toHaveBeenCalledWith("ord-1", [
        { lineNumber: 1, supplierItemCode: "TY-90112" },
      ]),
    );
  });

  it("an unrouted order has no catalog to offer — the plain input still works", async () => {
    getOrderById.mockResolvedValue({
      id: "ord-1",
      supplierId: "00000000-0000-0000-0000-000000000000",
      supplierName: null,
      lines: [],
    });
    renderPreview();
    const input = await openManualEntry();
    fireEvent.change(input, { target: { value: "cross" } });

    await new Promise((r) => setTimeout(r, 600));
    expect(getSupplierCatalog).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("cross");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says so when the supplier has no catalog, instead of offering nothing silently", async () => {
    getSupplierCatalog.mockResolvedValue({ total: 0, items: [] });
    renderPreview();
    const input = await openManualEntry();
    fireEvent.change(input, { target: { value: "cross" } });

    expect(
      await screen.findByText(/No catalog for this supplier yet/i, undefined, { timeout: 3000 }),
    ).toBeTruthy();
  });
});
