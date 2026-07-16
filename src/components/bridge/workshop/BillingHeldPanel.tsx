"use client";

import Link from "next/link";
import type { Order } from "@/types/procurement";
import { BILLING_HELD_MESSAGE } from "../review/hooks/useOrderReview";

/* =====================================================================
   BillingHeldPanel — the workshop gate for `delivery_held`.

   Backend behaviour this panel is describing (DeliveryService.HoldForBillingAsync):
   when an org lapses to read_only / past_due / trial_expired / cancelled between
   transform and the delivery job, the order is PAUSED into `delivery_held` rather
   than delivered — and ReleaseBillingHeldOrdersAsync moves every held order back
   to `ready_to_deliver` and re-drives delivery the moment the org is in good
   standing again. So:

     - Amber, not red. Nothing failed; the transformed artifact is intact.
     - No Send button. `delivery_held` is NOT in the backend's
       OrderStatusMachine.RedeliverableFrom, so POST /redeliver answers 400. The
       release is automatic; the only useful action is settling billing.

   Without this gate a held order falls through to the normal mapper and shows a
   live Send button that can only ever 400 — with no hint that billing is the cause.
   ===================================================================== */

const T = {
  amber:     "#B36D14",
  amberSoft: "#FAF1DD",
  navy:      "#0B1A2F",
  ink:       "#0B1A2F",
  inkMuted:  "#5E6779",
  surface:   "#FFFFFF",
  border:    "#E5E8EE",
  bg:        "#F6F7FA",
  ui:        '"Inter", system-ui, sans-serif',
  mono:      '"JetBrains Mono", ui-monospace, monospace',
};

export function BillingHeldPanel({ order }: { order: Order }) {
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
      data-testid="order-billing-held"
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
        {/* Header — a pause glyph, deliberately not the warning triangle the
            failure panels use. */}
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
            <line x1="10" y1="9" x2="10" y2="15" />
            <line x1="14" y1="9" x2="14" y2="15" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.amber }}>
            Delivery paused
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, margin: "0 0 12px" }}>
            {BILLING_HELD_MESSAGE}
          </p>

          <p style={{ fontSize: 12.5, color: T.inkMuted, lineHeight: 1.6, margin: "0 0 16px" }}>
            You don&apos;t need to re-upload{order.poNumber ? " " : ""}
            {order.poNumber && (
              <span style={{ fontFamily: T.mono, color: T.ink }}>{order.poNumber}</span>
            )}
            {" "}or redo the mapping — it stays exactly as it is until sending resumes.
          </p>

          <Link
            href="/settings?tab=billing"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              minHeight: 40,
              padding: "9px 18px",
              borderRadius: 7,
              background: T.navy,
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Go to billing
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M6 3l5 5-5 5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
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

export default BillingHeldPanel;
