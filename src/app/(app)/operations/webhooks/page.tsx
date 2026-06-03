"use client";

// §5.10 Webhooks — two-column split matching canonical WebhooksScreen
import { EmptyState } from "@/components/bridge/EmptyState";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getIntegrations,
  createIntegration,
  toggleIntegration,
  deleteIntegration,
  isApiMockMode,
  type IntegrationSubscription,
} from "@/lib/api-client";

// Buyer-blue is the primary accent on this screen (sampled from the design render:
// header button, modal CTA, modal icon-chip + info banner, and the order column in the
// deliveries table all use #1E66C9). Green stays reserved for healthy/2xx status only.
// There is no --buyer-blue CSS token, so these are intentional literals.
const BLUE = "#1E66C9";
const BLUE_DEEP = "#164689";
const BLUE_SOFT = "#E3EDFB";

// ── Types ─────────────────────────────────────────────────────────────────────

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  status: "healthy" | "failing";
  lastDelivery: string;
};

// Canonical shape from data-library.jsx WEBHOOK_DELIVERIES
type DeliveryRow = {
  time: string;
  event: string;
  po: string;
  status: number;
  dur: string;
  fail?: boolean;
};

// ── Mock data — matches data-library.jsx WEBHOOKS + WEBHOOK_DELIVERIES ────────

const MOCK_WEBHOOKS: WebhookRow[] = [
  {
    id: "w1",
    url: "https://erp.company.com/hooks/proculink",
    events: ["order.delivered", "order.failed"],
    status: "healthy",
    lastDelivery: "2m ago",
  },
  {
    id: "w2",
    url: "https://ops.company.com/ingest",
    events: ["order.created", "order.delivered", "order.failed"],
    status: "healthy",
    lastDelivery: "8m ago",
  },
  {
    id: "w3",
    url: "https://legacy.example/cb",
    events: ["order.delivered"],
    status: "failing",
    lastDelivery: "3 retries · 1h ago",
  },
];

// Mock delivery history — only shown under isApiMockMode; real mode shows empty state
const MOCK_DELIVERIES: DeliveryRow[] = [
  { time: "14:32:09", event: "order.delivered", po: "ATL-55021",       status: 200, dur: "142ms" },
  { time: "14:28:42", event: "order.created",   po: "PO-NRD-9981",     status: 200, dur: "98ms"  },
  { time: "13:58:43", event: "order.failed",    po: "CEN-2026-1180",   status: 200, dur: "110ms" },
  { time: "13:58:42", event: "order.failed",    po: "CEN-2026-1180",   status: 503, dur: "timeout", fail: true },
  { time: "11:20:10", event: "order.delivered", po: "WST-2026-7741",   status: 200, dur: "121ms" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function toRow(sub: IntegrationSubscription): WebhookRow {
  return {
    id: sub.id,
    url: sub.targetUrl,
    events: [sub.eventType],
    // Active integration → "healthy"; inactive → "failing"
    status: sub.isActive ? "healthy" : "failing",
    lastDelivery: relativeTime(sub.updatedAt),
  };
}

// ── Backend-accepted event types ──────────────────────────────────────────────

const WEBHOOK_EVENT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "order.created",   label: "Order created — a new PO was ingested" },
  { value: "order.delivered", label: "Order delivered — sent to the supplier" },
  { value: "order.failed",    label: "Order failed — delivery or processing error" },
];

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14"/><path d="M12 5v14"/>
    </svg>
  );
}

function WebhookIcon({ size = 16, color = "var(--ink-muted,#56627A)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/>
      <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/>
      <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  );
}

function SendIcon({ size = 16, color = "var(--ink-muted,#56627A)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/>
      <path d="m21.854 2.147-10.94 10.939"/>
    </svg>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonEndpointRow() {
  return (
    <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--border,#E2E6EE)", animation: "skel-pulse 1.4s ease-in-out infinite" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ height: 12, width: "55%", borderRadius: 4, background: "var(--surface-2,#EFF2F7)" }} />
        <div style={{ height: 21, width: 64, borderRadius: 11, background: "var(--surface-2,#EFF2F7)" }} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ height: 22, width: 90, borderRadius: 4, background: "var(--surface-2,#EFF2F7)" }} />
        <div style={{ height: 22, width: 80, borderRadius: 4, background: "var(--surface-2,#EFF2F7)" }} />
      </div>
    </div>
  );
}

// ── CardHead primitive (inline — matches primitives.jsx CardHead) ─────────────

function CardHead({ title, sub, icon }: { title: string; sub?: string; icon: "webhook" | "send" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px",
        borderBottom: "1px solid var(--border,#E2E6EE)",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {icon === "webhook" ? <WebhookIcon size={16} /> : <SendIcon size={16} />}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, letterSpacing: "-0.01em", color: "var(--ink,#0B1A2F)" }}>{title}</div>
          {sub && <div style={{ fontSize: 11.5, color: "var(--ink-muted,#56627A)" }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Endpoint status pill ──────────────────────────────────────────────────────
// Canonical design uses the ported .pill classes: .pill-ready (green-soft bg
// #E2F1E2 / green-deep ink #1E6D29 / brand-green dot #2E8E3A) for "Healthy",
// .pill-failed (danger-soft / danger) for "Failing". Verified by pixel-sampling
// the design render — no bespoke literals, and definitely not the old #28C55E dot.

function EndpointPill({ status }: { status: "healthy" | "failing" }) {
  const healthy = status === "healthy";
  return (
    <span className={`pill ${healthy ? "pill-ready" : "pill-failed"}`} style={{ flexShrink: 0 }}>
      <span className="dot" />
      {healthy ? "Healthy" : "Failing"}
    </span>
  );
}

// ── Endpoints card ────────────────────────────────────────────────────────────

function EndpointsCard({
  rows,
  isLoading,
  togglingId,
  deletingId,
  onEdit,
  onToggle,
  onDelete,
}: {
  rows: WebhookRow[];
  isLoading: boolean;
  togglingId: string | null;
  deletingId: string | null;
  onEdit: (row: WebhookRow) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      style={{
        background: "var(--surface,#FFFFFF)",
        border: "1px solid var(--border,#E2E6EE)",
        borderRadius: "var(--radius-md,8px)",
        overflow: "hidden",
      }}
    >
      <CardHead title="Endpoints" icon="webhook" />

      {isLoading ? (
        <>
          <SkeletonEndpointRow />
          <SkeletonEndpointRow />
        </>
      ) : rows.length === 0 ? (
        <EmptyState compact title="No endpoints yet" sub="Add an endpoint to start receiving order events." />
      ) : (
        rows.map((w, i) => (
          <div
            key={w.id}
            className="wh-row"
            style={{
              padding: "13px 16px",
              borderBottom: i < rows.length - 1 ? "1px solid var(--border,#E2E6EE)" : "none",
              transition: "background 120ms ease",
            }}
          >
            {/* URL + status pill */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--ink,#0B1A2F)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 240,
                }}
                title={w.url}
              >
                {w.url}
              </span>
              <EndpointPill status={w.status} />
            </div>

            {/* Event chips — canonical .chip (surface-2 / ink-muted / mono 10px) */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {w.events.map((e) => (
                <span
                  key={e}
                  className="chip"
                  style={{
                    background: "var(--surface-2,#EFF2F7)",
                    color: "var(--ink-muted,#56627A)",
                    fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                    fontSize: 10,
                  }}
                >
                  {e}
                </span>
              ))}
            </div>

            {/* Last delivery + actions (actions reveal on row hover/focus to match the clean design) */}
            <div className="wh-metarow" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 7 }}>
              <div style={{ fontSize: 11, color: "var(--ink-faint,#8A93A5)" }}>Last delivery: {w.lastDelivery}</div>
              <div className="wh-actions" style={{ display: "flex", gap: 6 }}>
                <button
                  className="wh-actionbtn"
                  onClick={() => onEdit(w)}
                  style={{
                    height: 27,
                    padding: "0 10px",
                    borderRadius: "var(--radius,6px)",
                    border: "1px solid var(--border-strong,#C6CDDA)",
                    background: "var(--surface,#FFFFFF)",
                    color: "var(--ink-muted,#56627A)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Edit
                </button>
                <button
                  className="wh-actionbtn"
                  onClick={() => onToggle(w.id)}
                  disabled={togglingId === w.id}
                  style={{
                    height: 27,
                    padding: "0 10px",
                    borderRadius: "var(--radius,6px)",
                    border: `1px solid ${BLUE}`,
                    background: "var(--surface,#FFFFFF)",
                    color: togglingId === w.id ? "var(--ink-faint,#8A93A5)" : BLUE,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: togglingId === w.id ? "default" : "pointer",
                  }}
                >
                  {togglingId === w.id ? "…" : w.status === "healthy" ? "Disable" : "Enable"}
                </button>
                <button
                  className="wh-actionbtn"
                  onClick={() => {
                    if (window.confirm(`Delete webhook for ${w.url}?`)) onDelete(w.id);
                  }}
                  disabled={deletingId === w.id}
                  style={{
                    height: 27,
                    padding: "0 10px",
                    borderRadius: "var(--radius,6px)",
                    border: "1px solid #F5B8B8",
                    background: "var(--surface,#FFFFFF)",
                    color: deletingId === w.id ? "var(--ink-faint,#8A93A5)" : "var(--danger,#C53A3A)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: deletingId === w.id ? "default" : "pointer",
                  }}
                >
                  {deletingId === w.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Recent deliveries card ────────────────────────────────────────────────────
// Data: MOCK_DELIVERIES under isApiMockMode; empty state in real mode (no delivery-history API)

function DeliveriesCard({ deliveries }: { deliveries: DeliveryRow[] | null }) {
  return (
    <div
      style={{
        background: "var(--surface,#FFFFFF)",
        border: "1px solid var(--border,#E2E6EE)",
        borderRadius: "var(--radius-md,8px)",
        overflow: "hidden",
      }}
    >
      <CardHead title="Recent deliveries" sub="Last 5 attempts" icon="send" />

      {!deliveries || deliveries.length === 0 ? (
        <EmptyState compact title="No deliveries yet" sub="Delivery attempts will appear here once webhooks start firing." />
      ) : (
        <>
        {/* Phones (<=560px): stacked row-cards — avoids horizontal table overflow at 390px */}
        <div className="wh-deliv-cards">
          {deliveries.map((d, i) => (
            <div
              key={i}
              style={{
                padding: "12px 16px",
                borderBottom: i < deliveries.length - 1 ? "1px solid var(--border,#E2E6EE)" : "none",
                display: "grid",
                gap: 7,
              }}
            >
              {/* Event + status badge */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", fontSize: 13, color: "var(--ink,#0B1A2F)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.event}
                </span>
                <span
                  className={`conf ${d.fail ? "conf-lo" : "conf-hi"}`}
                  style={{ fontSize: 11, padding: "2px 7px", flexShrink: 0 }}
                >
                  {d.status}
                </span>
              </div>
              {/* Order (buyer-blue) + latency */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", fontSize: 13, fontWeight: 600, color: "var(--brand-blue-deep,#0F4FA8)" }}>
                  {d.po}
                </span>
                <span style={{ fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", fontSize: 12, color: "var(--ink-faint,#8A93A5)", flexShrink: 0 }}>
                  {d.dur}
                </span>
              </div>
              {/* Time */}
              <div style={{ fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", fontSize: 11.5, color: "var(--ink-faint,#8A93A5)" }}>
                {d.time}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop (>560px): exact 5-column table */}
        <table
          className="wh-deliv-table"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12.5,
          }}
        >
          <thead>
            <tr>
              {["Time", "Event", "Order", "Status", "Latency"].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 4 ? "right" : "left",
                    fontSize: 10.5,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint,#8A93A5)",
                    padding: "9px 12px",
                    borderBottom: "1px solid var(--border,#E2E6EE)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d, i) => (
              <tr
                key={i}
                style={{ cursor: "default" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface-2,#EFF2F7)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: i < deliveries.length - 1 ? "1px solid var(--border,#E2E6EE)" : "none",
                    fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                    fontSize: 11.5,
                    color: "var(--ink-faint,#8A93A5)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.time}
                </td>
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: i < deliveries.length - 1 ? "1px solid var(--border,#E2E6EE)" : "none",
                    fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                    fontSize: 11,
                    color: "var(--ink,#0B1A2F)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.event}
                </td>
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: i < deliveries.length - 1 ? "1px solid var(--border,#E2E6EE)" : "none",
                    fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                    fontSize: 11.5,
                    color: "var(--brand-blue-deep,#0F4FA8)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.po}
                </td>
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: i < deliveries.length - 1 ? "1px solid var(--border,#E2E6EE)" : "none",
                  }}
                >
                  {/* HTTP status badge — canonical .conf (green-deep on green-soft / danger on danger-soft) */}
                  <span className={`conf ${d.fail ? "conf-lo" : "conf-hi"}`} style={{ whiteSpace: "nowrap" }}>
                    {d.status}
                  </span>
                </td>
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: i < deliveries.length - 1 ? "1px solid var(--border,#E2E6EE)" : "none",
                    textAlign: "right",
                    fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                    fontSize: 11.5,
                    color: "var(--ink-faint,#8A93A5)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.dur}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
}

// ── Add / Edit panel ──────────────────────────────────────────────────────────

function WebhookPanel({
  initial,
  onClose,
  onSave,
  saving,
}: {
  initial: WebhookRow | null;
  onClose: () => void;
  onSave: (url: string, eventType: string, secret?: string) => void;
  saving: boolean;
}) {
  const isNew = !initial || initial.id === "new";
  const [url, setUrl] = useState(initial?.url ?? "");
  const [eventType, setEventType] = useState(initial?.events[0] ?? WEBHOOK_EVENT_TYPES[0].value);
  const [secret, setSecret] = useState("");

  const inputStyle: React.CSSProperties = {
    height: 32,
    width: "100%",
    borderRadius: "var(--radius,6px)",
    border: "1px solid var(--border-strong,#C6CDDA)",
    background: "var(--surface,#FFFFFF)",
    fontSize: 12.5,
    color: "var(--ink,#0B1A2F)",
    padding: "0 11px",
    fontFamily: "var(--font-sans)",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-6"
      style={{ background: "rgba(11,26,47,0.42)", backdropFilter: "blur(3px)" }}
    >
      <div
        className="max-h-[92vh] w-full overflow-auto rounded-t-[10px] sm:max-w-[540px] sm:rounded-[10px]"
        style={{
          background: "var(--surface,#FFFFFF)",
          border: "1px solid var(--border,#E2E6EE)",
          boxShadow: "0 8px 24px rgba(11,26,47,0.10)",
          animation: "modal-pop 220ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* Head */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 18px",
            borderBottom: "1px solid var(--border,#E2E6EE)",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "var(--radius-md,8px)",
                background: BLUE_SOFT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <WebhookIcon size={18} color={BLUE} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-0.015em", color: "var(--ink,#0B1A2F)" }}>
                {isNew ? "Add webhook endpoint" : "Edit webhook endpoint"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-muted,#56627A)" }}>
                Receive order events in real time
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius,6px)",
              background: "none",
              border: "none",
              color: "var(--ink-faint,#8A93A5)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: "grid", gap: 14 }}>
          {/* Endpoint URL */}
          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--ink-muted,#56627A)", marginBottom: 6 }}>
              Endpoint URL <span style={{ color: "var(--danger,#C53A3A)" }}>*</span>
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://erp.example/hooks/proculink"
              style={{ ...inputStyle, fontFamily: "var(--font-mono,'JetBrains Mono',monospace)" }}
            />
          </div>

          {/* Events */}
          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--ink-muted,#56627A)", marginBottom: 6 }}>
              Events
            </label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              style={inputStyle}
            >
              {WEBHOOK_EVENT_TYPES.map((evt) => (
                <option key={evt.value} value={evt.value}>{evt.label}</option>
              ))}
            </select>
          </div>

          {/* Signing secret — optional; backend stores it AES-GCM encrypted and signs each payload (Wave 4). */}
          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--ink-muted,#56627A)", marginBottom: 6 }}>
              Signing secret
            </label>
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="whsec_••••••••"
              style={{
                ...inputStyle,
                fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
              }}
            />
            <div style={{ fontSize: 11, color: "var(--ink-faint,#8A93A5)", marginTop: 4 }}>
              We sign every payload with HMAC-SHA256 using this secret.
            </div>
          </div>

          {/* Test-ping note — blue info banner (sampled #E3EDFB bg, blue ink) */}
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              background: BLUE_SOFT,
              color: BLUE,
              borderRadius: "var(--radius,6px)",
              padding: "10px 12px",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }} aria-hidden>
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
            We'll send a test ping on save and mark the endpoint healthy once it returns 2xx.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            padding: "14px 18px",
            borderTop: "1px solid var(--border,#E2E6EE)",
            background: "var(--surface-2,#EFF2F7)",
          }}
        >
          <button
            onClick={onClose}
            style={{ height: 32, padding: "0 14px", borderRadius: "var(--radius,6px)", border: "1px solid var(--border-strong,#C6CDDA)", background: "var(--surface,#FFFFFF)", color: "var(--ink-muted,#56627A)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(url, eventType, secret.trim() || undefined)}
            disabled={saving || !url.trim()}
            onMouseEnter={(e) => { if (!saving && url.trim()) (e.currentTarget as HTMLElement).style.background = BLUE_DEEP; }}
            onMouseLeave={(e) => { if (!saving && url.trim()) (e.currentTarget as HTMLElement).style.background = BLUE; }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 32,
              padding: "0 14px",
              borderRadius: "var(--radius,6px)",
              border: "1px solid transparent",
              background: saving || !url.trim() ? "var(--ink-faint,#8A93A5)" : BLUE,
              color: "#FFFFFF",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: saving || !url.trim() ? "default" : "pointer",
            }}
          >
            {!saving && <CheckIcon size={14} />}
            {saving ? "Saving…" : isNew ? "Add endpoint" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared layout (both mock and live paths render this) ──────────────────────

function WebhooksLayout({
  rows,
  deliveries,
  notice,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  isLoading,
  isError,
  onRetry,
  togglingId,
  deletingId,
}: {
  rows: WebhookRow[];
  deliveries: DeliveryRow[] | null;
  notice: string | null;
  onAdd: () => void;
  onEdit: (row: WebhookRow) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  togglingId: string | null;
  deletingId: string | null;
}) {
  return (
    <>
      <style>{`
        @keyframes skel-pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
        @keyframes modal-pop { from { opacity:0; transform:translateY(10px) scale(0.99); } to { opacity:1; transform:none; } }
        .webhooks-split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
        @media (max-width: 720px) { .webhooks-split { grid-template-columns: 1fr; } }
        /* Clean rows by default (matches design); reveal actions on hover/focus, keyboard-accessible */
        .wh-row .wh-actions { opacity: 0; transform: translateY(1px); transition: opacity 120ms ease, transform 120ms ease; }
        .wh-row:hover .wh-actions,
        .wh-row:focus-within .wh-actions { opacity: 1; transform: none; }
        .wh-row:hover { background: var(--surface-2,#EFF2F7); }
        @media (hover: none) { .wh-row .wh-actions { opacity: 1; transform: none; } }
        /* Deliveries: exact table on desktop, stacked row-cards on phones (no h-scroll) */
        .wh-deliv-cards { display: none; }
        .wh-deliv-table { display: table; }
        @media (max-width: 560px) {
          .wh-deliv-cards { display: block; }
          .wh-deliv-table { display: none; }
        }
        /* Phone: actions always visible, stacked under the meta label, >=40px tap targets */
        @media (max-width: 560px) {
          .wh-metarow { flex-direction: column; align-items: stretch; gap: 10px; }
          .wh-actions { opacity: 1 !important; transform: none !important; gap: 8px; }
          .wh-actionbtn { flex: 1; height: 40px; font-size: 13px; }
        }
        /* Phone: tighten page gutters so content keeps comfortable width at 390px */
        @media (max-width: 560px) {
          .wh-pad-top { padding: 20px 16px 0 !important; }
          .wh-pad-body { padding: 0 16px 48px !important; }
        }
      `}</style>

      <div style={{ background: "var(--bg,#F6F7FA)", minHeight: "100%" }}>
        {/* Page header */}
        <div className="wh-pad-top" style={{ padding: "26px 34px 0", maxWidth: 1480, margin: "0 auto", width: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "16px 24px",
              marginBottom: 22,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1
                style={{
                  fontFamily: "var(--font-display,'Bricolage Grotesque',Inter,sans-serif)",
                  fontSize: 30,
                  fontWeight: 600,
                  letterSpacing: "-0.025em",
                  lineHeight: 1.1,
                  margin: 0,
                  color: "var(--ink,#0B1A2F)",
                  whiteSpace: "nowrap",
                }}
              >
                Webhooks
              </h1>
              <div style={{ color: "var(--ink-muted,#56627A)", fontSize: 13, marginTop: 5 }}>
                Push order events to your systems · {rows.length} endpoint{rows.length !== 1 ? "s" : ""}
              </div>
            </div>
            <button
              onClick={onAdd}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = BLUE_DEEP; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = BLUE; }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 32,
                padding: "0 14px",
                borderRadius: "var(--radius,6px)",
                border: "1px solid transparent",
                background: BLUE,
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <PlusIcon size={15} />
              Add endpoint
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="wh-pad-body" style={{ padding: "0 34px 64px", maxWidth: 1480, margin: "0 auto", width: "100%" }}>
          {/* Notice */}
          {notice && (
            <div
              style={{
                marginBottom: 16,
                borderRadius: "var(--radius-md,8px)",
                padding: "10px 14px",
                fontSize: 12.5,
                border: "1px solid var(--border,#E2E6EE)",
                borderLeft: `3px solid ${BLUE}`,
                background: BLUE_SOFT,
                color: BLUE,
              }}
            >
              {notice}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div
              style={{
                marginBottom: 16,
                borderRadius: "var(--radius-md,8px)",
                padding: "10px 14px",
                fontSize: 12.5,
                border: "1px solid #F5B8B8",
                borderLeft: "3px solid var(--danger,#C53A3A)",
                background: "var(--danger-soft,#FBE3E3)",
                color: "#7B1C1C",
              }}
            >
              Failed to load webhooks.{" "}
              <button
                onClick={onRetry}
                style={{ textDecoration: "underline", fontWeight: 600, background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "inherit" }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Two-column split: Endpoints | Recent deliveries */}
          <div className="webhooks-split">
            <EndpointsCard
              rows={rows}
              isLoading={isLoading}
              togglingId={togglingId}
              deletingId={deletingId}
              onEdit={onEdit}
              onToggle={onToggle}
              onDelete={onDelete}
            />
            <DeliveriesCard deliveries={deliveries} />
          </div>
        </div>
      </div>
    </>
  );
}

// ── Mock mode page ────────────────────────────────────────────────────────────

function MockWebhooksPage() {
  const [rows, setRows] = useState<WebhookRow[]>(MOCK_WEBHOOKS);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<WebhookRow | null>(null);
  const [saving, setSaving] = useState(false);

  const handleToggle = (id: string) => {
    setRows((prev) =>
      prev.map((w) => w.id === id ? { ...w, status: w.status === "healthy" ? "failing" : "healthy" } : w)
    );
    setNotice("Webhook status updated.");
  };

  const handleDelete = (id: string) => {
    setRows((prev) => prev.filter((w) => w.id !== id));
    setNotice("Webhook deleted.");
  };

  const handleSave = async (url: string, eventType: string) => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    if (!panel || panel.id === "new") {
      const newRow: WebhookRow = {
        id: crypto.randomUUID(),
        url,
        events: [eventType],
        status: "healthy",
        lastDelivery: "just now",
      };
      setRows((prev) => [newRow, ...prev]);
      setNotice(`Endpoint added — test ping sent to ${url}.`);
    } else {
      setRows((prev) => prev.map((w) => w.id === panel.id ? { ...w, url, events: [eventType] } : w));
      setNotice("Webhook updated.");
    }
    setSaving(false);
    setPanel(null);
  };

  return (
    <>
      <WebhooksLayout
        rows={rows}
        deliveries={MOCK_DELIVERIES}
        notice={notice}
        onAdd={() => { setNotice(null); setPanel({ id: "new", url: "", events: [WEBHOOK_EVENT_TYPES[0].value], status: "healthy", lastDelivery: "never" }); }}
        onEdit={(w) => { setNotice(null); setPanel(w); }}
        onToggle={handleToggle}
        onDelete={handleDelete}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
        togglingId={null}
        deletingId={null}
      />
      {panel && (
        <WebhookPanel
          initial={panel}
          onClose={() => setPanel(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </>
  );
}

// ── Live mode page ────────────────────────────────────────────────────────────

function LiveWebhooksPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<WebhookRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["integrations"],
    queryFn: getIntegrations,
    staleTime: 30_000,
  });

  const rows = (data ?? []).map(toRow);

  const createMutation = useMutation({
    mutationFn: (args: { url: string; eventType: string; secret?: string }) =>
      createIntegration({ platform: "webhook", eventType: args.eventType, targetUrl: args.url, secret: args.secret }),
    onSuccess: (sub) => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      setNotice(`Endpoint added — test ping sent to ${sub.targetUrl}.`);
      setPanel(null);
    },
    onError: (err: Error) => setNotice(`Failed to add endpoint — ${err.message}`),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleIntegration(id),
    onMutate: (id) => setTogglingId(id),
    onSettled: () => setTogglingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      setNotice("Webhook status updated.");
    },
    onError: (err: Error) => setNotice(`Toggle failed — ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteIntegration(id),
    onMutate: (id) => setDeletingId(id),
    onSettled: () => setDeletingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      setNotice("Webhook deleted.");
    },
    onError: (err: Error) => setNotice(`Delete failed — ${err.message}`),
  });

  const handleSave = (url: string, eventType: string, secret?: string) => {
    if (!panel || panel.id === "new") {
      createMutation.mutate({ url, eventType, secret });
    } else {
      // The backend has no update endpoint yet — be honest rather than claim a
      // save that didn't happen. To change an endpoint, delete and re-add it.
      setNotice("Editing an existing endpoint isn't supported yet — delete this endpoint and add a new one to change its URL or event.");
      setPanel(null);
    }
  };

  return (
    <>
      <WebhooksLayout
        rows={rows}
        // No delivery-history API in live mode — show empty state in DeliveriesCard
        deliveries={null}
        notice={notice}
        onAdd={() => { setNotice(null); setPanel({ id: "new", url: "", events: [WEBHOOK_EVENT_TYPES[0].value], status: "healthy", lastDelivery: "never" }); }}
        onEdit={(w) => { setNotice(null); setPanel(w); }}
        onToggle={(id) => toggleMutation.mutate(id)}
        onDelete={(id) => deleteMutation.mutate(id)}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => queryClient.invalidateQueries({ queryKey: ["integrations"] })}
        togglingId={togglingId}
        deletingId={deletingId}
      />
      {panel && (
        <WebhookPanel
          initial={panel}
          onClose={() => setPanel(null)}
          onSave={handleSave}
          saving={createMutation.isPending}
        />
      )}
    </>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  return isApiMockMode ? <MockWebhooksPage /> : <LiveWebhooksPage />;
}
