"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { formatMoney } from "@/components/bridge/mapper/fieldBadgesModel";
import { Failed, Quiet } from "@/components/flows/states";
import { mapStatus, STATUS_PRESENTATION } from "@/components/bridge/InboxView";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { apiClient } from "@/lib/api-client";

// Same hand-off as the review screen's Download: navigate to the signed URL (an attachment), no popup.
const download = async (orderId: string, artifactId: string) =>
  window.location.assign((await apiClient.getDownloadUrl(orderId, artifactId)).url);

export function OrderArchiveDetail({ orderId }: { orderId: string }) {
  const q = useQuery({
    queryKey: ["archive-order", orderId],
    queryFn: () => apiClient.getOrderById(orderId),
    enabled: useTenantQueriesEnabled(),
  });
  const o = q.data;
  const dl = useMutation({ mutationFn: (artifactId: string) => download(orderId, artifactId) });

  return (
    <PageShell variant="wide">
      <PageHeader title={o?.poNumber ?? "Old orders"} actions={<Link href="/archive">All old orders</Link>} />
      {q.isError ? <Failed error={q.error} retry={() => q.refetch()} /> : !o ? <Quiet>Loading…</Quiet> : (
        <>
          <Card>
            <dl className="m-0 grid gap-2 text-[13px]">
              {[
                ["PO number", o.poNumber],
                ["Date", o.orderDate],
                ["Buyer", o.buyerName],
                ["Supplier", o.supplierName],
                ["Status", STATUS_PRESENTATION[mapStatus(o.status)].label],
                ["Total", formatMoney(o.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0), o.currency)],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3"><dt className="w-28 text-ink-muted">{k}</dt><dd className="m-0">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <h2 className="m-0 text-[14px] font-semibold">Lines</h2>
          <Card flush>
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead>
                <tr className="text-ink-faint">
                  {["Line", "Item", "Qty", "Unit price"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2">{l.lineNumber}</td>
                    <td className="px-3 py-2 font-mono">{l.supplierItemCode ?? l.buyerItemCode}</td>
                    <td className="px-3 py-2">{l.quantity}</td>
                    <td className="px-3 py-2">{l.unitPrice}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <h2 className="m-0 text-[14px] font-semibold">Output files</h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {o.artifacts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 text-[13px]">
                <span className="font-mono">{a.format}</span>
                <Button size="sm" variant="secondary" disabled={dl.isPending} onClick={() => dl.mutate(a.id)}>Download</Button>
              </li>
            ))}
          </ul>
          {dl.isError && <StatusNotice tone="error">We couldn't start the download. Try again in a moment.</StatusNotice>}
        </>
      )}
    </PageShell>
  );
}
