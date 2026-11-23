import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OrderSummary } from "@/types/procurement";

const items = ["PO-1", "PO-2"].map((poNumber, i) => ({
  id: `o${i}`, poNumber, supplierName: "S", buyerName: "B", orderDate: "2026-01-02", status: "delivered",
  lineCount: 1, unresolvedCount: 0, totalValue: 5, currency: "EUR", createdAt: "",
})) as OrderSummary[];
const detail = { id: "o0", poNumber: "PO-1", orderDate: "2026-01-02", buyerName: "B", supplierName: "S", status: "ready", currency: "EUR", artifacts: [],
  lines: [{ id: "l1", lineNumber: 1, supplierItemCode: "SKU-1", buyerItemCode: null, quantity: 2, unitPrice: 3 }] };
vi.mock("@/lib/api-client", async (orig) => ({ ...(await orig<object>()), apiClient: {
  getOrders: () => Promise.resolve({ items, totalCount: 2 }), getOrderById: () => Promise.resolve(detail),
} }));
vi.mock("@/lib/orderArchiveCsv", () => ({ fetchAllOrders: () => Promise.reject(new TypeError("Failed to fetch")), ordersToCsv: () => "" }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

import { OrderArchive } from "./OrderArchive";
import { OrderArchiveDetail } from "./OrderArchiveDetail";

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("OrderArchive", () => {
  it("lists old orders read-only, as table rows and phone cards that open the order, with Download CSV", async () => {
    wrap(<OrderArchive />);
    const table = await screen.findByTestId("archive-table");
    expect(within(table).getByRole("link", { name: "PO-1" })).toHaveAttribute("href", "/archive/o0");
    expect(within(table).getAllByText("Delivered")).toHaveLength(2);
    const cards = within(screen.getByTestId("archive-cards")).getAllByRole("link");
    expect(cards.map((c) => c.getAttribute("href"))).toEqual(["/archive/o0", "/archive/o1"]);
    // One page: no pager.
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("button", { name: /send|resolve|retry|edit/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't make the CSV file. Nothing is lost. Check your connection and try again.Try again");
  });

  it("an old order says where it stopped, does not repeat its number, and says when no file was made", async () => {
    wrap(<OrderArchiveDetail orderId="o0" />);
    expect(await screen.findByText("No files were made for this order.")).toBeTruthy();
    expect(screen.getByText("Not sent")).toBeTruthy();
    expect(screen.queryByText("PO number")).toBeNull();
  });
});
