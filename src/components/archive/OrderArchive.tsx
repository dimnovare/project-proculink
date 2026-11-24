"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { Failed, Quiet, Loading } from "@/components/flows/states";
import { mapStatus } from "@/lib/orderArchiveStatus";
import type { CrossingStatus } from "@/components/bridge/StatusJourney";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { apiClient } from "@/lib/api-client";
import { saveBlob } from "@/lib/saveBlob";
import { formatMoney } from "@/components/bridge/mapper/fieldBadgesModel";
import { pagePopulation } from "@/components/bridge/orderCountContract";
import { fetchAllOrders, ordersToCsv } from "@/lib/orderArchiveCsv";

const PAGE_SIZE = 25;

/** An old order is frozen: its status says where it stopped, in the past tense, never what to do next (A-21). */
const STOPPED: Record<CrossingStatus, string> = {
  new: "Not read", extracting: "Not read", unrouted: "No supplier set", review: "Not reviewed",
  ready: "Not sent", transforming: "Not sent", delivering: "Not sent", sending: "Not sent", held: "Not sent",
  sent: "Delivered", unconfirmed: "Delivery unknown", failed: "Failed", unknown: "Status unknown",
};
export const archiveStatus = (s: string) => STOPPED[mapStatus(s)];

// The BOM lets Excel read non-ASCII buyer and supplier names as UTF-8.
async function downloadCsv() {
  saveBlob(new Blob(["﻿" + ordersToCsv(await fetchAllOrders())], { type: "text/csv;charset=utf-8" }), "old-orders.csv");
}

const NUM = "px-3 py-2 text-right tabular-nums";

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
  else if (!q.data) body = <Loading>Loading…</Loading>;
  else if (!q.data.items.length) body = <Quiet>No old orders.</Quiet>;
  else {
    const items = q.data.items;
    body = (
      <>
        <Card flush className="hidden lg:block">
          <table data-testid="archive-table" className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="text-ink-faint">
                {["PO number", "Date", "Buyer", "Supplier", "Status", "Lines", "Total"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-semibold ${i >= 5 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                // The link's ::after covers the row, so the whole row opens the order.
                <tr key={o.id} className="relative border-t border-border hover:bg-surface-2">
                  <td className="px-3 py-2 font-mono">
                    <Link href={`/archive/${o.id}`} className="text-brand-blue underline-offset-2 after:absolute after:inset-0 after:content-[''] hover:underline">{o.poNumber}</Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{o.orderDate.slice(0, 10)}</td>
                  <td className="px-3 py-2">{o.buyerName}</td>
                  <td className="px-3 py-2">{o.supplierName}</td>
                  <td className="px-3 py-2 text-ink-muted">{archiveStatus(o.status)}</td>
                  <td className={NUM}>{o.lineCount}</td>
                  <td className={NUM}>{formatMoney(o.totalValue, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <ul data-testid="archive-cards" className="m-0 grid list-none gap-2 p-0 lg:hidden">
          {items.map((o) => (
            <li key={o.id}>
              <Link href={`/archive/${o.id}`} className="flex min-h-11 items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 text-ink">
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-[15px] font-semibold text-brand-blue">{o.poNumber}</span>
                    <span className="shrink-0 text-[13px] tabular-nums">{formatMoney(o.totalValue, o.currency)}</span>
                  </span>
                  <span className="truncate text-[13px] text-ink-muted">{o.supplierName ? `${o.buyerName} → ${o.supplierName}` : o.buyerName}</span>
                  <span className="text-[13px] text-ink-muted">{o.orderDate.slice(0, 10)} · {archiveStatus(o.status)}</span>
                </span>
                <ChevronRight size={16} aria-hidden className="shrink-0 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
        {total > PAGE_SIZE && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </>
    );
  }

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Old orders"
        back={{ href: "/documents", label: "Documents" }}
        sub="Orders received before your workspace moved to flows. They are read-only."
        actions={<Button size="sm" variant="secondary" disabled={exp.isPending} onClick={() => exp.mutate()}>Download CSV</Button>}
      />
      {exp.isError && <Failed error={exp.error} retry={() => exp.mutate()} lead="We couldn't make the CSV file." />}
      {body}
    </PageShell>
  );
}
