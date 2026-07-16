import Link from "next/link";
import {
  BILLING_HELD_MESSAGE,
  BILLING_HELD_MESSAGE_PLURAL,
} from "@/components/bridge/review/hooks/useOrderReview";

/**
 * Orders paused at the delivery step because the plan can't process orders right now.
 *
 * Amber, never red: nothing failed. The backend paused these on purpose and releases
 * them itself once billing is current, so the operator's action is the invoice — not
 * chasing the supplier, and not a retry (POST /redeliver answers 400 for a held order).
 *
 * Shaped after the review-backlog card above it, which solved the same problem — a count
 * that needs a human but is not a fault — and is rendered only when the count is non-zero
 * for the same reason: a "0 Deliveries paused" card above a green banner is noise that
 * reads as contradictory.
 */
export function DeliveryPausedCard({ count }: { count: number }) {
  return (
    <div
      className="mb-4 rounded-[10px] px-4 py-3"
      style={{ background: "var(--amber-soft)", border: "1px solid var(--amber)" }}
    >
      <Link
        href="/inbox?status=delivery_held"
        className="inline-flex items-center gap-3 transition-opacity hover:opacity-80"
        // minHeight 44: finger-tappable on a phone. The 26px numeral alone left the
        // row at 29px, under the touch-target floor the rest of this page holds to.
        style={{ textDecoration: "none", minHeight: 44 }}
      >
        <span
          style={{
            fontSize: 26, fontWeight: 700, color: "var(--amber-text)",
            lineHeight: 1.1, fontVariantNumeric: "tabular-nums",
          }}
        >
          {count.toLocaleString()}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--amber-text)" }}>
          {count === 1 ? "Delivery paused" : "Deliveries paused"}
        </span>
      </Link>
      <p
        data-testid="paused-explanation"
        style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--ink-muted)", maxWidth: "72ch" }}
      >
        {count === 1 ? BILLING_HELD_MESSAGE : BILLING_HELD_MESSAGE_PLURAL}
      </p>
      <Link
        href="/settings?tab=billing"
        className="mt-2 inline-flex items-center"
        style={{
          minHeight: 44, fontSize: 12.5, fontWeight: 600,
          color: "var(--amber-text)", textDecoration: "underline",
        }}
      >
        Go to billing
      </Link>
    </div>
  );
}
