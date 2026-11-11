import { describe, it, expect, vi } from "vitest";
import type { OrderSummary } from "@/types/procurement";

const getOrders = vi.fn();
vi.mock("@/lib/api-client", async (orig) => ({ ...(await orig<object>()), apiClient: { getOrders: (a: unknown) => getOrders(a) } }));

import { fetchAllOrders, ordersToCsv } from "./orderArchiveCsv";

const order = (n: number, over: Partial<OrderSummary> = {}) =>
  ({ id: `o${n}`, poNumber: `PO-${n}`, supplierName: "S", buyerName: "B", orderDate: "2026-01-02T00:00:00Z",
     status: "delivered", lineCount: 2, unresolvedCount: 0, totalValue: 12.5, currency: "EUR", createdAt: "", ...over }) as OrderSummary;

describe("old-orders CSV", () => {
  it("writes the header exactly and neutralises a formula in a cell", () => {
    const lines = ordersToCsv([order(1, { buyerName: '=HYPERLINK("x")' })]).split("\r\n");
    expect(lines[0]).toBe("PO number,Date,Buyer,Supplier,Status,Lines,Total,Currency");
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('"2026-01-02"');
  });

  it("fetches every page", async () => {
    const mk = (from: number, n: number) => Array.from({ length: n }, (_, i) => order(from + i));
    getOrders.mockResolvedValueOnce({ items: mk(0, 100), totalCount: 130 }).mockResolvedValueOnce({ items: mk(100, 30), totalCount: 130 });
    expect(await fetchAllOrders()).toHaveLength(130);
  });
});
