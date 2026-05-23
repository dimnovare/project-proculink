"use client";

// Crossings Log — append-only audit timeline with actor badges, event types,
// and expandable payload diffs. /operations/log

import { useState } from "react";
import { FileChip } from "./FileChip";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  ts: string;
  crossingId: string;
  po: string;
  buyer: string;
  supplier: string;
  fmt: string;
  event: EventType;
  actor: Actor;
  message: string;
  detail?: string;
  diff?: Array<{ field: string; from: string; to: string }>;
};

// ─── Mock data ─────────────────────────────────────────────────────────────────

const LOG: LogEntry[] = [
  {
    id: "e1",
    ts: "14:22:08",
    crossingId: "008412",
    po: "PO-2026-008412",
    buyer: "Heinrich Industries",
    supplier: "Acme Components",
    fmt: "PDF",
    event: "flagged",
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
    ts: "14:22:05",
    crossingId: "008412",
    po: "PO-2026-008412",
    buyer: "Heinrich Industries",
    supplier: "Acme Components",
    fmt: "PDF",
    event: "extracted",
    actor: { initials: "AI", name: "Extraction engine", type: "ai" },
    message: "14 line items extracted · avg confidence 84%",
    detail: "Document parsed successfully. Zones: header (97%), line table (81%), footer (72%).",
  },
  {
    id: "e3",
    ts: "14:21:51",
    crossingId: "008412",
    po: "PO-2026-008412",
    buyer: "Heinrich Industries",
    supplier: "Acme Components",
    fmt: "PDF",
    event: "uploaded",
    actor: { initials: "MK", name: "Marius Klein", type: "user" },
    message: "Document uploaded — PO-2026-008412.pdf (214 KB)",
  },
  {
    id: "e4",
    ts: "14:08:33",
    crossingId: "wmt341",
    po: "WMT-2026-0341",
    buyer: "Westmark Tools",
    supplier: "Acme Components",
    fmt: "EMAIL",
    event: "crossed",
    actor: { initials: "MK", name: "Marius Klein", type: "user" },
    message: "Crossed successfully — cXML delivered to Acme ERP endpoint",
    detail: "HTTP 200. Transmission time 1.2s. ACK received.",
  },
  {
    id: "e5",
    ts: "14:07:44",
    crossingId: "wmt341",
    po: "WMT-2026-0341",
    buyer: "Westmark Tools",
    supplier: "Acme Components",
    fmt: "EMAIL",
    event: "reviewed",
    actor: { initials: "MK", name: "Marius Klein", type: "user" },
    message: "Approved for crossing after manual review",
  },
  {
    id: "e6",
    ts: "13:54:12",
    crossingId: "850201",
    po: "850-99201",
    buyer: "Centralis Pharma",
    supplier: "MedicaSupply OY",
    fmt: "EDI",
    event: "failed",
    actor: { initials: "SY", name: "Bridge system", type: "system" },
    message: "Delivery attempt failed — endpoint timeout (30s)",
    detail: "MedicaSupply OY cXML endpoint returned HTTP 504. Will retry in 15 min.",
  },
  {
    id: "e7",
    ts: "13:39:20",
    crossingId: "850201",
    po: "850-99201",
    buyer: "Centralis Pharma",
    supplier: "MedicaSupply OY",
    fmt: "EDI",
    event: "mapped",
    actor: { initials: "AI", name: "Mapping engine", type: "ai" },
    message: "18 codes mapped · 6 low-confidence matches",
    diff: [
      { field: "line[3].supplierCode", from: "CPH-SYRG-10", to: "MDS-SY-10-STERILE (72%)" },
      { field: "line[7].supplierCode", from: "CPH-GLOVE-L", to: "MDS-GL-L-NITRILE (68%)" },
    ],
  },
  {
    id: "e8",
    ts: "13:38:05",
    crossingId: "850201",
    po: "850-99201",
    buyer: "Centralis Pharma",
    supplier: "MedicaSupply OY",
    fmt: "EDI",
    event: "extracted",
    actor: { initials: "AI", name: "Extraction engine", type: "ai" },
    message: "18 line items extracted from EDI 850 segment",
  },
  {
    id: "e9",
    ts: "13:37:48",
    crossingId: "850201",
    po: "850-99201",
    buyer: "Centralis Pharma",
    supplier: "MedicaSupply OY",
    fmt: "EDI",
    event: "uploaded",
    actor: { initials: "JT", name: "Julia Torres", type: "user" },
    message: "EDI 850 received via API connector · auto-routed to MedicaSupply OY",
  },
  {
    id: "e10",
    ts: "12:01:44",
    crossingId: "nrd967",
    po: "PO-NRD-9967",
    buyer: "Nordmark Logistics",
    supplier: "VanDerBerg Metaal",
    fmt: "cXML",
    event: "crossed",
    actor: { initials: "EL", name: "Erik Larsen", type: "user" },
    message: "Crossed successfully — cXML delivered",
  },
  {
    id: "e11",
    ts: "11:58:31",
    crossingId: "nrd967",
    po: "PO-NRD-9967",
    buyer: "Nordmark Logistics",
    supplier: "VanDerBerg Metaal",
    fmt: "cXML",
    event: "validated",
    actor: { initials: "SY", name: "Bridge system", type: "system" },
    message: "All 5 lines passed validation · no issues",
  },
];

// ─── Event visual config ──────────────────────────────────────────────────────

const EV: Record<EventType, { dot: string; label: string; icon: string }> = {
  uploaded:  { dot: "#1E66C9", label: "Uploaded",  icon: "↑" },
  extracted: { dot: "#6F4FCE", label: "Extracted", icon: "✦" },
  mapped:    { dot: "#C97A14", label: "Mapped",    icon: "⇄" },
  validated: { dot: "#2E8E3A", label: "Validated", icon: "✓" },
  flagged:   { dot: "#C97A14", label: "Flagged",   icon: "⚠" },
  reviewed:  { dot: "#0F4FA8", label: "Reviewed",  icon: "◎" },
  crossed:   { dot: "#2E8E3A", label: "Crossed",   icon: "⇉" },
  failed:    { dot: "#C53A3A", label: "Failed",    icon: "✕" },
  retried:   { dot: "#C97A14", label: "Retried",   icon: "↺" },
};

const ACTOR_BG: Record<"user" | "system" | "ai", string> = {
  user:   "#1E66C9",
  system: "#56627A",
  ai:     "#6F4FCE",
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function CrossingsLog() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [evFilter, setEvFilter] = useState<EventType | "All">("All");
  const [search, setSearch]     = useState("");

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  const filtered = LOG.filter((e) => {
    const mev = evFilter === "All" || e.event === evFilter;
    const q   = search.toLowerCase();
    const ms  = !q || e.po.toLowerCase().includes(q) || e.buyer.toLowerCase().includes(q) || e.supplier.toLowerCase().includes(q);
    return mev && ms;
  });

  // Group by date (mock: all today)
  const date = "Today · 24 May 2026";

  return (
    <div
      className="flex flex-col h-full min-h-0 overflow-hidden"
      style={{ background: "#F6F7FA" }}
    >
      {/* Page header */}
      <div
        className="flex items-end gap-4 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              color: "#0B1A2F",
            }}
          >
            Crossings Log
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            Append-only audit trail · {LOG.length} events today
          </p>
        </div>
        <div className="ml-auto">
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{
              height: 32,
              border: "1px solid #E2E6EE",
              background: "#FFFFFF",
              color: "#0B1A2F",
            }}
          >
            ↓ Export log
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex items-center gap-2 px-5 flex-shrink-0"
        style={{
          height: 50,
          borderBottom: "1px solid #E2E6EE",
          background: "#FFFFFF",
        }}
      >
        {/* Search */}
        <div className="relative" style={{ width: 280 }}>
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px]"
            style={{ color: "#8A93A5" }}
          >
            ⌕
          </span>
          <input
            type="text"
            placeholder="Search by PO, buyer, or supplier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[6px] pl-8 pr-3 text-[12.5px]"
            style={{
              height: 32,
              border: "1px solid #E2E6EE",
              background: "#F6F7FA",
              color: "#0B1A2F",
              outline: "none",
            }}
          />
        </div>

        <div className="flex-1" />

        {/* Event type chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["All", "uploaded", "extracted", "mapped", "validated", "flagged", "crossed", "failed"] as const).map(
            (ev) => {
              const active = evFilter === ev;
              const cfg = ev !== "All" ? EV[ev] : null;
              return (
                <button
                  key={ev}
                  onClick={() => setEvFilter(ev)}
                  className="flex items-center gap-1 rounded-[5px] px-2.5 text-[11.5px] font-medium transition-colors"
                  style={{
                    height: 26,
                    border: `1px solid ${active && cfg ? `${cfg.dot}44` : "#E2E6EE"}`,
                    background: active && cfg ? `${cfg.dot}15` : active ? "#E3EDFB" : "#FFFFFF",
                    color: active && cfg ? cfg.dot : active ? "#0F4FA8" : "#56627A",
                  }}
                >
                  {cfg && <span>{cfg.icon}</span>}
                  <span className="capitalize">{ev}</span>
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Date group header */}
        <div className="flex items-center gap-3 mb-4">
          <span
            className="text-[11px] font-bold uppercase tracking-[0.06em]"
            style={{ color: "#8A93A5" }}
          >
            {date}
          </span>
          <div style={{ flex: 1, height: 1, background: "#E2E6EE" }} />
        </div>

        <div className="flex flex-col gap-0 relative">
          {/* Vertical timeline spine */}
          <div
            style={{
              position: "absolute",
              left: 19,
              top: 8,
              bottom: 8,
              width: 1,
              background: "#E2E6EE",
              zIndex: 0,
            }}
          />

          {filtered.map((entry) => {
            const ev   = EV[entry.event];
            const open = expanded.has(entry.id);
            const hasDiff = !!entry.diff?.length;
            const hasDetail = !!entry.detail;

            return (
              <div key={entry.id} className="flex gap-4 relative" style={{ paddingBottom: 20 }}>
                {/* Timeline dot */}
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: ev.dot,
                    border: `2px solid ${ev.dot}`,
                    flexShrink: 0,
                    marginTop: 5,
                    position: "relative",
                    zIndex: 1,
                    boxShadow: `0 0 0 3px ${ev.dot}22`,
                  }}
                />

                {/* Card */}
                <div
                  className="flex-1 min-w-0 rounded-[8px] overflow-hidden"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #E2E6EE",
                    boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
                  }}
                >
                  {/* Main row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3"
                    style={{
                      cursor: hasDetail || hasDiff ? "pointer" : undefined,
                    }}
                    onClick={() => (hasDetail || hasDiff) && toggle(entry.id)}
                  >
                    {/* Timestamp */}
                    <span
                      className="font-mono text-[11px] flex-shrink-0"
                      style={{ color: "#8A93A5", width: 64 }}
                    >
                      {entry.ts}
                    </span>

                    {/* Event badge */}
                    <span
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-semibold flex-shrink-0"
                      style={{
                        background: `${ev.dot}18`,
                        color: ev.dot,
                        minWidth: 78,
                        justifyContent: "center",
                      }}
                    >
                      <span>{ev.icon}</span>
                      {ev.label}
                    </span>

                    {/* PO link */}
                    <span
                      className="font-mono text-[11.5px] font-medium flex-shrink-0"
                      style={{ color: "#0F4FA8" }}
                    >
                      {entry.po}
                    </span>

                    {/* Format chip */}
                    <FileChip type={entry.fmt} />

                    {/* Buyer → Supplier */}
                    <span
                      className="text-[12px] flex-shrink-0"
                      style={{ color: "#1E66C9" }}
                    >
                      {entry.buyer}
                    </span>
                    <span style={{ color: "#C6CDDA", fontSize: 11 }}>→</span>
                    <span
                      className="text-[12px] flex-shrink-0"
                      style={{ color: "#2E8E3A" }}
                    >
                      {entry.supplier}
                    </span>

                    <div className="flex-1" />

                    {/* Message */}
                    <span
                      className="text-[12px] text-right truncate"
                      style={{ color: "#56627A", maxWidth: 240 }}
                    >
                      {entry.message}
                    </span>

                    {/* Actor badge */}
                    <div
                      className="flex items-center justify-center rounded-full text-[10px] font-bold text-white flex-shrink-0"
                      style={{
                        width: 26,
                        height: 26,
                        background: ACTOR_BG[entry.actor.type],
                      }}
                      title={entry.actor.name}
                    >
                      {entry.actor.initials}
                    </div>

                    {/* Expand chevron */}
                    {(hasDetail || hasDiff) && (
                      <span
                        style={{
                          color: "#C6CDDA",
                          fontSize: 11,
                          transform: open ? "rotate(180deg)" : undefined,
                          transition: "transform 0.15s",
                          flexShrink: 0,
                        }}
                      >
                        ⌄
                      </span>
                    )}
                  </div>

                  {/* Expanded panel */}
                  {open && (
                    <div
                      style={{
                        borderTop: "1px solid #E2E6EE",
                        padding: "12px 16px",
                        background: "#F6F7FA",
                      }}
                    >
                      {entry.detail && (
                        <p
                          className="text-[12px] mb-3 leading-relaxed"
                          style={{ color: "#56627A" }}
                        >
                          {entry.detail}
                        </p>
                      )}

                      {hasDiff && (
                        <div>
                          <p
                            className="text-[10.5px] font-semibold uppercase tracking-[0.06em] mb-2"
                            style={{ color: "#8A93A5" }}
                          >
                            Field changes
                          </p>
                          <div
                            className="rounded-[6px] overflow-hidden font-mono text-[11.5px]"
                            style={{ border: "1px solid #E2E6EE" }}
                          >
                            {entry.diff!.map((d, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-3 px-3 py-2"
                                style={{
                                  background: i % 2 === 0 ? "#FFFFFF" : "#F6F7FA",
                                  borderBottom:
                                    i < entry.diff!.length - 1
                                      ? "1px solid #F0F2F6"
                                      : undefined,
                                }}
                              >
                                <span
                                  style={{ color: "#0F4FA8", minWidth: 200 }}
                                >
                                  {d.field}
                                </span>
                                <span style={{ color: "#C53A3A" }}>{d.from}</span>
                                <span style={{ color: "#C6CDDA" }}>→</span>
                                <span style={{ color: "#2E8E3A" }}>{d.to}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div
              className="flex flex-col items-center justify-center py-16"
              style={{ color: "#8A93A5" }}
            >
              <span style={{ fontSize: 32, marginBottom: 8 }}>⊘</span>
              <p className="text-[13px]">No log entries match your filter</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
