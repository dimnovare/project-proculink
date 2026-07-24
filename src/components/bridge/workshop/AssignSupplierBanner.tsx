"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiHttpError, apiClient } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import type { Order } from "@/types/procurement";
import { SupplierPicker } from "../SupplierPicker";

/* =====================================================================
   AssignSupplierBanner — the resolver for an order parked `unrouted`.

   An order ingested on a content-routed channel (SFTP / S3 / IMAP) with no
   resolvable supplier is parsed and parked: its header and lines are persisted,
   but normalisation cannot start because there is no supplier to resolve item
   codes against. POST /orders/{id}/assign-supplier is the only way out — it
   pins the supplier, atomically claims the order `unrouted` → `parsing` and
   re-enqueues the parse, which then resolves the lines the normal way.

   Not a gate. The workshop body still renders underneath: the extracted header
   and lines are real and worth reading before choosing who the order is for,
   and WorkshopLinesView already handles a supplier-less order (the catalog pick
   stays visible but disabled). A full-screen panel would hide the very evidence
   the operator needs to answer the question the panel is asking.

   Amber, not red: nothing failed. This is a backlog item, matching the backend's
   own `unrouted_order` exception severity ("warning") and the inbox pill.
   ===================================================================== */

const T = {
  amber:     "#B36D14",
  amberSoft: "#FAF1DD",
  amberLine: "#EBD7AE",
  navy:      "#0B1A2F",
  ink:       "#0B1A2F",
  inkMuted:  "#5E6779",
  danger:    "#B43838",
  dangerSoft:"#FBE3E3",
  green:     "#1E6D29",
  greenSoft: "#E9F1EA",
  surface:   "#FFFFFF",
};

/** What the operator is told after the POST settles, per outcome. */
type Outcome =
  | { kind: "assigned" }
  | { kind: "stale" }
  | { kind: "error"; message: string };

export function AssignSupplierBanner({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const queryEnabled = useQueriesEnabled();
  const { labels } = useOrderDirection();
  const [supplierId, setSupplierId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: apiClient.getSuppliers,
    staleTime: 5 * 60 * 1000,
    enabled: queryEnabled,
    retry: 1,
  });

  const counterparty = labels.counterpartyNoun.toLowerCase();

  async function handleAssign() {
    if (!supplierId || assigning) return;
    setAssigning(true);
    setOutcome(null);

    let settled: Outcome;
    try {
      await apiClient.assignSupplier(order.id, supplierId);
      settled = { kind: "assigned" };
    } catch (err) {
      // 409 = the atomic claim matched no row: the order is no longer `unrouted`,
      // so another operator (or an ingress re-route) already handled it. Telling
      // the operator their click failed would be the opposite of what happened.
      settled = err instanceof ApiHttpError && err.status === 409
        ? { kind: "stale" }
        : { kind: "error", message: messageFor(err, counterparty) };
    }
    setOutcome(settled);
    setAssigning(false);

    // Success and 409 both mean this screen is holding a stale order — one because
    // we just moved it, the other because someone else did — and refetching is what
    // ends the disagreement (the order query's `parsing` poll takes over from there).
    // A rejected supplier (400) left the order exactly as it was, so refetching
    // would only re-render the same banner.
    if (settled.kind !== "error") {
      await queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
    }
  }

  const noSuppliers = !suppliersLoading && suppliers.length === 0;

  return (
    <div
      role="region"
      aria-label={`This order needs a ${counterparty}`}
      className="flex-shrink-0"
      data-testid="order-needs-supplier"
      style={{
        padding: "12px 16px",
        background: T.amberSoft,
        borderBottom: `1px solid ${T.amberLine}`,
      }}
    >
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.amber} strokeWidth="2" aria-hidden style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M12 9v4" strokeLinecap="round" />
            <path d="M12 17h.01" strokeLinecap="round" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0">
            <p className="text-[13px] font-bold" style={{ color: T.amber, margin: 0 }}>
              This order needs a {counterparty}
            </p>
            <p className="text-[12.5px]" style={{ color: T.inkMuted, margin: "3px 0 0", lineHeight: 1.5 }}>
              We couldn&rsquo;t tell which {counterparty} this order is for, so it&rsquo;s waiting here.
              Choose one and we&rsquo;ll read the document again against their item codes.
            </p>
          </div>
        </div>

        {noSuppliers ? (
          <Link
            href="/library/suppliers"
            className="text-[12.5px] font-semibold lg:flex-shrink-0"
            style={{ color: T.green }}
          >
            Add a {counterparty} →
          </Link>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:flex-shrink-0">
            <div className="w-full sm:w-[240px]">
              <SupplierPicker
                suppliers={suppliers}
                value={supplierId}
                onChange={setSupplierId}
                counterpartyNoun={counterparty}
                counterpartyPlural={labels.counterpartyPlural}
                triggerId="assign-supplier"
              />
            </div>
            <button
              type="button"
              onClick={handleAssign}
              disabled={!supplierId || assigning}
              className="text-[13px] font-semibold"
              style={{
                // 40px, matching BillingHeldPanel's action — the shared picker above
                // is 36px because the upload route bar sizes it, but this button is
                // the one an operator taps on a phone.
                minHeight: 40,
                padding: "9px 16px",
                borderRadius: 7,
                border: "none",
                background: !supplierId || assigning ? "#C9CFDA" : T.navy,
                color: "#FFFFFF",
                cursor: !supplierId || assigning ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {assigning ? "Assigning…" : `Assign ${counterparty}`}
            </button>
          </div>
        )}
      </div>

      {outcome && (
        <div
          role="status"
          aria-live="polite"
          className="mt-2.5 text-[12.5px] font-semibold"
          style={{
            padding: "7px 10px",
            borderRadius: 6,
            background: outcome.kind === "error" ? T.dangerSoft : outcome.kind === "stale" ? T.surface : T.greenSoft,
            color: outcome.kind === "error" ? T.danger : outcome.kind === "stale" ? T.ink : T.green,
          }}
        >
          {outcome.kind === "assigned" &&
            `${labels.counterpartyNoun} assigned — reading the document again…`}
          {outcome.kind === "stale" &&
            `This order has already been routed — someone may have assigned a ${counterparty} while this page was open. Refreshing it now.`}
          {outcome.kind === "error" && outcome.message}
        </div>
      )}
    </div>
  );
}

/**
 * The backend's own words where it gave them (ApiHttpError carries the parsed body's
 * `error`, already folded into the message), so a rejected supplier reads as
 * "Supplier not found." rather than a generic failure the operator can't act on.
 */
function messageFor(err: unknown, counterparty: string): string {
  const raw = err instanceof Error ? err.message : "";
  const cleaned = raw.replace(/^assign-supplier failed:\s*/i, "").trim();
  return cleaned || `Couldn't assign that ${counterparty}. Try again in a moment.`;
}

export default AssignSupplierBanner;
