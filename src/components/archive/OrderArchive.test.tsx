import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrderSummary } from "@/types/procurement";

const items = ["PO-1", "PO-2"].map((poNumber, i) => ({
  id: `o${i}`, poNumber, supplierName: "S", buyerName: "B", orderDate: "2026-01-02", status: "delivered",
  lineCount: 1, unresolvedCount: 0, totalValue: 5, currency: "EUR", createdAt: "",
})) as OrderSummary[];
vi.mock("@/lib/api-client", async (orig) => ({ ...(await orig<object>()), apiClient: { getOrders: () => Promise.resolve({ items, totalCount: 2 }) } }));
vi.mock("@/lib/orderArchiveCsv", () => ({ fetchAllOrders: () => Promise.reject(new TypeError("Failed to fetch")), ordersToCsv: () => "" }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

import { OrderArchive } from "./OrderArchive";

describe("OrderArchive", () => {
  it("lists old orders read-only, with Download CSV", async () => {
    render(<QueryClientProvider client={new QueryClient()}><OrderArchive /></QueryClientProvider>);
    expect(await screen.findByText("PO-1")).toBeTruthy();
    expect(screen.getByText("PO-2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send|resolve|retry|edit/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't make the CSV file. Nothing is lost. Check your connection and try again.Try again");
  });
});
