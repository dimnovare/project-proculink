"use client";

// Operations Health — operator view of pipeline trouble.
// Tiles summarise problem-state counts from GET /api/ops/health; a dead-letter
// table (GET /api/ops/dead-letter) lists exhausted-retry deliveries with a
// per-row "Requeue delivery" escalation (POST /api/ops/orders/{id}/requeue-delivery).
// Mirrors the Bridge Layer visual language used by the exceptions dashboard.

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOpsHealth,
  getDeadLetterOrders,
  requeueDelivery,
  isApiMockMode,
  type OpsHealth,
  type DeadLetterOrder,
} from "@/lib/api-client";

const NAVY = "#0B1A2F";
const BLUE_DEEP = "#0F4FA8";

// Each tile: which OpsHealth field, label, and which inbox filter it links to.
const TILES: Array<{ key: keyof OpsHealth; label: string; href: string }> = [
  { key: "parsingStuck",       label: "Stuck parsing",     href: "/inbox" },
  { key: "deliveringStuck",    label: "Stuck delivering",  href: "/inbox?status=delivering" },
  { key: "transformFailed",    label: "Transform failed",  href: "/inbox?status=failed" },
  { key: "deliveryFailed",     label: "Delivery failed",   href: "/inbox?status=failed" },
  { key: "deliveryDeadLetter", label: "Dead-letter",       href: "/operations/health" },
  { key: "rejectedBySupplier", label: "Supplier rejected", href: "/inbox?status=failed" },
  { key: "slaBreached",        label: "SLA breached",      href: "/inbox" },
  { key: "openExceptions",     label: "Open exceptions",   href: "/operations/exceptions" },
];

function tone(count: number, key: keyof OpsHealth): { bg: string; fg: string } {
  if (count === 0) return { bg: "#EFF2F7", fg: "#56627A" };
  // Hard-failure states read red; soft/awaiting-review states read amber.
  const red = key === "deliveryDeadLetter" || key === "transformFailed" ||
              key === "deliveryFailed" || key === "rejectedBySupplier" || key === "failed";
  return red ? { bg: "#FBE3E3", fg: "#C53A3A" } : { bg: "#FAEFD6", fg: "#9A6B0B" };
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

export default function OperationsHealthPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerkReady = isLoaded && !!isSignedIn;
  const queryEnabled = isApiMockMode || clerkReady;
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
    mutationFn: (orderId: string) => requeueDelivery(orderId),
    onSuccess: (_res, orderId) => {
      setNotice(`Re-queued delivery for ${orderId.slice(0, 8)}… It will move back to "delivering".`);
      qc.invalidateQueries({ queryKey: ["ops-health"] });
      qc.invalidateQueries({ queryKey: ["ops-dead-letter"] });
    },
    onError: (err: Error) => setNotice(err.message || "Requeue failed."),
  });

  // ── Loading / error gates ──────────────────────────────────────────────────
  if (!queryEnabled || healthQ.isLoading) {
    return <Shell><div style={{ color: "#56627A", fontSize: 14 }}>Loading pipeline health…</div></Shell>;
  }
  if (healthQ.isError || healthQ.data === undefined) {
    return (
      <Shell>
        <div style={{ background: "#FFFFFF", border: "1px solid #FBE3E3", borderRadius: 12, padding: 20, color: "#C53A3A", fontSize: 14 }}>
          Could not load operations health. The API may be unavailable — retry shortly.
        </div>
      </Shell>
    );
  }

  const h = healthQ.data;
  const allClear = h.totalProblemOrders === 0 && h.openExceptions === 0;
  const deadLetters = deadLetterQ.data ?? [];

  return (
    <Shell>
      {/* Worker / pipeline-engine status — a dead Worker stalls the whole pipeline. */}
      <div
        style={{
          marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          background: h.workerHealthy ? "#E2F1E2" : "#FBE3E3",
          border: `1px solid ${h.workerHealthy ? "#BFE3BF" : "#F0B4B4"}`,
          borderRadius: 12, padding: "12px 16px",
          color: h.workerHealthy ? "#1E6D29" : "#B42318", fontSize: 13.5,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: h.workerHealthy ? "#2E8E3A" : "#D92D20" }} />
        <span style={{ fontWeight: 700 }}>{h.workerHealthy ? "Worker online" : "Worker OFFLINE"}</span>
        <span style={{ opacity: 0.9 }}>
          {h.workerHealthy
            ? `${h.activeWorkers} active · last heartbeat ${formatHeartbeat(h.secondsSinceWorkerHeartbeat)}`
            : h.lastWorkerHeartbeatUtc
              ? `No heartbeat in ${formatHeartbeat(h.secondsSinceWorkerHeartbeat)} — new uploads will stall until it recovers.`
              : "No worker has reported in — uploads will stall at “parsing” until a worker starts."}
        </span>
      </div>
      {allClear ? (
        <div style={{ background: "#E2F1E2", border: "1px solid #BFE3BF", borderRadius: 12, padding: "16px 18px", color: "#1E6D29", fontSize: 14, fontWeight: 600 }}>
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
                style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", textDecoration: "none" }}
              >
                <div style={{ fontSize: 26, fontWeight: 700, color: count === 0 ? "#8A93A5" : NAVY, lineHeight: 1.1 }}>
                  {count}
                </div>
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.fg, opacity: count === 0 ? 0.4 : 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#56627A" }}>{label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11.5, color: "#8A93A5" }}>
        Stuck threshold: {h.stuckThresholdMinutes} min · auto-refreshes every 45s
      </div>

      {/* ── Dead-letter queue ──────────────────────────────────────────────── */}
      <section style={{ marginTop: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, color: NAVY, margin: 0 }}>
            Dead-letter queue
          </h2>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#56627A", cursor: "pointer" }}>
            <input type="checkbox" checked={includeFailed} onChange={(e) => setIncludeFailed(e.target.checked)} />
            Include delivery-failed
          </label>
        </div>

        {notice && (
          <div style={{ marginBottom: 12, background: "#EEF3F8", border: "1px solid #D6E3F2", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: BLUE_DEEP }}>
            {notice}
          </div>
        )}

        {deadLetters.length === 0 ? (
          <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12, padding: 24, color: "#56627A", fontSize: 13.5 }}>
            No orders awaiting operator review. {includeFailed ? "" : "Tick “Include delivery-failed” to widen the view."}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#F6F7FA", color: "#56627A", textAlign: "left" }}>
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
                    <tr key={o.orderId} style={{ borderTop: "1px solid #EEF0F4" }}>
                      <td style={td}>
                        <Link href={`/inbox/${o.orderId}`} style={{ color: BLUE_DEEP, fontWeight: 600, textDecoration: "none" }}>
                          {o.poNumber || o.orderId.slice(0, 8)}
                        </Link>
                      </td>
                      <td style={td}>{o.supplierName ?? "—"}</td>
                      <td style={td}><StatusBadge status={o.status} /></td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.deliveryAttempts}</td>
                      <td style={{ ...td, maxWidth: 280, color: "#C53A3A" }}>
                        <span title={o.lastError ?? ""} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {o.lastError ?? "—"}{o.lastResponseCode ? ` (${o.lastResponseCode})` : ""}
                        </span>
                      </td>
                      <td style={{ ...td, color: "#56627A", whiteSpace: "nowrap" }}>{relativeTime(o.lastAttemptAt)}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button
                          onClick={() => requeue.mutate(o.orderId)}
                          disabled={requeue.isPending}
                          style={{
                            fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 7,
                            border: "1px solid #D6E3F2", background: requeue.isPending ? "#EFF2F7" : "#FFFFFF",
                            color: BLUE_DEEP, cursor: requeue.isPending ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                          }}
                        >
                          {requeue.isPending ? "Requeuing…" : "Requeue delivery"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {deadLetters.map((o) => (
                <DeadLetterCard
                  key={o.orderId}
                  o={o}
                  busy={requeue.isPending}
                  onRequeue={() => requeue.mutate(o.orderId)}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </Shell>
  );
}

// ── Layout shell ──────────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: "100%", minHeight: 0, overflowY: "auto", background: "#F6F7FA" }}>
      {/* Page gutters: roomy on desktop, tighter on phones (~16px) — matches ops/settings pages */}
      <style>{`
        .ops-health-shell { padding: 26px 34px 64px; }
        @media (max-width: 640px) {
          .ops-health-shell { padding: 20px 16px 56px; }
        }
      `}</style>
      <div className="ops-health-shell" style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ marginBottom: 18 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.1, margin: 0, color: NAVY }}>
            Operations health
          </h1>
          <div style={{ color: "#56627A", fontSize: 13, marginTop: 5 }}>
            Pipeline trouble at a glance — stuck, failed, and dead-lettered orders.
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

// Per-order card for phones — mirrors the desktop columns as stacked rows with
// a full-width Requeue button so the action is never clipped.
function DeadLetterCard({
  o, busy, onRequeue,
}: {
  o: DeadLetterOrder;
  busy: boolean;
  onRequeue: () => void;
}) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Link href={`/inbox/${o.orderId}`} style={{ color: BLUE_DEEP, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
          {o.poNumber || o.orderId.slice(0, 8)}
        </Link>
        <StatusBadge status={o.status} />
      </div>
      <div style={{ marginTop: 8, fontSize: 12.5, color: "#56627A" }}>
        {o.supplierName ?? "—"} · {o.deliveryAttempts} attempt{o.deliveryAttempts === 1 ? "" : "s"} · {relativeTime(o.lastAttemptAt)}
      </div>
      {(o.lastError || o.lastResponseCode) && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "#C53A3A", wordBreak: "break-word" }}>
          {o.lastError ?? "—"}{o.lastResponseCode ? ` (${o.lastResponseCode})` : ""}
        </div>
      )}
      <button
        onClick={onRequeue}
        disabled={busy}
        style={{
          marginTop: 12, width: "100%", minHeight: 40, fontSize: 13, fontWeight: 600, borderRadius: 7,
          border: "1px solid #D6E3F2", background: busy ? "#EFF2F7" : "#FFFFFF",
          color: BLUE_DEEP, cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Requeuing…" : "Requeue delivery"}
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const red = status === "delivery_dead_letter" || status === "delivery_failed" || status === "rejected_by_supplier";
  const spec = red
    ? { bg: "#FBE3E3", fg: "#C53A3A" }
    : { bg: "#FAEFD6", fg: "#9A6B0B" };
  return (
    <span
      className="inline-flex items-center rounded-[4px] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.03em]"
      style={{ background: spec.bg, color: spec.fg }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

const th: React.CSSProperties = { padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" };
const td: React.CSSProperties = { padding: "10px 14px", color: NAVY, verticalAlign: "middle" };
