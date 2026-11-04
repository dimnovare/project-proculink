"use client";

// InvoiceScreen — the Simple document screen for one invoice.
//
// Left to right: the original, what we read (editable), the checks, and where it goes.
// Nothing here is new machinery: the order query and its polling (useOrderReview), the
// original pane (useSourceDocument + SourceDocumentBody), the order-level problem read the
// review screen uses (OrderExceptionsNotice's query + openOrderLevelExceptions), and the
// review screen's own send flow (useSendFlow: transform → deliver, the same explicit states).
//
// The original is never behind a step: it is open by default at every width, and only the
// person's own "Hide original" closes it. Below lg the same panes stack in the same order.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, getOrderExceptions } from "@/lib/api-client";
import { getDeliveryConfig } from "@/lib/api/delivery";
import { deliveryConfigQueryKey } from "@/lib/deliveryConfigCache";
import { hasAssignedSupplier } from "@/lib/catalogCodes";
import { opAllowsStatus, RESOLVE_HELD_FROM } from "@/lib/orderStatusManifest";
import { sourceUnavailableMessage } from "@/lib/sourceDocument";
import { partyLabels } from "@/hooks/useOrderDirection";
import type { ResolvePayload } from "@/types/procurement";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice, type NoticeTone } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { STAGES, StatusJourney } from "@/components/bridge/StatusJourney";
import { BridgePageLoader } from "@/components/bridge/BridgeLoader";
import { journeyStage, mapStatus } from "@/components/bridge/InboxView";
import { finalDeliveryMessage, useOrderReview } from "@/components/bridge/review/hooks/useOrderReview";
import { useSendFlow } from "@/components/bridge/review/hooks/useSendFlow";
import { deliverableArtifact, orderGrandTotalLabel } from "@/components/bridge/review/orderDisplay";
import { openOrderLevelExceptions } from "@/components/bridge/workshop/OrderExceptionsNotice";
import { formatAmount } from "@/components/bridge/workshop/workshopLinesModel";
import { useLgViewport, useSourceDocument } from "@/components/bridge/document/useSourceDocument";
import { SourceDocumentBody } from "@/components/bridge/document/SourceDocumentBody";

/** The read fields, in reading order. Every key is both an `Order` field and a /resolve field. */
const FIELDS = [
  { key: "poNumber", label: "Invoice number" },
  { key: "orderDate", label: "Invoice date", type: "date" },
  { key: "dueDate", label: "Due date", type: "date" },
  { key: "supplierName", label: "Seller" },
  { key: "sellerTaxId", label: "Seller VAT ID" },
  { key: "paymentIban", label: "IBAN" },
  { key: "paymentReference", label: "Payment reference" },
  { key: "subTotal", label: "Net", type: "number" },
  { key: "taxTotal", label: "VAT", type: "number" },
  { key: "grandTotal", label: "Total", type: "number" },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];
type Draft = Partial<Record<FieldKey, string>>;

/** Statuses finalDeliveryMessage names explicitly — the outcome shown when no send just ran. */
const DELIVERY_OUTCOMES = new Set(["delivered", "delivery_failed", "rejected_by_supplier", "delivery_dead_letter", "delivery_held", "delivery_unconfirmed"]);
const FLOW_TONE: Record<"info" | "success" | "error", NoticeTone> = { info: "working", success: "success", error: "error" };

/** Only the fields the person edited go to /resolve; the backend reads absent as "not edited". */
function editsToPayload(draft: Draft): ResolvePayload {
  const header: Record<string, string | number> = {};
  for (const f of FIELDS) {
    const v = draft[f.key]?.trim();
    if (v) header[f.key] = "type" in f && f.type === "number" ? Number(v) : v;
  }
  return { saveMappings: false, lineResolutions: [], ...header };
}

export function InvoiceScreen({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const { order, isLoading, refetchOrder, queryEnabled } = useOrderReview(orderId);
  const [showOriginal, setShowOriginal] = useState(true);
  const [draft, setDraft] = useState<Draft>({});
  const isLg = useLgViewport();
  const source = useSourceDocument(orderId);

  // Same key as OrderExceptionsNotice, so both screens share one cache entry.
  const checks = useQuery({
    queryKey: ["order-exceptions", orderId],
    queryFn: () => getOrderExceptions(orderId),
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: 1,
  });

  // The invoice destination is an ordinary supplier row: its name from the supplier list, its
  // format from its delivery config — the same two reads the supplier pages use.
  const destinationId = order && order.status !== "unrouted" && hasAssignedSupplier(order.supplierId) ? order.supplierId : null;
  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    enabled: queryEnabled && destinationId !== null,
    staleTime: 60_000,
  });
  const delivery = useQuery({
    queryKey: deliveryConfigQueryKey(destinationId ?? "unassigned"),
    queryFn: () => getDeliveryConfig(destinationId as string),
    enabled: queryEnabled && destinationId !== null,
    staleTime: 60_000,
    retry: 1,
  });
  const destination = suppliers.data?.find((s) => s.id === destinationId)?.name ?? null;
  const format = delivery.data?.outputFormat?.toUpperCase() ?? null;

  const labels = useMemo(
    () => ({ ...partyLabels("outbound"), deliveredLabel: destination ? `Sent to ${destination}` : "Sent" }),
    [destination],
  );
  const { flowNotice, flowSeverity, setFlow, sendState, crossed, confirmSend } = useSendFlow({ orderId, order, labels, refetchOrder });

  // /resolve re-runs the invoice checks, so the order AND its problems are re-read before the
  // draft is dropped — the inputs never flash the old values.
  const save = useMutation({
    mutationFn: () => apiClient.resolvePurchaseOrder(orderId, editsToPayload(draft)),
    onSuccess: async () => {
      await Promise.all([refetchOrder(), qc.invalidateQueries({ queryKey: ["order-exceptions", orderId] })]);
      setDraft({});
    },
  });

  async function download(artifactId: string) {
    try {
      const { url } = await apiClient.getDownloadUrl(orderId, artifactId);
      window.location.assign(url);
    } catch {
      setFlow("We couldn't start the download. Try again in a moment.", "error");
    }
  }

  if (isLoading) return <BridgePageLoader label="Opening the invoice…" />;
  if (!order) {
    return (
      <PageShell>
        <StatusNotice tone="error">We couldn&rsquo;t load this document. Go back to Documents and open it again.</StatusNotice>
      </PageShell>
    );
  }
  if (order.documentType !== "invoice") {
    return (
      <PageShell>
        <StatusNotice tone="working" action={<Link href={`/inbox/${orderId}`} className="font-semibold underline">Open in Advanced</Link>}>
          This document opens in the order review.
        </StatusNotice>
      </PageShell>
    );
  }

  const problems = openOrderLevelExceptions(checks.data);
  const stage = journeyStage(mapStatus(order.status), order.status);
  const sent = crossed || order.status === "delivered";
  const canSend =
    !sent && sendState === "idle" && (opAllowsStatus("transformOrder", order.status) || opAllowsStatus("redeliverOrder", order.status));
  const canSave = Object.keys(draft).length > 0 && !RESOLVE_HELD_FROM.includes(order.status);
  const artifact = deliverableArtifact(order.artifacts);
  const outcome = !flowNotice && DELIVERY_OUTCOMES.has(order.status) ? finalDeliveryMessage(order.status, order.errorMessage, labels) : null;
  const outcomeTone: NoticeTone = order.status === "delivered" ? "success" : order.status === "delivery_held" ? "working" : "error";

  return (
    <PageShell variant="wide">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Link href="/inbox" className="text-[12px] font-medium text-ink-muted hover:text-ink">
            ← Documents
          </Link>
          <h1 className="mt-1 font-display text-[26px] font-semibold leading-tight tracking-tight text-ink">
            Invoice <span className="font-mono text-[21px]">{order.poNumber}</span>
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{[order.supplierName, orderGrandTotalLabel(order)].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {stage !== null && (
            <span className="flex items-center gap-2 text-[12px] font-semibold text-ink-muted">
              <StatusJourney stage={stage} compact />
              {STAGES[typeof stage === "number" ? stage : stage.failed]}
            </span>
          )}
          <Button size="sm" onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? "Hide original" : "Show original"}
          </Button>
        </div>
      </header>

      <div
        className={`grid items-start gap-4 ${
          showOriginal ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]"
        }`}
      >
        {showOriginal && (
          <div className="min-w-0 lg:sticky lg:top-0 lg:h-[calc(100vh-150px)]">
            <Card edge="blue" flush as="section" aria-labelledby="invoice-original" className="flex h-full flex-col">
              <h2 id="invoice-original" className="px-4 pb-2 pt-3.5 text-[13px] font-semibold text-ink">
                Original document
              </h2>
              {source.state.kind === "document" ? (
                <SourceDocumentBody cacheKey={orderId} document={source.state.document} bounded={isLg} />
              ) : (
                <p className="px-4 pb-4 text-[12.5px] text-ink-muted">
                  {source.isLoading ? "Opening the document…" : sourceUnavailableMessage(source.state)}
                </p>
              )}
            </Card>
          </div>
        )}

        <Card edge="blue" as="section" aria-labelledby="invoice-read" className="min-w-0">
          <h2 id="invoice-read" className="mb-3 text-[13px] font-semibold text-ink">
            What we read
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex min-w-0 flex-col gap-1 text-[11.5px] font-semibold text-ink-muted">
                {f.label}
                <input
                  type={"type" in f ? f.type : "text"}
                  step={"type" in f && f.type === "number" ? "0.01" : undefined}
                  value={draft[f.key] ?? String(order[f.key] ?? "")}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className={`h-9 w-full rounded-[6px] border border-border bg-surface px-2.5 text-[12.5px] font-normal text-ink ${
                    f.key === "supplierName" ? "" : "font-mono"
                  }`}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => save.mutate()} disabled={!canSave} loading={save.isPending}>
              Save changes
            </Button>
            {save.isError && (
              <span role="alert" className="text-[12px] text-danger">
                {save.error.message}
              </span>
            )}
          </div>

          <h3 className="mb-1.5 mt-5 text-[12px] font-semibold text-ink">Lines</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] text-ink">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-ink-muted">
                  <th className="py-1.5 pr-2 font-semibold">Item</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Unit price</th>
                  <th className="py-1.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="py-1.5 pr-2">{l.description || l.buyerItemCode}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{l.quantity}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{formatAmount(l.unitPrice)}</td>
                    <td className="py-1.5 text-right font-mono">{formatAmount(l.lineAmount ?? l.quantity * l.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="invoice-checks" className="flex flex-col gap-2">
            <h2 id="invoice-checks" className="text-[13px] font-semibold text-ink">
              Checks
            </h2>
            {checks.isError ? (
              <p className="text-[12.5px] text-ink-muted">We couldn&rsquo;t load this invoice&rsquo;s checks just now.</p>
            ) : checks.isPending || order.status === "parsing" ? null : problems.length === 0 ? (
              <StatusNotice tone="success">All checks passed</StatusNotice>
            ) : (
              problems.map((p) => (
                <StatusNotice key={p.id} tone="warning">
                  {p.message}
                </StatusNotice>
              ))
            )}
          </section>

          <Card edge="green" as="section" aria-labelledby="invoice-output">
            <h2 id="invoice-output" className="mb-2 text-[13px] font-semibold text-ink">
              Where it goes
            </h2>
            {order.status === "unrouted" ? (
              <StatusNotice
                tone="warning"
                action={
                  <Link href="/settings?tab=org" className="font-semibold underline">
                    Choose where invoices go
                  </Link>
                }
              >
                Invoices have nowhere to go yet.
              </StatusNotice>
            ) : (
              <p className="text-[13px] text-ink">
                {destination ? `Goes to ${destination}` : "Goes to your invoice destination"}
                {format && ` as ${format}`}
              </p>
            )}
            {order.status === "pending_review" && (
              <p className="mt-2 text-[12px] text-ink-muted">Fix the problems above and save — Send unlocks once every check passes.</p>
            )}
            {(flowNotice || outcome) && (
              <StatusNotice tone={flowNotice ? FLOW_TONE[flowSeverity] : outcomeTone} className="mt-3">
                {flowNotice ?? outcome}
              </StatusNotice>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="send" onClick={() => void confirmSend()} disabled={!canSend} loading={sendState !== "idle"}>
                {sent ? "Sent" : sendState === "transforming" ? "Preparing…" : sendState === "delivering" ? "Sending…" : "Send"}
              </Button>
              {artifact && <Button onClick={() => void download(artifact.id)}>Download</Button>}
              <Link href={`/inbox/${orderId}`} className="ml-auto text-[12.5px] font-medium text-brand-blue hover:underline">
                Open in Advanced
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
