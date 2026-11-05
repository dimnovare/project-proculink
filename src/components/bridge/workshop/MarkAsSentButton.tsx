"use client";

// "Mark as sent" — for a supplier set to "I'll send it myself": the user downloads the file, sends
// it outside ProcuLink, then closes the order here. Same endpoint as confirming an unconfirmed
// delivery; the backend admits ready_to_deliver only for a manual supplier.

import { useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { Order } from "@/types/procurement";
import { SECONDARY_BAR_BUTTON, barButtonGeometry } from "./DownloadButton";

export function MarkAsSentButton({ order, size, refetchOrder, setFlow }: {
  order: Order;
  size: "bar" | "sticky";
  refetchOrder: () => Promise<unknown>;
  setFlow: (message: string | null, severity?: "info" | "success" | "error") => void;
}) {
  const [pending, setPending] = useState(false);
  if (order.documentType === "invoice" || order.status !== "ready_to_deliver") return null;

  async function markSent() {
    setPending(true);
    try {
      await apiClient.markDelivered(order.id);
      await refetchOrder();
      setFlow("Marked as sent.", "success");
    } catch (e) {
      setFlow(e instanceof Error && e.message ? e.message : "We couldn't mark this order as sent. Try again.", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void markSent()}
      disabled={pending}
      title="Use this once you've sent the file to the supplier yourself."
      className={`${barButtonGeometry(size)} ${SECONDARY_BAR_BUTTON} font-bold disabled:cursor-not-allowed`}
    >
      {pending ? "Marking as sent…" : "Mark as sent"}
    </button>
  );
}
