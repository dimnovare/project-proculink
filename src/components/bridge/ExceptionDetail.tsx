"use client";

// ExceptionDetail (Group V6) — the expanded, progressive-disclosure body for one
// exception row. Surfaces, in order:
//   1. What's wrong  — the validation/parse error (code · stage · message).
//   2. Why           — the failing stage/field and, where the exception belongs
//                      to a supplier, a link to that supplier's rule bindings
//                      (which carry the UBL/EDIFACT/X12/cXML standards refs).
//   3. How to fix    — link to the order review screen / mapping editor.
//   4. Status        — delivered ≠ accepted: shows the real delivery state
//                      honestly. There is no ACK field on the order DTO, so a
//                      delivered order is labelled "sent — acceptance unconfirmed"
//                      unless the supplier explicitly acknowledged/rejected.
//
// The order is fetched lazily (only when a row is expanded) so the list stays
// cheap. Each exception also links to its order's Conformance panel (Feature 1)
// and the supplier's bindings (Feature 2).

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { apiClient } from "@/lib/api-client";
import type { OrderException } from "@/types/procurement";
import { UnifiedStatusBadge, statusLabel } from "@/components/bridge/UnifiedStatusBadge";

// Stage → plain-English "why". The exception code is machine-readable; this gives
// the operator a human reason without pretending we have a field-level rule ref.
function stageReason(stage: string | null | undefined, code: string | null | undefined): string {
  const s = (stage ?? "").toLowerCase();
  const c = (code ?? "").toLowerCase();
  if (c.includes("mapping") || c.includes("unresolved")) return "One or more lines have no resolved supplier item code.";
  if (s.includes("parse") || c.includes("parse")) return "The source document could not be parsed into a clean order.";
  if (s.includes("validate") || c.includes("rule") || c.includes("accept")) return "An acceptance rule for this supplier failed.";
  if (s.includes("transform") || c.includes("transform")) return "The order could not be transformed into the supplier's output format.";
  if (s.includes("deliver") || c.includes("deliver")) return "Delivery to the supplier did not complete.";
  if (c.includes("reject")) return "The supplier rejected the order.";
  return "This order needs a human decision before it can be sent.";
}

// Honest delivery status line. delivered ≠ accepted — there is no ACK field on
// the Order DTO, so "delivered" is presented as "sent, acceptance unconfirmed".
function deliveryStatusCopy(status: string): { label: string; detail: string; tone: "ok" | "warn" | "bad" | "neutral" } {
  const s = (status ?? "").toLowerCase();
  if (s === "delivered" || s === "sent")
    return { label: "Sent — acceptance unconfirmed", detail: "The document reached the supplier endpoint. A 2xx is not the same as business acceptance; check the supplier response tab for an acknowledgement.", tone: "warn" };
  if (s === "rejected" || s === "rejected_by_supplier")
    return { label: "Rejected by supplier", detail: "The supplier rejected this order. Fix the cause and resend.", tone: "bad" };
  if (s === "delivery_failed" || s === "delivery_dead_letter" || s === "failed")
    return { label: "Delivery failed", detail: "The order has not reached the supplier. Open the order to retry.", tone: "bad" };
  if (s === "delivering")
    return { label: "Sending…", detail: "A delivery attempt is in progress.", tone: "neutral" };
  // Billing hold — "warn", never "bad": nothing failed and nothing is lost. Kept
  // above the fallback, which would give this a bare humanized label and the
  // reason-free "has not been sent yet" line.
  if (s === "delivery_held")
    return { label: "Delivery paused — billing", detail: "The supplier file is generated and waiting, but sending is paused because the plan can't process orders right now. Delivery resumes automatically once billing is up to date.", tone: "warn" };
  return { label: statusLabel(status), detail: "This order has not been sent yet.", tone: "neutral" };
}

const TONE_COLOR: Record<string, string> = {
  ok: "var(--brand-green-deep)",
  warn: "var(--amber)",
  bad: "var(--danger)",
  neutral: "var(--ink-muted)",
};

function Section({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div
        aria-hidden
        className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ background: "var(--surface-2)", color: "var(--ink-muted)" }}
      >
        {step}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ink-faint)" }}>{title}</div>
        <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--ink)" }}>{children}</div>
      </div>
    </div>
  );
}

export function ExceptionDetail({ exc }: { exc: OrderException }) {
  const queryEnabled = useQueriesEnabled();
  const orderId = exc.orderId ?? null;

  // Lazy — only runs once this detail is mounted (i.e. the row is expanded).
  const { data: order, isLoading } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiClient.getOrderById(orderId as string),
    enabled: queryEnabled && !!orderId,
    staleTime: 15_000,
    retry: 1,
  });

  const reviewHref = orderId ? `/inbox/${orderId}` : null;
  const conformanceHref = orderId ? `/inbox/${orderId}?tab=conformance` : null;
  const supplierHref = order?.supplierId ? `/library/suppliers/${order.supplierId}` : null;
  const delivery = order ? deliveryStatusCopy(order.status) : null;

  return (
    <div className="grid gap-4 px-4 py-4 sm:px-5" style={{ background: "#FAFBFC", borderTop: "1px solid #F0F2F6" }}>
      {/* 1. What's wrong */}
      <Section step="1" title="What's wrong">
        <p style={{ margin: 0 }}>{exc.message}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {exc.code && <span className="font-mono">{exc.code}</span>}
          {exc.code && exc.stage && <span>·</span>}
          {exc.stage && <span>Step: {exc.stage}</span>}
        </div>
      </Section>

      {/* 2. Why */}
      <Section step="2" title="Why">
        <p style={{ margin: 0 }}>{stageReason(exc.stage, exc.code)}</p>
        {supplierHref && (
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink-muted)" }}>
            See the standard each required field maps to on the{" "}
            <Link href={supplierHref} className="font-semibold underline" style={{ color: "var(--brand-blue)" }}>
              supplier&apos;s Validation rules tab
            </Link>.
          </p>
        )}
      </Section>

      {/* 3. How to fix */}
      <Section step="3" title="How to fix">
        {reviewHref ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={reviewHref}
              className="inline-flex items-center gap-1.5 rounded-[7px] px-3 h-[32px] text-[12px] font-semibold"
              style={{ background: "var(--brand-blue)", color: "#FFFFFF", textDecoration: "none" }}
            >
              Open order to fix →
            </Link>
            {conformanceHref && (
              <Link
                href={conformanceHref}
                className="inline-flex items-center gap-1.5 rounded-[7px] px-3 h-[32px] text-[12px] font-medium"
                style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", textDecoration: "none" }}
              >
                Check conformance
              </Link>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, color: "var(--ink-muted)" }}>
            This exception isn&apos;t tied to a single order. Use Ignore to dismiss it once it no longer applies.
          </p>
        )}
      </Section>

      {/* 4. Status (delivered ≠ accepted) */}
      <Section step="4" title="Status">
        {!orderId ? (
          <p style={{ margin: 0, color: "var(--ink-muted)" }}>No owning order.</p>
        ) : isLoading || !order ? (
          <span className="inline-block h-4 w-40 animate-pulse rounded" style={{ background: "var(--surface-2)" }} />
        ) : (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <UnifiedStatusBadge status={order.status} size="sm" />
              {delivery && (
                <span className="text-[12px] font-semibold" style={{ color: TONE_COLOR[delivery.tone] }}>
                  {delivery.label}
                </span>
              )}
            </div>
            {delivery && (
              <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>{delivery.detail}</p>
            )}
            {order.errorMessage && (
              <p className="mt-1 text-[12px]" style={{ color: "var(--danger)" }}>{order.errorMessage}</p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

export default ExceptionDetail;
