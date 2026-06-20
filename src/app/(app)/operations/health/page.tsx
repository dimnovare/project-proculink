"use client";

// Operations Health — operator view of pipeline trouble.
// Tiles summarise problem-state counts from GET /api/ops/health; a dead-letter
// table (GET /api/ops/dead-letter) lists exhausted-retry deliveries with a
// per-row "Requeue delivery" escalation (POST /api/ops/orders/{id}/requeue-delivery).
// Mirrors the Bridge Layer visual language used by the exceptions dashboard.

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOpsHealth,
  getDeadLetterOrders,
  requeueDelivery,
  type OpsHealth,
  type DeadLetterOrder,
} from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { Button } from "@/components/bridge/DSPrimitives";
import { UnifiedStatusBadge } from "@/components/bridge/UnifiedStatusBadge";

// Each tile: which OpsHealth field, label, and which inbox filter it links to.
const TILES: Array<{ key: keyof OpsHealth; label: string; href: string }> = [
  { key: "parsingStuck",       label: "Stuck reading the file", href: "/inbox" },
  { key: "deliveringStuck",    label: "Stuck delivering",  href: "/inbox?status=delivering" },
  { key: "transformFailed",    label: "Transform failed",  href: "/inbox?status=failed" },
  { key: "deliveryFailed",     label: "Delivery failed",   href: "/inbox?status=failed" },
  { key: "deliveryDeadLetter", label: "Out of retries",    href: "/inbox?status=failed" },
  { key: "rejectedBySupplier", label: "Rejected by supplier", href: "/inbox?status=failed" },
  { key: "slaBreached",        label: "Overdue",           href: "/inbox" },
  { key: "openExceptions",     label: "Open exceptions",   href: "/operations/exceptions" },
];

function tone(count: number, key: keyof OpsHealth): { bg: string; fg: string } {
  if (count === 0) return { bg: "var(--surface-2)", fg: "var(--ink-muted)" };
  // Hard-failure states read red; soft/awaiting-review states read amber.
  const red = key === "deliveryDeadLetter" || key === "transformFailed" ||
              key === "deliveryFailed" || key === "rejectedBySupplier" || key === "failed";
  return red ? { bg: "var(--danger-soft)", fg: "var(--danger)" } : { bg: "var(--amber-soft)", fg: "var(--amber)" };
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

// UnifiedStatusBadge does not include `rejected_by_supplier` in its STATUS_META,
// so that key falls through to neutral tone. Map it to `rejected` (danger) to
// preserve the HEAD behavior where supplier-rejected orders read as red.
function normalizeDeadLetterStatus(status: string): string {
  if (status === "rejected_by_supplier") return "rejected";
  return status;
}

export default function OperationsHealthPage() {
  const queryEnabled = useQueriesEnabled();
  const qc = useQueryClient();

  const [includeFailed, setIncludeFailed] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

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
      setNotice(`Trying to send ${order.poNumber} again. It will move back to "sending".`);
      qc.invalidateQueries({ queryKey: ["ops-health"] });
      qc.invalidateQueries({ queryKey: ["ops-dead-letter"] });
    },
    onError: (err: Error) => setNotice(err.message || "Requeue failed."),
  });

  // ── Loading / error gates ──────────────────────────────────────────────────
  if (!queryEnabled || healthQ.isLoading) {
    return (
      <PageShell variant="wide">
        <PageHeader title="Operations health" sub="Orders that are stuck, failed, or couldn't be delivered, at a glance." />
        <div style={{ color: "var(--ink-muted)", fontSize: 14 }}>Loading pipeline health…</div>
      </PageShell>
    );
  }
  if (healthQ.isError || healthQ.data === undefined) {
    return (
      <PageShell variant="wide">
        <PageHeader title="Operations health" sub="Orders that are stuck, failed, or couldn't be delivered, at a glance." />
        <Card edge="none">
          <div style={{ color: "var(--danger)", fontSize: 14 }}>
            Could not load operations health. The API may be unavailable — retry shortly.
          </div>
        </Card>
      </PageShell>
    );
  }

  const h = healthQ.data;
  const allClear = h.totalProblemOrders === 0 && h.openExceptions === 0;
  const deadLetters = deadLetterQ.data ?? [];

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Operations health"
        sub="Orders that are stuck, failed, or couldn't be delivered, at a glance."
      />

      {/* Worker / pipeline-engine status — a dead Worker stalls the whole pipeline. */}
      <div
        style={{
          marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          background: h.workerHealthy ? "var(--brand-green-soft)" : "var(--danger-soft)",
          border: `1px solid ${h.workerHealthy ? "#BFE3BF" : "#F0B4B4"}`,
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
      {allClear ? (
        <div style={{ background: "var(--brand-green-soft)", border: "1px solid #BFE3BF", borderRadius: "var(--radius-md)", padding: "16px 18px", color: "var(--brand-green-deep)", fontSize: 14, fontWeight: 600 }}>
          ✓ All clear — no orders in a problem state and no open exceptions.
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))" }}
        >
          {TILES.map(({ key, label, href }) => {
            const count = h[key] as number; // TILES keys are all numeric count fields
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
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--ink-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={includeFailed} onChange={(e) => setIncludeFailed(e.target.checked)} />
            Include delivery-failed
          </label>
        </div>

        {notice && (
          <div style={{ marginBottom: 12, background: "var(--brand-blue-soft)", border: "1px solid #D6E3F2", borderRadius: "var(--radius-md)", padding: "9px 12px", fontSize: 12.5, color: "var(--brand-blue-deep)" }}>
            {notice}
          </div>
        )}

        {deadLetters.length === 0 ? (
          <Card edge="none">
            <div style={{ color: "var(--ink-muted)", fontSize: 13.5 }}>
              No orders awaiting operator review. {includeFailed ? "" : "Tick 'Include delivery-failed' to widen the view."}
            </div>
          </Card>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--bg)", color: "var(--ink-muted)", textAlign: "left" }}>
                    <th style={th}>Order</th>
                    <th style={th}>Supplier</th>
                    <th style={th}>Status</th>
                    <th style={{ ...th, textAlign: "right" }}>Attempts</th>
                    <th style={th}>Last error</th>
                    <th style={th}>Last attempt</th>
                    <th style={{ ...th, textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.map((o) => (
                    <tr key={o.orderId} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={td}>
                        <Link href={`/inbox/${o.orderId}`} style={{ color: "var(--brand-blue-deep)", fontWeight: 600, textDecoration: "none" }}>
                          {o.poNumber || o.orderId.slice(0, 8)}
                        </Link>
                      </td>
                      <td style={td}>{o.supplierName ?? "—"}</td>
                      <td style={td}><UnifiedStatusBadge status={normalizeDeadLetterStatus(o.status)} /></td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.deliveryAttempts}</td>
                      <td style={{ ...td, maxWidth: 280, color: "var(--danger)" }}>
                        <span title={o.lastError ?? ""} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {o.lastError ?? "—"}{o.lastResponseCode ? ` (${o.lastResponseCode})` : ""}
                        </span>
                      </td>
                      <td style={{ ...td, color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{relativeTime(o.lastAttemptAt)}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <Button
                          variant="blue"
                          size="sm"
                          onClick={() => requeue.mutate(o)}
                          disabled={requeue.isPending}
                        >
                          {requeue.isPending ? "Sending…" : "Try sending again"}
                        </Button>
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
                    <Link href={`/inbox/${o.orderId}`} style={{ color: "var(--brand-blue-deep)", fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
                      {o.poNumber || o.orderId.slice(0, 8)}
                    </Link>
                    <UnifiedStatusBadge status={normalizeDeadLetterStatus(o.status)} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-muted)" }}>
                    {o.supplierName ?? "—"} · {o.deliveryAttempts} attempt{o.deliveryAttempts === 1 ? "" : "s"} · {relativeTime(o.lastAttemptAt)}
                  </div>
                  {(o.lastError || o.lastResponseCode) && (
                    <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--danger)", wordBreak: "break-word" }}>
                      {o.lastError ?? "—"}{o.lastResponseCode ? ` (${o.lastResponseCode})` : ""}
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <Button
                      variant="blue"
                      size="md"
                      onClick={() => requeue.mutate(o)}
                      disabled={requeue.isPending}
                      style={{ width: "100%" }}
                    >
                      {requeue.isPending ? "Sending…" : "Try sending again"}
                    </Button>
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

const th: React.CSSProperties = { padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" };
const td: React.CSSProperties = { padding: "10px 14px", color: "var(--ink)", verticalAlign: "middle" };
