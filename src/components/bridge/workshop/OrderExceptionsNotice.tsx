"use client";

// OrderExceptionsNotice — ORDER-level exceptions, surfaced at the send decision.
//
// THE DEFECT THIS CLOSES. The backend's duplicate-PO detector
// (OrderExceptionService, code `duplicate_po_number`) opens an exception on the
// ORDER, not on a line. Its documented safety property is "no duplicate reaches
// a supplier without having been flagged first — the operator is the control."
// But the review screen's send gate counts only LINE flags
// (`order.lines.filter(l => l.needsReview)`, useOrderReview), and
// `getOrderExceptions` — the endpoint that carries the order-level flag — had
// ZERO consumers. So a clean second copy of a PO (mapping auto-learned, zero
// line issues) rendered a green Send with no warning anywhere on the screen
// where the decision happens. The operator was named as the control and never
// shown the flag.
//
// A WARNING, NOT A GATE. Nothing here feeds `canSend`: a legitimate PO revision
// is the same shape as an accidental re-upload, and only the operator can tell
// them apart — which is exactly why the backend made it a warning-severity
// exception instead of a block. The message rendered is the SERVER's own
// sentence, never a local copy of it, so backend wording changes ship without a
// frontend edit.
//
// THE THREE ANSWERS ARE KEPT SEPARATE, per this repo's standing lesson
// ("unknown renders as success"):
//   • open order-level exceptions  → the amber StatusNotice below;
//   • none                         → nothing (silence IS the all-clear here —
//                                    the green ready bar already speaks);
//   • could not check (query error)→ a quiet muted line saying so. NOT silence:
//                                    silence is the all-clear's spelling, and a
//                                    failed read must never wear it.
//
// Rendered at every width (no breakpoint class), the same convention as the
// problem banner row above it in OrderWorkshop — so the desktop header Send and
// MobileTriage's sticky bar both sit on a screen that carries the flag.

import { useQuery } from "@tanstack/react-query";
import { getOrderExceptions } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { StatusNotice } from "../layout/StatusNotice";
import type { OrderException } from "@/types/procurement";

/**
 * The rows worth interrupting the send decision for: order-scoped (a line-scoped
 * exception already reaches the operator through `needsReview` → the fix queue,
 * and would be double-reported here), and still OPEN.
 *
 * "Open" is read from both fields the two endpoints can carry: the all-orders
 * endpoint sends `state` (open | resolved | ignored — exceptionStateManifest),
 * the per-order endpoint may omit it, in which case `resolvedAt` is the signal.
 * An `ignored` row is a person's explicit dismissal and must stay dismissed.
 */
export function openOrderLevelExceptions(
  rows: OrderException[] | undefined,
): OrderException[] {
  if (!rows) return [];
  return rows.filter(
    (e) => !e.lineId && !e.resolvedAt && (e.state == null || e.state === "open"),
  );
}

export function OrderExceptionsNotice({ orderId }: { orderId: string }) {
  // Same gating as every other query on this screen: mock mode and the live
  // QA-bypass e2e have no Clerk session (see useOrderReview).
  const queryEnabled = useQueriesEnabled();
  const { data, isError, isPending } = useQuery({
    queryKey: ["order-exceptions", orderId],
    queryFn: () => getOrderExceptions(orderId),
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: 1,
  });

  // Loading (and signed-out, which parks the query at pending): say nothing.
  // A warning that appears and then retracts would be worse than a beat of
  // silence — the same rule the source-document pane follows.
  if (isPending) return null;

  if (isError) {
    // The honest third answer. Deliberately NOT the amber notice — we have no
    // duplicate to report — and deliberately not silence, which would claim an
    // all-clear this build did not verify.
    return (
      <div className="flex-shrink-0 px-4 lg:px-6" style={{ paddingTop: 8 }}>
        <p
          data-testid="order-exceptions-check-failed"
          style={{ margin: 0, fontSize: 11.5, color: "var(--ink-muted)" }}
        >
          We couldn&rsquo;t check for duplicates on this order.
        </p>
      </div>
    );
  }

  const open = openOrderLevelExceptions(data);
  if (open.length === 0) return null;

  // Short plain framing only — the substance is the server's own sentence(s).
  // Today the only order-level producer is the duplicate detector; the generic
  // heading exists so a future exception code degrades to honest copy instead
  // of being mislabelled a duplicate.
  const heading = open.every((e) => e.code === "duplicate_po_number")
    ? "Possible duplicate"
    : "Check before sending";

  return (
    <div
      data-testid="order-exceptions-notice"
      className="flex-shrink-0 px-4 lg:px-6"
      style={{ paddingTop: 10, paddingBottom: 4 }}
    >
      <StatusNotice tone="warning">
        <span>
          <strong style={{ fontWeight: 700 }}>{heading}</strong>
          {open.map((e) => (
            <span key={e.id} style={{ display: "block", marginTop: 2, fontWeight: 500 }}>
              {e.message}
            </span>
          ))}
        </span>
      </StatusNotice>
    </div>
  );
}
