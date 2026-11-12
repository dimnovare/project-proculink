"use client";

// "Hold this order for review" — a per-order hold: the order is never auto-delivered, and an
// explicit Send still works. Hold-only resolve request (no line or header edit). Shown only
// while a hold is accepted and honoured (HOLDABLE_STATUSES), and not for invoices (they have their own send path).

import { useState } from "react";
import { apiClient } from "@/lib/api-client";
import { HOLDABLE_STATUSES } from "@/lib/orderStatusManifest";
import type { Order } from "@/types/procurement";

export function HoldForReviewToggle({ order, refetchOrder, setFlow }: {
  order: Order;
  refetchOrder: () => Promise<unknown>;
  setFlow: (message: string | null, severity?: "info" | "success" | "error") => void;
}) {
  const [pending, setPending] = useState(false);
  async function toggle(holdForReview: boolean) {
    setPending(true);
    try {
      await apiClient.resolvePurchaseOrder(order.id, { saveMappings: false, lineResolutions: [], holdForReview });
      await refetchOrder();
    } catch {
      setFlow("We couldn't change the hold. Try again.", "error");
    } finally {
      setPending(false);
    }
  }
  if (order.documentType === "invoice" || !HOLDABLE_STATUSES.includes(order.status)) return null;
  return (
    // Short label: the header row has no room for a longer one at 1440px.
    <label
      className="flex items-center gap-2 whitespace-nowrap text-[12.5px] font-medium text-ink"
      title="This order is never sent automatically. You can still send it yourself."
    >
      <input
        type="checkbox"
        checked={order.holdForReview === true}
        disabled={pending}
        onChange={(e) => void toggle(e.target.checked)}
      />
      Hold for review
    </label>
  );
}
