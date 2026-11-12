"use client";

// InvoiceScreen — the Simple document screen for one invoice.
//
// Left to right: the original, what we read (editable), the checks, and where it goes.
// Nothing here is new machinery: the order query and its polling (useOrderReview), the
// original pane (useSourceDocument + SourceDocumentBody), the order-level problem read the
// review screen uses (OrderExceptionsNotice's query + openOrderLevelExceptions), the review
// screen's own send flow (useSendFlow: transform → deliver, the same explicit states) and its
// problem panel (OrderProblemPanel) for every problem state but `unrouted`.
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
import { formatDateTime } from "@/lib/format-date";
import { INVOICE_EDITABLE_STATUSES, opAllowsStatus, PAST_REVIEW_STATUSES } from "@/lib/orderStatusManifest";
import { sourceUnavailableMessage } from "@/lib/sourceDocument";
import { partyLabels } from "@/hooks/useOrderDirection";
import { useIsOrgAdmin } from "@/hooks/useIsOrgAdmin";
import type { ResolvePayload } from "@/types/procurement";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice, type NoticeTone } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { FileChip } from "@/components/bridge/FileChip";
import { STAGES, StatusJourney } from "@/components/bridge/StatusJourney";
import { BridgePageLoader } from "@/components/bridge/BridgeLoader";
import { journeyStage } from "@/components/bridge/InboxView";
import { mapStatus } from "@/lib/orderArchiveStatus";
import { useOrderReview } from "@/components/bridge/review/hooks/useOrderReview";
import { useSendFlow } from "@/components/bridge/review/hooks/useSendFlow";
import { useDownloadFinished } from "@/hooks/useDownloadFinished";
import { deliverableArtifact, deliveryChannelLabel, formatMoney } from "@/components/bridge/review/orderDisplay";
import { openOrderLevelExceptions } from "@/components/bridge/workshop/OrderExceptionsNotice";
import { formatAmount } from "@/components/bridge/workshop/workshopLinesModel";
import { OrderProblemPanel } from "@/components/bridge/problem/OrderProblemPanel";
import { problemFor } from "@/components/bridge/problem/problemCopy";
import { useLgViewport, useSourceDocument } from "@/components/bridge/document/useSourceDocument";
import { SourceDocumentBody } from "@/components/bridge/document/SourceDocumentBody";

/** The read fields, in reading order. Every key is both an `Order` field and a /resolve field. */
const FIELDS = [
  { key: "poNumber", label: "Invoice number" },
  { key: "supplierName", label: "Seller" },
  { key: "orderDate", label: "Invoice date", type: "date" },
  { key: "dueDate", label: "Due date", type: "date" },
  { key: "sellerTaxId", label: "Seller VAT ID" },
  { key: "paymentReference", label: "Payment reference" },
  { key: "paymentIban", label: "IBAN" },
  { key: "subTotal", label: "Net", type: "number" },
  { key: "taxTotal", label: "VAT", type: "number" },
  { key: "grandTotal", label: "Total", type: "number" },
] as const;
type Field = (typeof FIELDS)[number];
type FieldKey = Field["key"];
type Draft = Partial<Record<FieldKey, string>>;
const isNumber = (f: Field) => "type" in f && f.type === "number";
/** Changing these needs a workspace admin (the backend enforces it); the rest any member may edit. */
const ADMIN_ONLY: readonly FieldKey[] = ["paymentIban", "poNumber", "supplierName", "sellerTaxId"];

/** The backend's sentence for this check (InvoiceChecks.cs), verbatim — it is what marks Total. */
const TOTAL_MISMATCH = "Net plus VAT does not equal the total.";
const CHECKED = [
  "Net plus VAT equals the total",
  "The lines add up to the net total",
  "The bank account (IBAN) is valid",
  "It isn't a duplicate of an invoice already received",
];
const FLOW_TONE: Record<"info" | "success" | "error", NoticeTone> = { info: "working", success: "success", error: "error" };
const CAPTION = "mt-2 text-[12px] text-ink-muted";

/** Only the fields the person edited go to /resolve; the backend reads absent as "not edited". */
function editsToPayload(draft: Draft): ResolvePayload {
  const header: Record<string, string | number> = {};
  for (const f of FIELDS) {
    const v = draft[f.key]?.trim();
    if (v) header[f.key] = isNumber(f) ? Number(v) : v;
  }
  return { saveMappings: false, lineResolutions: [], ...header };
}

export function InvoiceScreen({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const { order, isLoading, isError, refetchOrder, queryEnabled } = useOrderReview(orderId);
  const [showOriginal, setShowOriginal] = useState(true);
  const [draft, setDraft] = useState<Draft>({});
  const [anywayOpen, setAnywayOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { known: adminKnown, isAdmin } = useIsOrgAdmin();
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
  // channel and format from its delivery config — the same two reads the supplier pages use.
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
  const channel = delivery.data ? deliveryChannelLabel(delivery.data.protocol) : null;

  const labels = useMemo(
    () => ({ ...partyLabels("outbound"), deliveredLabel: destination ? `Sent to ${destination}` : "Sent" }),
    [destination],
  );
  const { flowNotice, flowSeverity, setFlow, sendState, crossed, confirmSend } = useSendFlow({ orderId, order, labels, refetchOrder });

  // A destination set to "I'll send it myself" is never dispatched (the server refuses a send), so
  // its action is Download.
  const manual = delivery.data?.protocol === "manual";
  const finished = useDownloadFinished({ orderId, order, setFlow, refetchOrder });

  // /resolve re-runs the invoice checks, so the order AND its problems are re-read before the
  // draft is dropped — the inputs never flash the old values.
  const save = useMutation({
    mutationFn: () => apiClient.resolvePurchaseOrder(orderId, editsToPayload(draft)),
    onSuccess: async () => {
      await Promise.all([
        refetchOrder(),
        qc.invalidateQueries({ queryKey: ["order-exceptions", orderId] }),
        qc.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      setDraft({});
    },
  });

  // Release the hold (admin, with a reason kept in the history), re-read the order and its
  // checks, then run the same send the Send button runs.
  const sendAnyway = useMutation({
    mutationFn: async () => {
      await apiClient.sendInvoiceAnyway(orderId, reason.trim());
      await Promise.all(
        [["order", orderId], ["order-exceptions", orderId], ["orders"]].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
    // A manual destination is never sent to: releasing the hold leads to the download instead.
    onSuccess: () => void (manual ? finished.download() : confirmSend()),
  });

  async function download(artifactId: string) {
    try {
      const { url } = await apiClient.getDownloadUrl(orderId, artifactId);
      window.location.assign(url);
    } catch {
      setFlow("We couldn't start the download. Try again in a moment.", "error");
    }
  }

  // A disabled query is not a failed one: until it runs, `order` is undefined and isLoading is
  // false. Only a real failure (or a null answer) says it couldn't load — as OrderWorkshop does.
  if (isError || order === null) {
    return (
      <PageShell>
        <StatusNotice tone="error">We couldn&rsquo;t load this document. Go back to Documents and open it again.</StatusNotice>
      </PageShell>
    );
  }
  if (!queryEnabled || isLoading || order === undefined) return <BridgePageLoader label="Opening the invoice…" />;
  if (order.documentType !== "invoice") {
    return (
      <PageShell>
        <StatusNotice tone="working" action={<Link href={`/inbox/${orderId}`} className="font-semibold underline">Open in Advanced</Link>}>
          This document opens in the order review.
        </StatusNotice>
      </PageShell>
    );
  }

  // Only the invoice's own checks count here; another open order exception is not a check problem.
  const problems = openOrderLevelExceptions(checks.data).filter((e) => e.code === "invoice_check");
  const sentAnyway = problems.length === 0 && !!checks.data?.some((e) => e.code === "invoice_check" && e.state === "ignored");
  const problem = problemFor(order.status);
  const stage = journeyStage(mapStatus(order.status), order.status);
  const reading = order.status === "parsing";
  const held = order.status === "pending_review";
  const sent = crossed || order.status === "delivered";
  // A problem state (rejected, unconfirmed, …) owns its own recovery in the panel: a Send here
  // would POST /redeliver into a guaranteed refusal, or deliver an unconfirmed invoice twice.
  const canSend =
    !problem && !sent && sendState === "idle" && (opAllowsStatus("transformOrder", order.status) || opAllowsStatus("redeliverOrder", order.status));
  const value = (k: FieldKey) => draft[k] ?? String(order[k] ?? "");
  const hasEdits = FIELDS.some((f) => draft[f.key]?.trim());
  const editable = INVOICE_EDITABLE_STATUSES.includes(order.status);
  const canSave = hasEdits && editable;
  const artifact = deliverableArtifact(order.artifacts);
  // Success is the sent notice below; in-flight progress is the button's own label.
  const notice = sendState === "idle" && !problem && flowSeverity !== "success" ? flowNotice : null;
  const problemCount = `${problems.length} ${problems.length === 1 ? "problem" : "problems"}`;
  const totalOff = problems.some((p) => p.message === TOTAL_MISMATCH);
  const [net, vat] = [value("subTotal"), value("taxTotal")].map((v) => (v.trim() ? Number(v) : NaN));
  const seller = order.supplierName?.trim() || null;
  const statedTotal = order.grandTotal != null ? formatMoney(order.currency, order.grandTotal) : null;

  const field = (f: Field) => {
    const invalid = f.key === "grandTotal" && totalOff;
    const hint = invalid && Number.isFinite(net + vat);
    const readOnly = !editable || (ADMIN_ONLY.includes(f.key) && !(adminKnown && isAdmin));
    return (
      <div key={f.key} className="flex min-w-0 flex-col gap-1 text-[11.5px] font-semibold text-ink-muted">
        <label className="flex flex-col gap-1">
          {f.label}
          <input
            id={invalid ? "invoice-total" : undefined}
            type={"type" in f ? f.type : "text"}
            step={isNumber(f) ? "0.01" : undefined}
            value={value(f.key)}
            readOnly={readOnly}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            aria-invalid={invalid || undefined}
            aria-describedby={hint ? "invoice-total-hint" : undefined}
            className={`h-9 w-full rounded-[6px] border bg-surface px-2.5 text-[12.5px] font-normal text-ink ${
              f.key === "supplierName" ? "" : "font-mono"
            } ${isNumber(f) ? "text-right" : ""} ${invalid ? "border-amber ring-[3px] ring-amber-soft" : "border-border"} ${readOnly ? "bg-bg text-ink-muted" : ""}`}
          />
        </label>
        {hint && (
          <span id="invoice-total-hint" className="font-medium text-amber-text">
            Net + VAT = {formatMoney(order.currency, net + vat)}
          </span>
        )}
      </div>
    );
  };

  return (
    <PageShell variant="wide">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-ink">
              Invoice <span className="font-mono text-[21px]">{order.poNumber}</span>
            </h1>
            <span className="rounded-full border border-border-strong px-2 text-[11px] font-semibold leading-[20px] text-ink-muted">Early access</span>
          </div>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {seller ? <>From <strong className="font-semibold text-ink">{seller}</strong> · arrived </> : "Arrived "}
            {formatDateTime(order.createdAt)}
            {statedTotal && <> · stated total <strong className="font-semibold text-ink">{statedTotal}</strong></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {stage !== null && (
            <span className="flex items-center gap-2 text-[12px] font-semibold text-ink-muted">
              <StatusJourney stage={stage} compact />
              {STAGES[typeof stage === "number" ? stage : stage.failed]}
            </span>
          )}
          <Button size="sm" aria-expanded={showOriginal} aria-controls="invoice-original-pane" onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? "Hide original" : "Show original"}
          </Button>
          <Link href={`/inbox/${orderId}`} className="text-[12.5px] font-medium text-brand-blue hover:underline">
            Open in Advanced
          </Link>
        </div>
      </header>

      {/* Below lg the Checks card sits under the original and the read data, so its count leads here. */}
      {problems.length > 0 && (
        <div className="mb-4 lg:hidden">
          <StatusNotice tone="warning" action={<a href="#invoice-checks" className="font-semibold underline">Go to Checks</a>}>
            {problemCount} — {problems[0].message}
          </StatusNotice>
        </div>
      )}

      {/* The review screen's panel, unchanged; it names the recipient, which here is the destination. */}
      {problem && order.status !== "unrouted" && (
        <div className="mb-4">
          <OrderProblemPanel order={{ ...order, supplierName: destination ?? "" }} mode="banner" />
        </div>
      )}

      <div
        className={`grid items-start gap-4 ${
          showOriginal ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]"
        }`}
      >
        <div id="invoice-original-pane" hidden={!showOriginal} className="min-w-0 lg:sticky lg:top-0 lg:h-[calc(100vh-150px)]">
          <Card edge="blue" flush as="section" aria-labelledby="invoice-original" className="flex h-full flex-col">
            <div className="px-4 pb-2 pt-3.5">
              <h2 id="invoice-original" className="text-[13px] font-semibold text-ink">
                Original document
              </h2>
              <p className="text-[12px] text-ink-muted">Exactly what arrived. It stays here while you check.</p>
            </div>
            {source.state.kind === "document" ? (
              <SourceDocumentBody cacheKey={orderId} document={source.state.document} bounded={isLg} />
            ) : (
              <p className="px-4 pb-4 text-[12.5px] text-ink-muted">
                {source.isLoading ? "Opening the document…" : sourceUnavailableMessage(source.state, "invoice")}
              </p>
            )}
          </Card>
        </div>

        <Card edge="blue" as="section" aria-labelledby="invoice-read" className="min-w-0">
          <h2 id="invoice-read" className="text-[13px] font-semibold text-ink">
            What we read
          </h2>
          <p className="mb-3 text-[12px] text-ink-muted">Correct anything we misread, then save. The checks run again.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{FIELDS.filter((f) => !isNumber(f)).map(field)}</div>
          <fieldset className="mt-4">
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Totals · {order.currency}</legend>
            <div className="grid grid-cols-3 gap-3">{FIELDS.filter(isNumber).map(field)}</div>
          </fieldset>

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
          {editable && adminKnown && !isAdmin && (
            <p className={CAPTION}>Only a workspace admin can change the IBAN, number or seller.</p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            {save.isError && (
              <span role="alert" className="mr-auto text-[12px] text-danger">
                {save.error.message}
              </span>
            )}
            {editable && !hasEdits && <span className="text-[12px] text-ink-muted">No unsaved changes</span>}
            {editable && (
              <Button size="sm" onClick={() => save.mutate()} disabled={!canSave} loading={save.isPending}>
                Save changes
              </Button>
            )}
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card as="section" aria-labelledby="invoice-checks">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 id="invoice-checks" className="text-[13px] font-semibold text-ink">
                Checks
              </h2>
              {problems.length > 0 && (
                <span className="rounded-full bg-amber-soft px-2 text-[11.5px] font-semibold leading-[22px] text-amber-text">
                  {problemCount}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {checks.isError ? (
                <p className="text-[12.5px] text-ink-muted">We couldn&rsquo;t load this invoice&rsquo;s checks just now.</p>
              ) : reading ? (
                <StatusNotice tone="working">Reading the invoice… The checks run as soon as it&rsquo;s read.</StatusNotice>
              ) : checks.isPending ? null : problems.length > 0 ? (
                <>
                  {problems.map((p) => (
                    <StatusNotice
                      key={p.id}
                      tone="warning"
                      action={p.message === TOTAL_MISMATCH && <a href="#invoice-total" className="font-semibold underline">Go to Total</a>}
                    >
                      {p.message}
                    </StatusNotice>
                  ))}
                  <p className="text-[12px] text-ink-muted">The other checks passed.</p>
                </>
              ) : held ? (
                // A held invoice whose problems were all dismissed is still held: never "passed".
                <StatusNotice tone="warning">This invoice is held for review. Open it in Advanced to see why.</StatusNotice>
              ) : PAST_REVIEW_STATUSES.includes(order.status) ? (
                sentAnyway ? (
                  <StatusNotice tone="working">Sent anyway by an admin.</StatusNotice>
                ) : (
                  <StatusNotice tone="success">All checks passed.</StatusNotice>
                )
              ) : null}
            </div>
            <details className="mt-3 text-[12px] text-ink-muted">
              <summary className="cursor-pointer font-semibold text-brand-blue">What we check</summary>
              <ul className="mt-1.5 list-disc pl-5">
                {CHECKED.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
            <p className="mt-3 text-[12px] text-ink-muted">
              Misread? Correct the field and save. Wrong on the invoice itself? Ask {seller ?? "the seller"} for a corrected invoice.
            </p>
          </Card>

          <Card edge="green" as="section" aria-labelledby="invoice-output">
            <h2 id="invoice-output" className="mb-2 text-[13px] font-semibold text-ink">
              {sent ? "Where it went" : "Where it goes"}
            </h2>
            {order.status === "unrouted" ? (
              <>
                <StatusNotice tone="working">
                  Invoices have nowhere to go yet. Pick one place for every invoice: an accounting inbox, an SFTP folder or an
                  API. This one waits here until then.
                </StatusNotice>
                <Link
                  href="/settings?tab=org"
                  className="mt-3 flex h-[38px] w-full items-center justify-center rounded bg-navy text-[13px] font-semibold text-white"
                >
                  Choose where invoices go
                </Link>
              </>
            ) : sent ? (
              <>
                <StatusNotice tone="success">
                  <strong className="block">{destination ? `Sent to ${destination}` : "Sent"}</strong>
                  {[formatDateTime(order.updatedAt), channel].filter(Boolean).join(" · ")}
                </StatusNotice>
                {artifact && (
                  <Button className="mt-3 w-full" onClick={() => void download(artifact.id)}>
                    Download
                  </Button>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 rounded-[6px] border border-border bg-bg p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-ink">{destination ?? "Your invoice destination"}</p>
                    {channel && <p className="text-[11.5px] text-ink-muted">{channel}</p>}
                  </div>
                  {format && <FileChip type={format} />}
                </div>
                <Button
                  variant="navy"
                  size="lg"
                  className="mt-3 w-full"
                  onClick={() => void (manual ? finished.download() : confirmSend())}
                  disabled={!canSend}
                  loading={manual ? finished.busy : sendState !== "idle"}
                >
                  {manual ? (finished.busy ? "Preparing…" : "Download") : sendState === "transforming" ? "Preparing…" : sendState === "delivering" ? "Sending…" : "Send invoice"}
                </Button>
                {reading && <p className={CAPTION}>Available once the checks finish.</p>}
                {problems.length > 0 && <p className={CAPTION}>Fix the problem in Checks first.</p>}
                {held && adminKnown &&
                  (!isAdmin ? (
                    <p className={CAPTION}>A workspace admin can send it anyway.</p>
                  ) : !anywayOpen ? (
                    <button type="button" aria-expanded={false} onClick={() => setAnywayOpen(true)} className="mt-2 text-[12.5px] font-semibold text-brand-blue hover:underline">
                      {manual ? "Download anyway…" : "Send anyway…"}
                    </button>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2">
                      <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-muted">
                        Why it&rsquo;s fine to send (kept in the history)
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          autoFocus
                          maxLength={500}
                          rows={3}
                          className="w-full rounded-[6px] border border-border bg-surface px-2.5 py-2 text-[12.5px] font-normal text-ink"
                        />
                      </label>
                      {sendAnyway.isError && (
                        <span role="alert" className="text-[12px] text-danger">
                          {sendAnyway.error.message}
                        </span>
                      )}
                      <Button
                        className="w-full border-amber text-amber-text"
                        onClick={() => sendAnyway.mutate()}
                        disabled={reason.trim().length < 3}
                        loading={sendAnyway.isPending || (manual ? finished.busy : sendState !== "idle")}
                      >
                        {manual ? "Download anyway" : "Send anyway"}
                      </Button>
                    </div>
                  ))}
              </>
            )}
            {notice && (
              <StatusNotice tone={FLOW_TONE[flowSeverity]} className="mt-3">
                {notice}
              </StatusNotice>
            )}
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
