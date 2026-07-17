"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm";
import type { Order } from "@/types/procurement";
import { DELIVERY_UNCONFIRMED_MESSAGE } from "../review/hooks/useOrderReview";

/* =====================================================================
   DeliveryUnconfirmedPanel — the workshop gate for `delivery_unconfirmed`.

   Backend behaviour this panel is describing (backend PR #27, DeliveryService):
   a crash between "the send was attempted" and "the channel confirmed receipt"
   leaves the outcome genuinely unknown on a channel that can't tell us whether
   it arrived (email / ERP connections — see the per-channel resend caveats in
   ConnectorRequirementsPanel). The backend refuses to guess and parks the order
   into `delivery_unconfirmed` rather than either silently resending (risking a
   duplicate PO at the supplier) or silently marking it delivered (risking it
   never arriving at all). So, unlike `delivery_held` next door:

     - Amber, not red. We don't know that it failed — only that we don't know.
     - TWO actions, not zero and not one. `delivery_unconfirmed` IS in the
       backend's RedeliverableFrom (a human may choose to accept the duplicate
       risk), and mark-delivered (PR #27) is the other resolution. Both need a
       human decision — the resolution is per-order, not the single global
       "go fix billing" link BillingHeldPanel offers, because there's no
       global cause to fix.
     - Each action confirms first: the operator is choosing which risk to
       accept (a possible duplicate vs. possibly leaving the supplier without
       their order), so the confirm copy states that risk in plain language
       before it happens.

   Without this gate a parked order would fall through to the normal mapper
   and show a live Send button with no explanation of why the order needs a
   decision at all — the backend crash is invisible to the operator.
   ===================================================================== */

const T = {
  amber:     "#B36D14",
  amberSoft: "#FAF1DD",
  danger:    "#B43838",
  dangerSoft:"#FBE3E3",
  navy:      "#0B1A2F",
  ink:       "#0B1A2F",
  inkMuted:  "#5E6779",
  surface:   "#FFFFFF",
  border:    "#E5E8EE",
  bg:        "#F6F7FA",
  ui:        '"Inter", system-ui, sans-serif',
  mono:      '"JetBrains Mono", ui-monospace, monospace',
};

type ParkAction = "redeliver" | "markDelivered";

// Copy pinned by the spec — states the risk in the direction the operator is
// moving, so a confirm click is an informed choice rather than a formality.
const CONFIRM_COPY: Record<ParkAction, { title: string; description: string; confirmLabel: string; danger?: boolean }> = {
  redeliver: {
    title: "Send this order again?",
    description: "If the supplier already received this order, sending again may give them a duplicate.",
    confirmLabel: "Send again",
  },
  markDelivered: {
    title: "Mark this order as delivered?",
    description: "If the supplier never received this order, marking it delivered means it will not be sent.",
    confirmLabel: "Mark delivered",
    danger: true,
  },
};

export function DeliveryUnconfirmedPanel({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Prefer the backend's pinned park sentence (order.errorMessage) — same claim
  // as the shared constant, but may carry order-specific detail. Mirrors the
  // identical fallback in finalDeliveryMessage / ExceptionDetail so the three
  // surfaces never drift apart.
  const message =
    order.errorMessage && order.errorMessage.trim().length > 0
      ? order.errorMessage
      : DELIVERY_UNCONFIRMED_MESSAGE;

  async function runAction(action: ParkAction) {
    const copy = CONFIRM_COPY[action];
    const ok = await confirm({
      title: copy.title,
      description: copy.description,
      confirmLabel: copy.confirmLabel,
      danger: copy.danger,
    });
    if (!ok) return;

    setBusy(true);
    setActionError(null);
    try {
      if (action === "redeliver") {
        await apiClient.redeliverOrder(order.id);
      } else {
        await apiClient.markDelivered(order.id);
      }
      // Both actions change order.status server-side — refresh the order itself
      // AND the list (FailedPanels.tsx pattern) so neither surface goes stale.
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "That didn't go through. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: "32px 24px",
        background: T.bg,
        fontFamily: T.ui,
      }}
      data-testid="order-delivery-unconfirmed"
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${T.amber}`,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {/* Header — a question-mark glyph: not the pause icon (nothing is paused,
            waiting to resume) and not the warning triangle the failure panels use
            (we don't know that it failed). */}
        <div
          style={{
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderBottom: `1px solid ${T.border}`,
            background: T.amberSoft,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.amber} strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.5 9a2.5 2.5 0 0 1 4.79-1 2.3 2.3 0 0 1-1.1 3.06c-.77.4-1.19 1.16-1.19 1.94" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.amber }}>
            Delivery unknown
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, margin: "0 0 16px" }}>
            {message}
          </p>

          {actionError && (
            <p
              style={{
                fontSize: 12,
                color: T.danger,
                margin: "0 0 12px",
                padding: "8px 12px",
                background: T.dangerSoft,
                borderRadius: 6,
                border: `1px solid ${T.danger}30`,
              }}
            >
              {actionError}
            </p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void runAction("redeliver")}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                minHeight: 40,
                padding: "9px 18px",
                borderRadius: 7,
                background: busy ? "#CBD0DA" : T.navy,
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                cursor: busy ? "not-allowed" : "pointer",
                fontFamily: T.ui,
              }}
            >
              Send again
            </button>
            <button
              type="button"
              onClick={() => void runAction("markDelivered")}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                minHeight: 40,
                padding: "9px 18px",
                borderRadius: 7,
                background: "transparent",
                border: `1px solid ${T.border}`,
                color: busy ? T.inkMuted : T.ink,
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                fontFamily: T.ui,
              }}
            >
              Mark as delivered
            </button>
          </div>
        </div>
      </div>

      <Link
        href="/inbox"
        style={{
          marginTop: 16,
          fontSize: 12.5,
          fontWeight: 600,
          color: T.inkMuted,
          textDecoration: "none",
        }}
      >
        ← Back to inbox
      </Link>
    </div>
  );
}

export default DeliveryUnconfirmedPanel;
