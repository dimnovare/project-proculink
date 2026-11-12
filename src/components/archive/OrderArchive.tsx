"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { Failed, Quiet } from "@/components/flows/states";
import { mapStatus, STATUS_PRESENTATION } from "@/lib/orderArchiveStatus";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { apiClient } from "@/lib/api-client";
import { saveBlob } from "@/lib/saveBlob";
import { formatMoney } from "@/components/bridge/mapper/fieldBadgesModel";
import { pagePopulation } from "@/components/bridge/orderCountContract";
import { fetchAllOrders, ordersToCsv } from "@/lib/orderArchiveCsv";

const PAGE_SIZE = 25;

// The BOM lets Excel read non-ASCII buyer and supplier names as UTF-8.
async function downloadCsv() {
  saveBlob(new Blob(["\uFEFF" + ordersToCsv(await fetchAllOrders())], { type: "text/csv;charset=utf-8" }), "old-orders.csv");
}

export function OrderArchive() {
  const [page, setPage] = useState(1);
  const enabled = useTenantQueriesEnabled();
  const q = useQuery({
    queryKey: ["archive-orders", page],
    queryFn: () => apiClient.getOrders({ page, pageSize: PAGE_SIZE }),
    enabled,
  });
  const exp = useMutation({ mutationFn: downloadCsv });
  const total = pagePopulation(q.data).rows;

  let body;
  if (q.isError) body = <Failed error={q.error} retry={() => q.refetch()} />;
  else if (!q.data) body = <Quiet>Loading…</Quiet>;
  else if (!q.data.items.length) body = <Quiet>No old orders.</Quiet>;
  else {
    body = (
      <>
        <Card flush>
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="text-ink-faint">
                {["PO number", "Date", "Buyer", "Supplier", "Status", "Lines", "Total"].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono"><Link href={`/archive/${o.id}`}>{o.poNumber}</Link></td>
                  <td className="px-3 py-2">{o.orderDate.slice(0, 10)}</td>
                  <td className="px-3 py-2">{o.buyerName}</td>
                  <td className="px-3 py-2">{o.supplierName}</td>
                  <td className="px-3 py-2">{STATUS_PRESENTATION[mapStatus(o.status)].label}</td>
                  <td className="px-3 py-2">{o.lineCount}</td>
                  <td className="px-3 py-2">{formatMoney(o.totalValue, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="secondary" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </>
    );
  }

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Old orders"
        sub="Orders received before your workspace moved to flows. They are read-only."
        actions={<Button size="sm" variant="secondary" disabled={exp.isPending} onClick={() => exp.mutate()}>Download CSV</Button>}
      />
      {exp.isError && <Failed error={exp.error} retry={() => exp.mutate()} />}
      {body}
    </PageShell>
  );
}
