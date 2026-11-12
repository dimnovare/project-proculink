import { apiClient } from "@/lib/api-client";
import { pagePopulation } from "@/components/bridge/orderCountContract";
import { csvCell } from "@/lib/csvCell";
import { mapStatus, STATUS_PRESENTATION } from "@/components/bridge/InboxView";
import type { OrderSummary } from "@/types/procurement";

const HEADER = "PO number,Date,Buyer,Supplier,Status,Lines,Total,Currency";

export function ordersToCsv(orders: OrderSummary[]): string {
  const rows = orders.map((o) =>
    [
      o.poNumber,
      o.orderDate.slice(0, 10),
      o.buyerName,
      o.supplierName,
      STATUS_PRESENTATION[mapStatus(o.status)].label,
      o.lineCount,
      o.totalValue,
      o.currency,
    ].map(csvCell).join(","),
  );
  return [HEADER, ...rows].join("\r\n");
}

/** Every order, a page at a time. Called from the Download CSV click only. */
export async function fetchAllOrders(pageSize = 100): Promise<OrderSummary[]> {
  const all: OrderSummary[] = [];
  for (let page = 1; ; page++) {
    const res = await apiClient.getOrders({ page, pageSize });
    const { items } = res;
    all.push(...items);
    if (!items.length || all.length >= pagePopulation(res).rows) return all;
  }
}
