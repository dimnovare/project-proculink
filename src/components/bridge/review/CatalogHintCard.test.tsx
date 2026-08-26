import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// CatalogHintCard — the review-screen hint for the catalog cliff. The show/hide
// predicate is unit-tested in catalogHint.test.ts; these tests cover the wiring
// the predicate can't see: which probe it fires, and that it never speaks about a
// supplier that does not exist yet.

vi.mock("@/lib/api-client", () => ({
  getSupplierCatalog: vi.fn().mockResolvedValue({ total: 0, items: [] }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { getSupplierCatalog } from "@/lib/api-client";
import { CATALOG_CODES_TAKE, UNASSIGNED_SUPPLIER_ID } from "@/lib/catalogCodes";
import { CatalogHintCard } from "./CatalogHintCard";

const catalogMock = vi.mocked(getSupplierCatalog);

afterEach(() => {
  cleanup();
  catalogMock.mockReset().mockResolvedValue({ total: 0, items: [] });
});

function renderCard(over: Partial<Parameters<typeof CatalogHintCard>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CatalogHintCard
        supplierId="sup-1"
        supplierName="Demo Supplier"
        hasUnresolvedLines
        anyLineResolved={false}
        {...over}
      />
    </QueryClientProvider>,
  );
}

describe("CatalogHintCard", () => {
  it("teaches the catalog cliff once the probe PROVES the catalog is empty", async () => {
    renderCard();
    expect(await screen.findByTestId("catalog-hint-card")).toBeTruthy();
    expect(screen.getByText("No item codes for Demo Supplier yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Upload catalog/ }).getAttribute("href")).toBe(
      "/library/suppliers/sup-1?tab=catalog",
    );
  });

  it("uses the SHARED code-lookup probe, so opening the picker costs no extra request", async () => {
    renderCard();
    await waitFor(() =>
      expect(catalogMock).toHaveBeenCalledWith("sup-1", undefined, CATALOG_CODES_TAKE),
    );
  });

  it("renders nothing on a FAILED probe — a hint built on an unknown is a guess", async () => {
    catalogMock.mockRejectedValue(new Error("catalog: 500"));
    renderCard();
    await waitFor(() => expect(catalogMock).toHaveBeenCalled());
    expect(screen.queryByTestId("catalog-hint-card")).toBeNull();
  });

  it("self-resolves once the catalog has rows", async () => {
    catalogMock.mockResolvedValue({ total: 120_000, items: [{ id: "p1", code: "TY-1" }] });
    renderCard();
    await waitFor(() => expect(catalogMock).toHaveBeenCalled());
    expect(screen.queryByTestId("catalog-hint-card")).toBeNull();
  });

  it("says nothing about an UNROUTED order — there is no supplier to have a catalog", async () => {
    renderCard({ supplierId: UNASSIGNED_SUPPLIER_ID, supplierName: "" });
    await new Promise((r) => setTimeout(r, 50));
    expect(catalogMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("catalog-hint-card")).toBeNull();
  });
});
