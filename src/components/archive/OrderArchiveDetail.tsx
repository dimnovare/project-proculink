"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { formatMoney } from "@/components/bridge/mapper/fieldBadgesModel";
import { Failed, Loading, Quiet } from "@/components/flows/states";
import { downloadFailureMessage } from "@/lib/orderArchiveStatus";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { apiClient } from "@/lib/api-client";
import { archiveStatus } from "./OrderArchive";

// Same hand-off as the review screen's Download: navigate to the signed URL (an attachment), no popup.
const download = async (orderId: string, artifactId: string) =>
  window.location.assign((await apiClient.getDownloadUrl(orderId, artifactId)).url);

const H2 = "m-0 text-[14px] font-semibold";
const NUM = "px-3 py-2 text-right tabular-nums";

export function OrderArchiveDetail({ orderId }: { orderId: string }) {
  const q = useQuery({
    queryKey: ["archive-order", orderId],
    queryFn: () => apiClient.getOrderById(orderId),
    enabled: useTenantQueriesEnabled(),
  });
  const o = q.data;
  const dl = useMutation({ mutationFn: (artifactId: string) => download(orderId, artifactId) });

  return (
    // Narrow: one order and a four-column lines table read badly stretched across an HD screen.
    <PageShell variant="narrow">
      <PageHeader title={o?.poNumber ?? "Old orders"} back={{ href: "/archive", label: "Old orders" }} />
      {q.isError ? <Failed error={q.error} retry={() => q.refetch()} /> : !o ? <Loading>Loading…</Loading> : (
        <div className="grid gap-6">
          <Card>
            {/* The PO number is the page title, so it is not repeated here (A-20). */}
            <dl className="m-0 grid gap-2 text-[13px]">
              {[
                ["Date", o.orderDate],
                ["Buyer", o.buyerName],
                ["Supplier", o.supplierName],
                ["Status", archiveStatus(o.status)],
                ["Total", formatMoney(o.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0), o.currency)],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3"><dt className="w-28 shrink-0 text-ink-muted">{k}</dt><dd className="m-0 min-w-0 tabular-nums">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <section className="grid gap-2">
            <h2 className={H2}>Lines</h2>
            <Card flush style={{ overflow: "auto" }}>
              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead>
                  <tr className="text-ink-faint">
                    {["Line", "Item", "Qty", "Unit price"].map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${i >= 2 ? "text-right" : ""}`}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {o.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-3 py-2 tabular-nums">{l.lineNumber}</td>
                      <td className="px-3 py-2 font-mono">{l.supplierItemCode ?? l.buyerItemCode}</td>
                      <td className={NUM}>{l.quantity}</td>
                      <td className={NUM}>{formatMoney(l.unitPrice, o.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
          <section className="grid gap-2">
            <h2 className={H2}>Output files</h2>
            {o.artifacts.length === 0 ? <Quiet>No files were made for this order.</Quiet> : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {o.artifacts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 text-[13px]">
                    <span className="font-mono">{a.format}</span>
                    <Button size="sm" variant="secondary" disabled={dl.isPending} onClick={() => dl.mutate(a.id)}>Download</Button>
                  </li>
                ))}
              </ul>
            )}
            {dl.isError && <StatusNotice tone="error">{downloadFailureMessage(dl.error)}</StatusNotice>}
          </section>
        </div>
      )}
    </PageShell>
  );
}
