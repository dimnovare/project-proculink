"use client";

// Operations Health — operator view of pipeline trouble.
// Tiles summarise problem-state counts from GET /api/ops/health; a dead-letter
// table (GET /api/ops/dead-letter) lists exhausted-retry deliveries with a
// per-row "Requeue delivery" escalation (POST /api/ops/orders/{id}/requeue-delivery).
// Mirrors the Bridge Layer visual language used by the exceptions dashboard.

import Link from "next/link";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOpsHealth,
  getDeadLetterOrders,
  requeueDelivery,
  type OpsHealth,
  type DeadLetterOrder,
} from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { opAllowsStatus } from "@/lib/orderStatusManifest";
import { isAllClear, isQueueClear } from "./opsHealthState";
import { TILES } from "./healthTiles";
import { DeliveryPausedCard } from "./DeliveryPausedCard";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { Button } from "@/components/bridge/DSPrimitives";
import { UnifiedStatusBadge } from "@/components/bridge/UnifiedStatusBadge";
import {
  TV2,
  tv2CardStyle,
  tv2HeaderCell,
  tv2BodyCell,
  tv2RowDivider,
  tv2Num,
  tv2DotColor,
} from "@/components/bridge/layout/listTableV2";
import { serverReasonOrNull } from "@/lib/serverText";

/**
 * The dead-letter row's `lastError` as a person can read it, or nothing.
 *
 * This field is whatever the supplier's endpoint returned, captured deliberately as evidence — and
 * on 2026-08-06 that was a 404 HTML error page, shown to an operator as the reason their order
 * failed. The row already names the order, the supplier, the status and the response code, so a
 * body that cleans to nothing legible is dropped rather than replaced with filler.
 * The untouched value stays on the order passport for whoever needs exactly what came back.
 */
function readableLastError(lastError: string | null | undefined): string | null {
  return serverReasonOrNull(lastError);
}

function tone(count: number, key: keyof OpsHealth): { bg: string; fg: string } {
  if (count === 0) return { bg: "var(--surface-2)", fg: "var(--ink-muted)" };
  // Hard-failure states read red; soft/awaiting-review states read amber.
  const red = key === "deliveryDeadLetter" || key === "transformFailed" ||
              key === "deliveryFailed" || key === "rejectedBySupplier" || key === "failed";
  return red ? { bg: "var(--danger-soft)", fg: "var(--danger)" } : { bg: "var(--amber-soft)", fg: "var(--amber-text)" };
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

function formatHeartbeat(s: number | null): string {
  if (s == null) return "unknown";
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// STATUS_META now carries `rejected_by_supplier` itself (UnifiedStatusBadge.tsx),
// with the same label and the same danger tone as `rejected` — so this mapping is
// a no-op that survives only because its premise ("STATUS_META does not include
// it") stopped being true and nothing re-read the comment. Kept as an identity
// pass-through rather than deleted mid-packet: it is called from two render sites
// and removing it is a separate, mechanical change. src/test/statusVocabulary.test.ts
// asserts both keys resolve to the same label, so the two can no longer diverge.
function normalizeDeadLetterStatus(status: string): string {
  return status;
}

// Does POST /api/ops/orders/{id}/requeue-delivery admit this row?
//
// This was a DENY-LIST of two literals — everything that was not
// `rejected_by_supplier` or `rejected` got the button — and its comment called
// that "conservative". It is the least conservative option available: an
// unrecognised status is precisely the row the frontend understands least, and
// the deny-list handed it the escalation control. The endpoint's admission guard
// is `OrderStatusMachine.RequeueableFrom` = { delivery_dead_letter,
// delivery_failed } (OpsController.cs:155), so every other status — transform_failed,
// delivery_unconfirmed, failed, delivered, anything a future backend adds — rendered
// a "Start sending again" button the API answers 400 to. That is the same defect the
// order screen's dead-letter panel was rebuilt to remove.
//
// Now an ALLOW-LIST derived from the mirror, so it cannot drift from the guard
// independently: unknown status → false → the row gets the open-order fallback
// below instead of a button that cannot work.
//
// No `.toLowerCase()`: both producers of DeadLetterOrder.status (real and mock,
// src/lib/api/operations.ts) hand back DeadLetterOrderDto.Status verbatim, and the
// backend writes OrderStatusConstants, which are lowercase snake_case. The same
// `o.status` already reaches tv2DotColor and UnifiedStatusBadge un-normalised at
// both call sites — a mixed-case value would already be rendering the wrong dot and
// the wrong badge — so normalising here would only have hidden that from this one
// control while the rest of the row lied.
function canRedeliver(status: string): boolean {
  return opAllowsStatus("requeueDelivery", status);
}

export default function OperationsHealthPage() {
  const queryEnabled = useQueriesEnabled();
  const qc = useQueryClient();

  const [includeFailed, setIncludeFailed] = useState(true);
  // ONE notice state carrying its own severity. It used to be a bare
  // `string | null` rendered in a hard-coded blue/informational banner, so a FAILED
  // requeue — the case an operator most needs to notice — was painted in the same
  // success-adjacent chrome as "we're sending it again". A second useState would
  // have worked equally well; a tone field is the smaller change in this file
  // because there is exactly one render site to thread it through.
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const healthQ = useQuery<OpsHealth>({
    queryKey: ["ops-health"],
    queryFn: getOpsHealth,
    enabled: queryEnabled,
    refetchInterval: 45_000,
    staleTime: 30_000,
    retry: 1,
  });

  const deadLetterQ = useQuery<DeadLetterOrder[]>({
    queryKey: ["ops-dead-letter", includeFailed],
    queryFn: () => getDeadLetterOrders(includeFailed),
    enabled: queryEnabled,
    refetchInterval: 45_000,
    staleTime: 30_000,
    retry: 1,
  });

  const requeue = useMutation({
    // Takes the whole row so the success notice can name the order by its PO
    // number (the operator-facing identifier) instead of a truncated internal
    // order id, which read as gibberish (e.g. "mock-dl-…") in the notice.
    mutationFn: (order: DeadLetterOrder) => requeueDelivery(order.orderId),
    onSuccess: (_res, order) => {
      setNotice({ tone: "info", text: `Trying to send ${order.poNumber} again. It will move back to "sending".` });
      qc.invalidateQueries({ queryKey: ["ops-health"] });
      qc.invalidateQueries({ queryKey: ["ops-dead-letter"] });
    },
    // The server's own sentence is rendered VERBATIM — it is the only text that
    // knows why this particular send was refused, and paraphrasing it here would
    // replace a specific reason with a generic one. Only the client-authored
    // fallback (for an error carrying no message at all) is ours to write, and it
    // now names the order, says what did not happen, and says it can be tried again
    // instead of the bare engineering fragment "Requeue failed."
    onError: (err: Error, order) => setNotice({
      tone: "error",
      text: err.message || `We couldn't start sending ${order.poNumber} again. You can try again.`,
    }),
  });

  // ── Loading / error gates ──────────────────────────────────────────────────
  if (!queryEnabled || healthQ.isLoading) {
    return (
      <PageShell variant="wide">
        <PageHeader titleHidden title="System status" />
        <div style={{ color: "var(--ink-muted)", fontSize: 14 }}>Loading pipeline health…</div>
      </PageShell>
    );
  }
  if (healthQ.isError || healthQ.data === undefined) {
    return (
      <PageShell variant="wide">
        <PageHeader titleHidden title="System status" />
        <Card edge="none">
          {/* This replaces the WHOLE dashboard, so it was the only thing on screen —
              and it shipped with no control while its own last four words ("retry
              shortly") instructed a retry the page did not offer, leaving a full
              browser reload as the only way out. `healthQ.refetch` was in scope the
              entire time. Same shape as the sibling ops error state
              (operations/exceptions/page.tsx:255): headline, plain-language cause,
              secondary Retry. The sentence no longer asks the operator to do
              something the button now does, and no longer says "API". */}
          <div role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
            <div style={{ color: "var(--danger)", fontSize: 15, fontWeight: 600 }}>
              We couldn&apos;t load system status
            </div>
            <div style={{ color: "var(--ink-muted)", fontSize: 13.5, maxWidth: 460 }}>
              Your orders are safe and nothing has stopped because of this — we just can&apos;t show
              you the current picture. This is usually brief.
            </div>
            <Button variant="secondary" size="sm" onClick={() => healthQ.refetch()}>
              <RefreshCw size={13} aria-hidden />
              Try again
            </Button>
          </div>
        </Card>
      </PageShell>
    );
  }

  const h = healthQ.data;
  // Truthfulness gate: NEVER show the green "All clear" banner while any hard
  // failure, dead-letter, stuck, SLA-breach, or billing-paused count is non-zero.
  // Lives in opsHealthState.ts so the gate can be tested directly — see the
  // reasoning there for why it reads the individual counts and not just the
  // backend's aggregate.
  const allClear = isAllClear(h);
  // The same eleven counts WITHOUT the Worker check — so a dead Worker over an
  // empty queue can render its own honest banner instead of a wall of zero tiles.
  const queueClear = isQueueClear(h);
  const deliveryHeld = h.deliveryHeld ?? 0;
  // `?? []` is kept ONLY as a render convenience for the rows below. It is no longer
  // load-bearing for the empty state: both cases it used to swallow — the fetch failed,
  // the fetch has not answered yet — are now branched on explicitly at the render site,
  // ahead of "none". A default that turns "unknown" into "zero" is safe only when
  // something upstream has already ruled unknown out.
  const deadLetters = deadLetterQ.data ?? [];

  return (
    <PageShell variant="wide">
      {/* titleHidden: the topbar already names this page (primary tab
          "Operations" + hub tab "System health"); "Operations health" was a
          mashup of the two. sr-only h1 kept; the descriptive sub is dropped. */}
      <PageHeader titleHidden title="System status" />

      {/* Worker / pipeline-engine status — a dead Worker stalls the whole pipeline. */}
      <div
        style={{
          marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          background: h.workerHealthy ? "var(--brand-green-soft)" : "var(--danger-soft)",
          border: `1px solid ${h.workerHealthy ? "#BFE3BF" : "var(--danger-border)"}`,
          borderRadius: "var(--radius-md)", padding: "12px 16px",
          color: h.workerHealthy ? "var(--brand-green-deep)" : "var(--danger)", fontSize: 13.5,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: h.workerHealthy ? "var(--brand-green)" : "var(--danger)" }} />
        <span style={{ fontWeight: 700 }}>{h.workerHealthy ? "Order processing is running" : "Order processing is paused"}</span>
        <span style={{ opacity: 0.9 }}>
          {h.workerHealthy
            ? `Last checked ${formatHeartbeat(h.secondsSinceWorkerHeartbeat)}`
            : h.lastWorkerHeartbeatUtc
              ? `New uploads may wait until it recovers. (last checked ${formatHeartbeat(h.secondsSinceWorkerHeartbeat)})`
              : "New uploads may wait until processing restarts. (no recent activity)"}
        </span>
      </div>
      {/* Manual-review backlog — INFORMATIONAL, not a system fault. Orders in
          pending_review are waiting on an operator decision, not stuck/failed, so
          this is shown as neutral info (blue, not red) and is NOT part of
          totalProblemOrders / the all-clear check. The BE `pendingReview` field
          may not be deployed yet → default to 0. Only render when there is
          actually a backlog: a "0 Awaiting your review" card stacked above the
          green "All clear" banner reads as contradictory noise. */}
      {(h.pendingReview ?? 0) > 0 && (
        <Link
          href="/inbox?status=pending_review"
          className="mb-4 flex items-center gap-3 rounded-[10px] px-4 py-3 transition-shadow hover:shadow-md"
          style={{ background: "var(--brand-blue-soft)", border: "1px solid #D6E3F2", textDecoration: "none" }}
        >
          <span style={{ fontSize: 26, fontWeight: 700, color: "var(--brand-blue-deep)", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
            {(h.pendingReview ?? 0).toLocaleString()}
          </span>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--brand-blue-deep)" }}>Awaiting your review</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>Orders paused for a person to check — not a system problem.</span>
          </span>
        </Link>
      )}

      {/* Deliveries paused on a billing hold — NOT a fault, so it sits outside the
          problem-tile grid and reads amber, never red. It does gate the green banner
          above: the PO has not gone out, so "All clear" would be false. Renders only
          when non-zero, like the review-backlog card. */}
      {deliveryHeld > 0 && <DeliveryPausedCard count={deliveryHeld} />}

      {allClear ? (
        <div style={{ background: "var(--brand-green-soft)", border: "1px solid #BFE3BF", borderRadius: "var(--radius-md)", padding: "16px 18px", color: "var(--brand-green-deep)", fontSize: 14, fontWeight: 600 }}>
          ✓ All clear — no orders in a problem state and no open issues.
        </div>
      ) : queueClear && !h.workerHealthy ? (
        /* D7 — the queue is empty but the pipeline is down. This used to render the
           green "All clear" banner directly under the red "processing is paused"
           band: two contradictory claims, one screen. Amber, and it names the
           actual state. */
        <div role="status" style={{ background: "var(--amber-soft)", border: "1px solid #F0D39A", borderRadius: "var(--radius-md)", padding: "16px 18px", color: "var(--amber-text)", fontSize: 14, fontWeight: 600 }}>
          No orders are in a problem state — but order processing is paused, so new work is waiting.
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))" }}
        >
          {TILES.map(({ key, label, href, helper }) => {
            // `?? 0`: every TILES key is a required numeric field except
            // deliveryUnconfirmed, which ships separately (PR #27) and is optional for
            // forward/backward compat — an older API omitting it must read as 0, not
            // as a literal "undefined" tile.
            const count = (h[key] as number | undefined) ?? 0;
            const t = tone(count, key);
            return (
              <Link
                key={key}
                href={href}
                className="rounded-[10px] px-4 py-3 transition-shadow hover:shadow-md"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", textDecoration: "none" }}
              >
                <div style={{ fontSize: 26, fontWeight: 700, color: count === 0 ? "var(--ink-faint)" : "var(--ink)", lineHeight: 1.1 }}>
                  {count}
                </div>
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.fg, opacity: count === 0 ? 0.4 : 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-muted)" }}>{label}</span>
                </div>
                {helper && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.4 }}>{helper}</div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--ink-faint)" }}>
        Flagged as stuck after {h.stuckThresholdMinutes} min · auto-refreshes every 45s
      </div>

      {/* ── Dead-letter queue ──────────────────────────────────────────────── */}
      <section style={{ marginTop: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, color: "var(--ink)", margin: 0 }}>
            Orders we couldn&apos;t deliver
          </h2>
          {/* Tap target ≥44px: the label supplies vertical py-2.5 padding and the
              input renders at h-5 w-5 (20px) inside it, so the whole strip is
              finger-tappable on a phone while the visual stays compact. */}
          <label className="py-2.5" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--ink-muted)", cursor: "pointer", minHeight: 44 }}>
            <input type="checkbox" className="h-5 w-5" style={{ cursor: "pointer" }} checked={includeFailed} onChange={(e) => setIncludeFailed(e.target.checked)} />
            Also show orders we&rsquo;re still retrying
          </label>
        </div>

        {/* Severity drives BOTH the colour and the ARIA role, the way
            OrderProblemPanel does it: a failure is role="alert" (assertive — a
            screen-reader user is interrupted, because the send did not happen and
            nothing else on screen says so), an informational notice is
            role="status" + aria-live="polite". Before this, every outcome shared one
            blue banner and one silent div, so a refused requeue was indistinguishable
            from a successful one by colour, and announced by neither. */}
        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live={notice.tone === "error" ? undefined : "polite"}
            style={{
              marginBottom: 12,
              background: notice.tone === "error" ? "var(--danger-soft)" : "var(--brand-blue-soft)",
              border: `1px solid ${notice.tone === "error" ? "var(--danger-border)" : "#D6E3F2"}`,
              borderRadius: "var(--radius-md)", padding: "9px 12px", fontSize: 12.5,
              color: notice.tone === "error" ? "var(--danger)" : "var(--brand-blue-deep)",
            }}
          >
            {notice.text}
          </div>
        )}

        {deadLetterQ.isError ? (
          /* THE PAGE MUST NOT SAY "NONE" WHEN IT MEANS "I DON'T KNOW".
             `deadLetters` is `deadLetterQ.data ?? []`, and this branch used to test
             only `deadLetters.length === 0` — so a FAILED fetch fell through the `??`
             into an empty array and rendered "No orders awaiting operator review."
             on the one page an operator opens specifically to find stuck orders. Not
             merely a missing action: the screen asserted the opposite of the truth,
             and the more orders were stuck the more confidently it said zero.
             Checked BEFORE the empty state so "none" can only ever mean a successful
             fetch that really returned nothing. */
          <Card edge="none">
            <div role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
              <div style={{ color: "var(--danger)", fontSize: 14, fontWeight: 600 }}>
                We couldn&apos;t load this list
              </div>
              <div style={{ color: "var(--ink-muted)", fontSize: 13.5, maxWidth: 460 }}>
                That is not the same as &ldquo;none&rdquo; — there may be orders waiting here.
                Nothing has been lost and no order has changed.
              </div>
              <Button variant="secondary" size="sm" onClick={() => deadLetterQ.refetch()}>
                <RefreshCw size={13} aria-hidden />
                Try again
              </Button>
            </div>
          </Card>
        ) : deadLetterQ.isLoading ? (
          /* Same rule, milder case: the first load also arrives as `undefined` and
             also fell through the `??`, so the page flashed a confident "no orders
             awaiting operator review" before it had asked. The health query is gated
             above, so by here `queryEnabled` is true and isLoading means exactly
             "first answer still outstanding". */
          <Card edge="none">
            <div style={{ color: "var(--ink-muted)", fontSize: 13.5 }}>Checking for undelivered orders…</div>
          </Card>
        ) : deadLetters.length === 0 ? (
          <Card edge="none">
            <div style={{ color: "var(--ink-muted)", fontSize: 13.5 }}>
              {/* The pointer named a control that does not exist: the checkbox above
                  reads "Also show orders we're still retrying", not "Include
                  delivery-failed" — the old engine-side label, left behind when the
                  control was rewritten in plain language. Quoted to match it. */}
              No orders awaiting operator review. {includeFailed ? "" : "Tick “Also show orders we’re still retrying” to widen the view."}
            </div>
          </Card>
        ) : (
          <>
            {/* Desktop table — unified full-bleed listTableV2 treatment
                (tinted header band, 44px rows, leading status dots, border-faint
                dividers, tabular figures). */}
            <div className="hidden md:block" style={{ ...tv2CardStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={tv2HeaderCell("left", true)}>Order</th>
                    <th style={tv2HeaderCell()}>Supplier</th>
                    <th style={tv2HeaderCell()}>Status</th>
                    <th style={tv2HeaderCell("right")}>Attempts</th>
                    <th style={tv2HeaderCell()}>Last error</th>
                    <th style={tv2HeaderCell()}>Last attempt</th>
                    <th style={tv2HeaderCell("right")}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.map((o, i) => (
                    <tr key={o.orderId} style={{ borderTop: i === 0 ? "none" : tv2RowDivider }}>
                      <td style={tv2BodyCell("left", true)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span
                            aria-hidden
                            style={{ width: 7, height: 7, borderRadius: "50%", background: tv2DotColor(normalizeDeadLetterStatus(o.status)), flexShrink: 0 }}
                          />
                          <Link href={`/inbox/${o.orderId}`} className="font-mono tabular-nums inline-flex items-center py-2.5" style={{ color: "var(--brand-blue-deep)", fontWeight: 600, fontSize: 12, textDecoration: "none" }}>
                            {o.poNumber || o.orderId.slice(0, 8)}
                          </Link>
                        </div>
                      </td>
                      <td style={{ ...tv2BodyCell(), color: TV2.ink }}>{o.supplierName ?? "—"}</td>
                      <td style={tv2BodyCell()}><UnifiedStatusBadge status={normalizeDeadLetterStatus(o.status)} /></td>
                      <td style={{ ...tv2BodyCell("right"), ...tv2Num, color: TV2.ink }}>{o.deliveryAttempts}</td>
                      <td style={{ ...tv2BodyCell(), maxWidth: 280, color: "var(--danger)" }}>
                        {/* The tooltip carries the same cleaned text as the cell: it is prose the
                            operator reads, so it is not a way for markup to get back on screen. */}
                        <span title={readableLastError(o.lastError) ?? ""} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {readableLastError(o.lastError) ?? "—"}{o.lastResponseCode ? ` (${o.lastResponseCode})` : ""}
                        </span>
                      </td>
                      <td style={{ ...tv2BodyCell(), color: TV2.inkMuted }}>{relativeTime(o.lastAttemptAt)}</td>
                      <td style={tv2BodyCell("right")}>
                        {canRedeliver(o.status) ? (
                          <Button
                            variant="blue"
                            size="sm"
                            onClick={() => requeue.mutate(o)}
                            /* Gate on THIS row's id so requeuing one order doesn't
                               disable + spin every row's button (shared isPending). */
                            disabled={requeue.isPending && requeue.variables?.orderId === o.orderId}
                          >
                            {requeue.isPending && requeue.variables?.orderId === o.orderId ? "Queued…" : "Start sending again"}
                          </Button>
                        ) : (
                          /* The requeue endpoint would refuse this status, so no button is
                             offered — but the row still owes the operator a next step, and
                             this link is it: /inbox/{id} is the order workshop, which reads
                             the status and offers whatever IS legal from there.

                             The label used to read "Open to fix & resend". That was written
                             when this branch caught supplier rejections ONLY; the allow-list
                             above now routes transform_failed, delivery_unconfirmed, failed
                             and any unrecognised status here too, and "resend" is a promise
                             this screen cannot keep for them — `failed` in particular exits
                             via a NEW order row, never a resend of this one. The link now
                             says where it goes and nothing more. */
                          <Link
                            href={`/inbox/${o.orderId}`}
                            style={{ fontSize: 12.5, fontWeight: 600, color: "var(--brand-blue-deep)", textDecoration: "none" }}
                          >
                            Open order
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list — MobileListRow per dead-letter order.
                Layout via Tailwind (flex/flex-col/gap-3) NOT inline style: an inline
                `display:flex` would override `md:hidden`'s `display:none` at md+ (inline
                styles beat stylesheet media-query rules), rendering both the cards AND
                the desktop table on desktop. gap-3 = 12px, matching the prior value. */}
            <div className="flex flex-col gap-3 md:hidden">
              {deadLetters.map((o) => (
                <MobileListRow key={o.orderId}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <Link href={`/inbox/${o.orderId}`} className="inline-flex items-center py-2.5 -my-2.5" style={{ color: "var(--brand-blue-deep)", fontWeight: 600, fontSize: 14, textDecoration: "none", minHeight: 44 }}>
                      {o.poNumber || o.orderId.slice(0, 8)}
                    </Link>
                    <UnifiedStatusBadge status={normalizeDeadLetterStatus(o.status)} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-muted)" }}>
                    {o.supplierName ?? "—"} · {o.deliveryAttempts} attempt{o.deliveryAttempts === 1 ? "" : "s"} · {relativeTime(o.lastAttemptAt)}
                  </div>
                  {(readableLastError(o.lastError) || o.lastResponseCode) && (
                    <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--danger)", wordBreak: "break-word" }}>
                      {readableLastError(o.lastError) ?? "—"}{o.lastResponseCode ? ` (${o.lastResponseCode})` : ""}
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    {canRedeliver(o.status) ? (
                      <Button
                        variant="blue"
                        size="md"
                        onClick={() => requeue.mutate(o)}
                        /* Per-row guard — see desktop table above. */
                        disabled={requeue.isPending && requeue.variables?.orderId === o.orderId}
                        style={{ width: "100%" }}
                      >
                        {requeue.isPending && requeue.variables?.orderId === o.orderId ? "Queued…" : "Start sending again"}
                      </Button>
                    ) : (
                      /* Requeue is not legal from this status — see desktop table above
                         for why the fallback is a route to the order and not dead text.
                         minHeight 44 so the one control this row DOES offer is still a
                         finger-sized tap target on a phone; the button branch gets that
                         from size="md" + full width, the link had only 8px of padding. */
                      <Link
                        href={`/inbox/${o.orderId}`}
                        className="flex items-center justify-center"
                        style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-blue-deep)", textDecoration: "none", padding: "8px 0", minHeight: 44 }}
                      >
                        Open order
                      </Link>
                    )}
                  </div>
                </MobileListRow>
              ))}
            </div>
          </>
        )}
      </section>
    </PageShell>
  );
}
