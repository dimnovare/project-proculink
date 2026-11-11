import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrderSummary } from "@/types/procurement";

const items = ["PO-1", "PO-2"].map((poNumber, i) => ({
  id: `o${i}`, poNumber, supplierName: "S", buyerName: "B", orderDate: "2026-01-02", status: "delivered",
  lineCount: 1, unresolvedCount: 0, totalValue: 5, currency: "EUR", createdAt: "",
})) as OrderSummary[];
vi.mock("@/lib/api-client", async (orig) => ({ ...(await orig<object>()), apiClient: { getOrders: () => Promise.resolve({ items, totalCount: 2 }) } }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

import { OrderArchive } from "./OrderArchive";

describe("OrderArchive", () => {
  it("lists old orders read-only, with Download CSV", async () => {
    render(<QueryClientProvider client={new QueryClient()}><OrderArchive /></QueryClientProvider>);
    expect(await screen.findByText("PO-1")).toBeTruthy();
    expect(screen.getByText("PO-2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send|resolve|retry|edit/i })).toBeNull();
  });
});
