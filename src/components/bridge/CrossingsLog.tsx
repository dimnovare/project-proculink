"use client";

// Crossings Log — append-only audit trail with date-grouped table-row layout.
// Canonical: CrossingsLogScreen in screen-crossings.jsx

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getAuditLog, isApiMockMode, type AuditLogEntry } from "@/lib/api-client";
import { EmptyState } from "./EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

// Canonical filter vocabulary (from CrossingsLogScreen):
//   All events / Delivered / Failed / Edited / Validated / Parsed / Created
// Real backend actions (from EVENT_MAP below) mapped to canonical labels.
type CanonicalEvent =
  | "created"
  | "parsed"
  | "validated"
  | "edited"
  | "delivered"
  | "failed";

// Internal event type kept for backward compat with mock data
type EventType =
  | "uploaded"
  | "extracted"
  | "mapped"
  | "validated"
  | "flagged"
  | "reviewed"
  | "crossed"
  | "failed"
  | "retried";

type Actor = { initials: string; name: string; type: "user" | "system" | "ai" };

type LogEntry = {
  id: string;
  ts: string;         // display time HH:mm:ss
  isoTs: string;      // ISO for grouping
  crossingId: string;
  po: string;
  buyer: string;
  supplier: string;
  fmt: string;
  event: EventType;
  canonicalEvent: CanonicalEvent;
  actor: Actor;
  message: string;
  detail?: string;
  diff?: Array<{ field: string; from: string; to: string }>;
};

// ─── Mock data ─────────────────────────────────────────────────────────────────

const now = Date.now();
const MOCK_LOG: LogEntry[] = [
  {
    id: "e1",
    ts: "14:22:08", isoTs: new Date(now - 2 * 60000).toISOString(),
    crossingId: "demo-001", po: "PO-DEMO-001",
    buyer: "Heinrich Industries", supplier: "Acme Components", fmt: "PDF",
    event: "flagged", canonicalEvent: "validated",
    actor: { initials: "AI", name: "Extraction engine", type: "ai" },
    message: "3 validation errors flagged",
    detail: "Unit price missing on lines 4, 9. Delivery date in the past (2026-05-10).",
    diff: [
      { field: "line[4].unitPrice", from: "(missing)", to: "⚠ required" },
      { field: "line[9].unitPrice", from: "(missing)", to: "⚠ required" },
      { field: "header.deliveryDate", from: "2026-05-10", to: "⚠ past date" },
    ],
  },
  {
    id: "e2",
    ts: "14:22:05", isoTs: new Date(now - 14 * 60000).toISOString(),
    crossingId: "demo-001", po: "PO-DEMO-001",
    buyer: "Heinrich Industries", supplier: "Acme Components", fmt: "PDF",
    event: "extracted", canonicalEvent: "parsed",
    actor: { initials: "AI", name: "Extraction engine", type: "ai" },
    message: "14 line items extracted · avg confidence 84%",
    detail: "Document parsed successfully. Zones: header (97%), line table (81%), footer (72%).",
  },
  {
    id: "e3",
    ts: "14:21:51", isoTs: new Date(now - 20 * 60000).toISOString(),
    crossingId: "demo-001", po: "PO-DEMO-001",
    buyer: "Heinrich Industries", supplier: "Acme Components", fmt: "PDF",
    event: "uploaded", canonicalEvent: "created",
    actor: { initials: "MK", name: "Marius Klein", type: "user" },
    message: "Document uploaded — PO-DEMO-001.pdf (214 KB)",
  },
  {
    id: "e4",
    ts: "14:08:33", isoTs: new Date(now - 60 * 60000).toISOString(),
    crossingId: "wmt341", po: "WMT-2026-0341",
    buyer: "Westmark Tools", supplier: "Acme Components", fmt: "EMAIL",
    event: "crossed", canonicalEvent: "delivered",
    actor: { initials: "MK", name: "Marius Klein", type: "user" },
    message: "Delivered successfully — cXML delivered to Acme ERP endpoint",
    detail: "HTTP 200. Transmission time 1.2s. ACK received.",
  },
  {
    id: "e5",
    ts: "14:07:44", isoTs: new Date(now - 65 * 60000).toISOString(),
    crossingId: "wmt341", po: "WMT-2026-0341",
    buyer: "Westmark Tools", supplier: "Acme Components", fmt: "EMAIL",
    event: "reviewed", canonicalEvent: "edited",
    actor: { initials: "MK", name: "Marius Klein", type: "user" },
    message: "Approved for delivery after manual review",
  },
  {
    id: "e6",
    ts: "13:54:12", isoTs: new Date(now - 90 * 60000).toISOString(),
    crossingId: "850201", po: "850-99201",
    buyer: "Centralis Pharma", supplier: "MedicaSupply OY", fmt: "EDI",
    event: "failed", canonicalEvent: "failed",
    actor: { initials: "SY", name: "ProcuLink system", type: "system" },
    message: "Delivery attempt failed — endpoint timeout (30s)",
    detail: "MedicaSupply OY cXML endpoint returned HTTP 504. Will retry in 15 min.",
  },
  {
    id: "e7",
    ts: "13:39:20", isoTs: new Date(now - 2 * 24 * 60 * 60000).toISOString(),
    crossingId: "850201", po: "850-99201",
    buyer: "Centralis Pharma", supplier: "MedicaSupply OY", fmt: "EDI",
    event: "mapped", canonicalEvent: "edited",
    actor: { initials: "AI", name: "Mapping engine", type: "ai" },
    message: "18 codes mapped · 6 low-confidence matches",
    diff: [
      { field: "line[3].supplierCode", from: "CPH-SYRG-10", to: "MDS-SY-10-STERILE (72%)" },
      { field: "line[7].supplierCode", from: "CPH-GLOVE-L", to: "MDS-GL-L-NITRILE (68%)" },
    ],
  },
  {
    id: "e8",
    ts: "13:38:05", isoTs: new Date(now - 2 * 24 * 60 * 60000 + 5000).toISOString(),
    crossingId: "850201", po: "850-99201",
    buyer: "Centralis Pharma", supplier: "MedicaSupply OY", fmt: "EDI",
    event: "extracted", canonicalEvent: "parsed",
    actor: { initials: "AI", name: "Extraction engine", type: "ai" },
    message: "18 line items extracted from EDI 850 segment",
  },
];

// ─── Map AuditLogEntry → LogEntry ─────────────────────────────────────────────

// Backend action → internal EventType
const ACTION_TO_EVENT: Record<string, EventType> = {
  created:          "uploaded",
  parsed:           "extracted",
  status_changed:   "reviewed",
  resolved:         "reviewed",
  transform_queued: "mapped",
  delivered:        "crossed",
  delivery_failed:  "failed",
  flagged:          "flagged",
  validated:        "validated",
  uploaded:         "uploaded",
  extracted:        "extracted",
  mapped:           "mapped",
  retried:          "retried",
};

// Internal EventType → canonical filter event
const EVENT_TO_CANONICAL: Record<EventType, CanonicalEvent> = {
  uploaded:  "created",
  extracted: "parsed",
  mapped:    "edited",
  validated: "validated",
  flagged:   "validated",
  reviewed:  "edited",
  crossed:   "delivered",
  failed:    "failed",
  retried:   "failed",
};

function mapApiEntry(e: AuditLogEntry): LogEntry {
  const eventKey = e.action.toLowerCase();
  const event: EventType = ACTION_TO_EVENT[eventKey] ?? "crossed";
  const canonicalEvent: CanonicalEvent = EVENT_TO_CANONICAL[event] ?? "created";

  const d = new Date(e.ts);
  const ts = Number.isNaN(d.getTime())
    ? e.ts
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return {
    id:             e.id,
    ts,
    isoTs:          e.ts,
    crossingId:     e.orderId ?? e.id,
    po:             e.poNumber ?? e.orderId ?? "—",
    buyer:          e.buyerName ?? "—",
    supplier:       e.supplierName ?? "—",
    fmt:            e.format ?? "—",
    event,
    canonicalEvent,
    actor: {
      initials: e.actorInitials,
      name:     e.actorName,
      type:     e.actorType,
    },
    message: e.message,
  };
}

// ─── Date group label ─────────────────────────────────────────────────────────

function groupLabel(isoTs: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return "Recent activity";
  const long = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (d.toDateString() === today) return `Today · ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  if (d.toDateString() === yesterday) return `Yesterday · ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  return long;
}

function dateKey(isoTs: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toDateString();
}

// ─── Event visual config (canonical colors) ───────────────────────────────────

const EV: Record<EventType, { bg: string; color: string; label: string; iconPath: string }> = {
  uploaded:  { bg: "#E3EDFB", color: "#1E66C9", label: "Created",   iconPath: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" },
  extracted: { bg: "#EEE7FB", color: "#6F4FCE", label: "Parsed",    iconPath: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" },
  mapped:    { bg: "#FAEFD6", color: "#C97A14", label: "Edited",    iconPath: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" },
  validated: { bg: "#E2F1E2", color: "#2E8E3A", label: "Validated", iconPath: "M20 6 9 17l-5-5" },
  flagged:   { bg: "#FAEFD6", color: "#C97A14", label: "Validated", iconPath: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4M12 17h.01" },
  reviewed:  { bg: "#E3EDFB", color: "#0F4FA8", label: "Edited",    iconPath: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" },
  crossed:   { bg: "#E2F1E2", color: "#2E8E3A", label: "Delivered", iconPath: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zM21.854 2.147l-10.94 10.939" },
  failed:    { bg: "#FBE3E3", color: "#C53A3A", label: "Failed",    iconPath: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4M12 17h.01" },
  retried:   { bg: "#FAEFD6", color: "#C97A14", label: "Failed",    iconPath: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" },
};

const ACTOR_BG: Record<"user" | "system" | "ai", string> = {
  user:   "#1E66C9",
  system: "#56627A",
  ai:     "#6F4FCE",
};

// Canonical event visual config — the row's icon, circle tint, label, and text
// color are driven by canonicalEvent (NOT the internal EventType) so every
// "Validated" reads green-check, every "Edited" reads violet-pencil, etc.,
// exactly like the design reference. Greens use the muted status green (#2E8E3A)
// to match the supplier-side accent, not the bright brand green used on CTAs.
const EV_CANON: Record<
  CanonicalEvent,
  { bg: string; color: string; label: string; iconPath: string }
> = {
  created:   { bg: "#E9EDF3", color: "#56627A", label: "Created",   iconPath: "M12 5v14M5 12h14" },
  parsed:    { bg: "#E3EDFB", color: "#1E66C9", label: "Parsed",    iconPath: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" },
  validated: { bg: "#E2F1E2", color: "#2E8E3A", label: "Validated", iconPath: "M21.801 10A10 10 0 1 1 17 3.335M9 11l3 3L22 4" },
  edited:    { bg: "#EEE7FB", color: "#6F4FCE", label: "Edited",    iconPath: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" },
  delivered: { bg: "#E2F1E2", color: "#2E8E3A", label: "Delivered", iconPath: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zM21.854 2.147l-10.94 10.939" },
  failed:    { bg: "#FBE3E3", color: "#C53A3A", label: "Failed",    iconPath: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4M12 17h.01" },
};

// Canonical filter labels (from CrossingsLogScreen)
const FILTERS: Array<{ key: CanonicalEvent | "all"; label: string }> = [
  { key: "all",       label: "All events" },
  { key: "delivered", label: "Delivered" },
  { key: "failed",    label: "Failed" },
  { key: "edited",    label: "Edited" },
  { key: "validated", label: "Validated" },
  { key: "parsed",    label: "Parsed" },
  { key: "created",   label: "Created" },
];

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {[64, 80, 110, 70, 140, 100, 90, 30].map((w, i) => (
        <td key={i} style={{ padding: "11px 12px", borderBottom: "1px solid #E2E6EE" }}>
          <div
            className="animate-pulse rounded"
            style={{ height: 13, background: "#EFF2F7", width: w }}
          />
        </td>
      ))}
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CrossingsLog() {
  const router = useRouter();
  const [openId, setOpenId]     = useState<string | null>(null);
  const [filter, setFilter]     = useState<CanonicalEvent | "all">("all");
  const [search, setSearch]     = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit"],
    queryFn:  () => getAuditLog(),
    enabled:  !isApiMockMode,
  });

  const LOG: LogEntry[] = isApiMockMode
    ? MOCK_LOG
    : (data?.events ?? []).map(mapApiEntry);

  // Export filtered log as CSV
  function handleExport() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Timestamp", "Event", "PO", "Buyer", "Supplier", "Format", "Actor", "Message"];
    const body = filtered.map((e) =>
      [e.ts, EV[e.event].label, e.po, e.buyer, e.supplier, e.fmt, e.actor.name, e.message]
        .map(esc).join(","),
    );
    const csv = [header.map(esc).join(","), ...body].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivery-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const filtered = LOG.filter((e) => {
    const mev = filter === "all" || e.canonicalEvent === filter;
    const q   = search.toLowerCase();
    const ms  = !q || e.po.toLowerCase().includes(q) || e.buyer.toLowerCase().includes(q) || e.supplier.toLowerCase().includes(q);
    return mev && ms;
  });

  // Group by calendar date
  const byDate = filtered.reduce<Map<string, { label: string; entries: LogEntry[] }>>(
    (acc, e) => {
      const key = dateKey(e.isoTs);
      if (!acc.has(key)) {
        acc.set(key, { label: groupLabel(e.isoTs), entries: [] });
      }
      acc.get(key)!.entries.push(e);
      return acc;
    },
    new Map(),
  );

  return (
    <div style={{ padding: "26px 34px 64px" }}>
      {/* Page header */}
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
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.1,
              margin: 0,
              color: "#0B1A2F",
            }}
          >
            Delivery log
          </h1>
          <div
            style={{
              color: "#56627A",
              fontSize: 13,
              marginTop: 5,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {/* key icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8A93A5" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15.5 7.5 21 2m-3 3 1.5 1.5" /><circle cx="9" cy="15" r="6" /><path d="m13.2 10.8 3.3-3.3" />
            </svg>
            Append-only · immutable · every parse, edit, validation and delivery
          </div>
        </div>

        {/* Export log button — canonical: secondary */}
        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          title={filtered.length === 0 ? "Nothing to export" : "Download current log as CSV"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            height: 32,
            padding: "0 14px",
            borderRadius: 6,
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            background: "#FFFFFF",
            color: filtered.length === 0 ? "#8A93A5" : "#0B1A2F",
            border: "1px solid #C6CDDA",
            cursor: filtered.length === 0 ? "not-allowed" : "pointer",
            transition: "background 150ms",
            whiteSpace: "nowrap",
          }}
        >
          {/* download icon */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Export log
        </button>
      </div>

      {/* Filter / search bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        {/* Filter chips — canonical fchip-row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            overflowX: "auto",
          }}
        >
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: `1px solid ${active ? "transparent" : "#E2E6EE"}`,
                  background: active ? "#0B1A2F" : "#FFFFFF",
                  color: active ? "#FFFFFF" : "#56627A",
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 150ms",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* PO search — canonical search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "#FFFFFF",
            border: "1px solid #E2E6EE",
            borderRadius: 6,
            padding: "0 10px",
            height: 30,
            width: 200,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A93A5" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Filter by PO…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: "none",
              outline: "none",
              background: "none",
              fontSize: 12.5,
              width: "100%",
              color: "#0B1A2F",
            }}
          />
        </div>
      </div>

      {/* Loading state */}
      {isLoading && !isApiMockMode && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        </div>
      )}

      {/* Error state */}
      {isError && !isApiMockMode && (
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E6EE",
            borderRadius: 8,
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 28, color: "#C53A3A", marginBottom: 10 }}>⚠</div>
          <p style={{ fontSize: 13, color: "#56627A", marginBottom: 16 }}>
            Could not load the delivery log. Check your connection and try again.
          </p>
          <button
            onClick={() => refetch()}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 6,
              fontSize: 12.5,
              fontWeight: 600,
              background: "#FFFFFF",
              color: "#0B1A2F",
              border: "1px solid #C6CDDA",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Date-grouped content */}
      {(!isLoading || isApiMockMode) && !isError && (
        <>
          {filtered.length === 0 ? (
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E6EE",
                borderRadius: 8,
              }}
            >
              <EmptyState
                compact
                title="No matching events"
                sub="Nothing recorded for this filter yet."
              />
            </div>
          ) : (
            Array.from(byDate.entries()).map(([key, { label, entries }]) => (
              <div key={key} style={{ marginBottom: 18 }}>
                {/* Date eyebrow */}
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "#8A93A5",
                    marginBottom: 8,
                  }}
                >
                  {label}
                </div>

                {/* Card with rows */}
                <div
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #E2E6EE",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  {entries.map((c, idx) => {
                    // Visual treatment is canonical-event-driven to match the design
                    // (green Validated/Delivered, violet Edited, blue Parsed, slate Created, red Failed).
                    const ev   = EV_CANON[c.canonicalEvent];
                    const open = openId === c.id;
                    const hasDiff   = !!c.diff?.length;
                    const hasDetail = !!c.detail;
                    const isLast    = idx === entries.length - 1;

                    return (
                      <div
                        key={c.id}
                        style={{ borderBottom: isLast ? "none" : "1px solid #E2E6EE" }}
                      >
                        {/* Main row — canonical CrossingRow button */}
                        <button
                          onClick={() => setOpenId(open ? null : c.id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            background: open ? "#EFF2F7" : "none",
                            border: "none",
                            padding: "11px 16px",
                            transition: "background 150ms",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                          }}
                        >
                          {/* Time */}
                          <span
                            style={{
                              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                              fontSize: 11.5,
                              color: "#8A93A5",
                              width: 64,
                              flexShrink: 0,
                            }}
                          >
                            {c.ts}
                          </span>

                          {/* Event icon circle */}
                          <span
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: "50%",
                              background: ev.bg,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ev.color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                              <path d={ev.iconPath} />
                            </svg>
                          </span>

                          {/* Event label */}
                          <span
                            style={{
                              width: 82,
                              flexShrink: 0,
                              fontSize: 12.5,
                              fontWeight: 600,
                              color: ev.color,
                            }}
                          >
                            {ev.label}
                          </span>

                          {/* PO mono */}
                          <span
                            style={{
                              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                              fontSize: 12,
                              fontWeight: 600,
                              width: 150,
                              flexShrink: 0,
                              color: "#1E66C9",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.po}
                          </span>

                          {/* Buyer → supplier */}
                          <span
                            style={{
                              flex: 1,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 12,
                              color: "#56627A",
                              minWidth: 0,
                              overflow: "hidden",
                            }}
                          >
                            <span
                              style={{
                                color: "#1E66C9",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {c.buyer}
                            </span>
                            {/* arrow right */}
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8A93A5" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                            <span
                              style={{
                                color: "#2E8E3A",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {c.supplier}
                            </span>
                          </span>

                          {/* Actor badge */}
                          <span
                            style={{
                              fontSize: 11.5,
                              color: "#8A93A5",
                              width: 110,
                              flexShrink: 0,
                              textAlign: "right",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={c.actor.name}
                          >
                            {c.actor.name}
                          </span>

                          {/* Chevron */}
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#8A93A5"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              transform: open ? "rotate(180deg)" : "none",
                              transition: "transform 200ms",
                              flexShrink: 0,
                            }}
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>

                        {/* Expanded panel — canonical CrossingRow detail */}
                        {open && (
                          <div
                            style={{
                              padding: "4px 16px 16px 106px",
                              background: "#EFF2F7",
                            }}
                          >
                            <div
                              style={{
                                background: "#FFFFFF",
                                border: "1px solid #E2E6EE",
                                borderRadius: 8,
                                padding: "12px 14px",
                              }}
                            >
                              {/* Detail fields grid */}
                              {hasDetail && (
                                <p
                                  style={{
                                    fontSize: 12,
                                    color: "#56627A",
                                    marginBottom: 10,
                                    lineHeight: 1.6,
                                  }}
                                >
                                  {c.detail}
                                </p>
                              )}

                              {/* Diff table */}
                              {hasDiff && (
                                <div style={{ marginBottom: 12 }}>
                                  <div
                                    style={{
                                      fontSize: 9,
                                      fontWeight: 600,
                                      letterSpacing: "0.07em",
                                      textTransform: "uppercase",
                                      color: "#8A93A5",
                                      marginBottom: 6,
                                    }}
                                  >
                                    Field changes
                                  </div>
                                  <div
                                    style={{
                                      borderRadius: 6,
                                      border: "1px solid #E2E6EE",
                                      overflow: "hidden",
                                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                                      fontSize: 11.5,
                                    }}
                                  >
                                    {c.diff!.map((d, i) => (
                                      <div
                                        key={i}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 12,
                                          padding: "8px 11px",
                                          background: i % 2 === 0 ? "#FFFFFF" : "#F6F7FA",
                                          borderBottom: i < c.diff!.length - 1 ? "1px solid #F0F2F6" : "none",
                                        }}
                                      >
                                        <span style={{ color: "#0F4FA8", minWidth: 200 }}>{d.field}</span>
                                        <span style={{ color: "#C53A3A" }}>{d.from}</span>
                                        <span style={{ color: "#C6CDDA" }}>→</span>
                                        <span style={{ color: "#2E8E3A" }}>{d.to}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Action buttons — canonical: View order / Export entry / Retry crossing */}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
                                {/* View order — secondary, navigates to /inbox/{id} */}
                                <button
                                  onClick={() => router.push(`/inbox/${c.crossingId}`)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    height: 27,
                                    padding: "0 10px",
                                    borderRadius: 6,
                                    border: "1px solid #C6CDDA",
                                    background: "#FFFFFF",
                                    color: "#0B1A2F",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    transition: "background 150ms",
                                  }}
                                >
                                  {/* eye icon */}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
                                  </svg>
                                  View order
                                </button>

                                {/* Retry crossing — secondary, only for failed events */}
                                {/* No retry API exists yet; button shown only when event is failed, with a placeholder */}
                                {c.event === "failed" && (
                                  <button
                                    onClick={() => {
                                      // Retry API not yet implemented — navigate to order for manual retry
                                      router.push(`/inbox/${c.crossingId}`);
                                    }}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                      height: 27,
                                      padding: "0 10px",
                                      borderRadius: 6,
                                      border: "1px solid #C6CDDA",
                                      background: "#FFFFFF",
                                      color: "#0B1A2F",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      transition: "background 150ms",
                                    }}
                                  >
                                    {/* refresh icon */}
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
                                    </svg>
                                    Retry delivery
                                  </button>
                                )}

                                {/* Export entry — ghost */}
                                <button
                                  onClick={() => {
                                    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
                                    const row = [c.ts, EV[c.event].label, c.po, c.buyer, c.supplier, c.fmt, c.actor.name, c.message].map(esc).join(",");
                                    const csv = [`"Timestamp","Event","PO","Buyer","Supplier","Format","Actor","Message"`, row].join("\r\n");
                                    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = `delivery-${c.po}-${c.ts.replace(/:/g, "-")}.csv`;
                                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                  }}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    height: 27,
                                    padding: "0 10px",
                                    borderRadius: 6,
                                    border: "none",
                                    background: "transparent",
                                    color: "#56627A",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    transition: "background 150ms",
                                  }}
                                >
                                  {/* download icon */}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                                  </svg>
                                  Export entry
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
