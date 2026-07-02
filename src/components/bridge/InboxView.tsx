"use client";

// Inbox — TanStack Table order queue
// Sort on every column header · filter chips by status · bulk-select rows
// Click a row → /inbox/[orderId] (Canonical Spine Review)

import { useRouter } from "next/navigation";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useSampleOrder } from "@/hooks/useSampleOrder";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { OrderSummary, OrderStatus } from "@/types/procurement";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
  type VisibilityState,
  type RowData,
} from "@tanstack/react-table";
import { FileChip } from "./FileChip";
import { PageHeader } from "./layout/PageHeader";
import { PageShell } from "./layout/PageShell";
import { StatusJourney, type CrossingStatus, type OrderStage } from "./StatusJourney";
import { UnifiedStatusBadge } from "@/components/bridge/UnifiedStatusBadge";
import { tv2DotColor } from "@/components/bridge/layout/listTableV2";
import { useOrderDirection, type PartyLabels } from "@/hooks/useOrderDirection";
import { formatBulkSendResult, isRedeliverable, shouldShowBulkBar, type BulkSendResult } from "./inboxSend";

// Per-column metadata. `numeric` right-aligns value cells; `label` is the
// human-readable name shown in the desktop "Columns" visibility menu (the raw
// header for hideable columns is a plain string, but display columns have no
// string header, so we carry an explicit label).
declare module "@tanstack/react-table" {
  // TData/TValue mirror react-table's own ColumnMeta signature; they're part of
  // the augmented interface contract even though this app doesn't reference them.
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean;
    label?: string;
  }
}

// ─── Accent palette ─────────────────────────────────────────────────────────────
// Bridge Layer semantic palette (mirrors --brand-* / chrome in globals.css):
//   BLUE  = primary action + buyer side + the "active / in-progress" pipeline node
//   GREEN = supplier side + "done" pipeline node
//   NAVY  = display ink (PO numbers, page title, chips chrome)
// Kept as local consts so every inline style swaps from one place.
const BLUE       = "#1E66C9"; // --brand-blue        (primary action)
const BLUE_DEEP  = "#0F4FA8"; // --brand-blue-deep   (hover / buyer text)
const GREEN_DEEP = "#1E6D29"; // --brand-green-deep  (supplier text)
const NAVY       = "#0B1A2F"; // --ink / --navy      (display ink)
const INK        = NAVY;      // alias kept for existing references

// ─── Pipeline stage mapping ─────────────────────────────────────────────────────
// STATUS column → soft pill via the ported .pill / .pill-* classes (leading dot +
// full semantic label). PIPELINE column → standalone 5-node .journey.compact track.
// `key` maps each CrossingStatus onto its globals.css .pill-* / status class.
// NOTE: this is the single source of truth for order-status DISPLAY LABELS in the
// inbox. It should later consolidate into the canonical map in
// src/components/bridge/UnifiedStatusBadge.tsx (STATUS_META), which keys on raw
// backend OrderStatus rather than the collapsed CrossingStatus used here — keep
// the label vocabulary in sync until then.
//   - `ready`      → "Normalized": parsed/normalized but NOT yet transformed
//                    (Parse→Normalize→Validate→[Transform]→Deliver, stage 3).
//                    Deliberately NOT "Ready"/"Ready to send" so a row badge can't be
//                    misread next to the "Ready to send" chip (which counts the
//                    post-transform `ready_to_deliver` status only).
//   - `delivering` → carries the post-transform backend `ready_to_deliver` status
//                    (see mapStatus) and is labelled "Ready to send" — identical
//                    vocabulary to the "Ready to send" chip, so badge and chip agree.
const STATUS_PRESENTATION: Record<
  CrossingStatus,
  { key: string; label: string; stage: OrderStage }
> = {
  new:        { key: "new",        label: "New",            stage: 0 },
  extracting: { key: "extracting", label: "Extracting",     stage: 1 },
  review:     { key: "review",     label: "Needs review",   stage: 2 },
  ready:      { key: "ready",      label: "Normalized",     stage: 3 },
  sent:       { key: "sent",       label: "Delivered",      stage: 4 },
  delivering: { key: "delivering", label: "Ready to send",  stage: 4 },
  failed:     { key: "failed",     label: "Failed",         stage: "failed" },
};

// Soft rounded pill with leading colored dot — renders the ported .pill / .pill-*
// design classes so colours/spacing track tokens.css exactly.
function StatusDotPill({ status }: { status: CrossingStatus; compact?: boolean }) {
  const p = STATUS_PRESENTATION[status];
  return (
    <span className={`pill pill-${p.key}`}>
      <span className="dot" />
      {p.label}
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string;
  status: CrossingStatus;
  /**
   * RAW backend OrderStatus (e.g. "ready_to_deliver", "delivery_failed",
   * "transform_failed"). Drives ACTION gating — the collapsed display
   * `status` above folds five failure statuses into one "failed" pill, so it
   * cannot tell a redeliverable delivery_failed from a non-redeliverable
   * parse/transform failure (see isRedeliverable in ./inboxSend).
   */
  rawStatus: string;
  fmt: string;
  buyer: string;
  supplier: string;
  po: string;
  lines: number;
  value: number;      // raw number for sorting
  valueLabel: string; // formatted display
  issues: number;
  assigned: string;
  age: string;
  ageMin: number;     // minutes, for sorting
};

// ─── Data generation ──────────────────────────────────────────────────────────

const STATUSES: CrossingStatus[] = ["new", "extracting", "review", "ready", "sent", "failed"];
const FMTS     = ["PDF", "cXML", "XLSX", "EDI", "EMAIL", "API", "CSV"] as const;
const BUYERS   = [
  "Heinrich Industries GmbH", "Nordmark Logistics A/S", "Steelhouse Construction",
  "Centralis Pharma", "Westmark Tools", "Atlas Reseller AG", "Bauer Medizintechnik",
  "OmniRetail GmbH", "ThermoBloc AS", "MassBuild Ltd.",
];
const SUPPLIERS = [
  "Acme Components Ltd.", "BoltWorks BV", "VanDerBerg Metaal", "MedicaSupply OY",
  "Nordix Distribution", "PrimeParts GmbH", "OrthoTech AS", "SteelCore BV",
];
const ASSIGNEES = ["MK", "JT", "EL", "SH", "—"];

function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }

function fmtAge(min: number) {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

// Mock-only: a representative raw backend status per display status so the
// deliverable-row gating behaves realistically in demo mode (mock "failed"
// rows act like delivery_failed, which IS redeliverable; "delivering" carries
// ready_to_deliver — see mapStatus below).
const MOCK_RAW_STATUS: Record<CrossingStatus, string> = {
  new:        "pending_parse",
  extracting: "parsing",
  review:     "pending_review",
  ready:      "ready",
  sent:       "delivered",
  delivering: "ready_to_deliver",
  failed:     "delivery_failed",
};

function generateOrders(count: number): OrderRow[] {
  const rows: OrderRow[] = [];
  // Seed with the original 12 hand-crafted rows first
  const SEED: Array<Omit<OrderRow, "ageMin" | "rawStatus">> = [
    { id: "demo-001",  status: "review",     fmt: "PDF",   buyer: BUYERS[0], supplier: SUPPLIERS[0], po: "PO-DEMO-001",  lines: 14, value: 24180.50, valueLabel: "€ 24,180.50", issues: 3, assigned: "MK", age: "2m"  },
    { id: "nrd9981", status: "new",        fmt: "cXML",  buyer: BUYERS[1], supplier: SUPPLIERS[1], po: "PO-NRD-9981",     lines:  7, value:  8420.00, valueLabel: "€  8,420.00", issues: 0, assigned: "—",  age: "4m"  },
    { id: "sh44120", status: "extracting", fmt: "XLSX",  buyer: BUYERS[2], supplier: SUPPLIERS[2], po: "SH-PO-44120",     lines: 32, value: 71205.18, valueLabel: "€ 71,205.18", issues: 0, assigned: "—",  age: "6m"  },
    { id: "850201",  status: "failed",     fmt: "EDI",   buyer: BUYERS[3], supplier: SUPPLIERS[3], po: "850-99201",       lines: 18, value: 12408.00, valueLabel: "€ 12,408.00", issues: 6, assigned: "JT", age: "14m" },
    { id: "wmt341",  status: "ready",      fmt: "EMAIL", buyer: BUYERS[4], supplier: SUPPLIERS[0], po: "WMT-2026-0341",   lines:  4, value:  1920.40, valueLabel: "€  1,920.40", issues: 0, assigned: "MK", age: "22m" },
    { id: "008411",  status: "sent",       fmt: "PDF",   buyer: BUYERS[0], supplier: SUPPLIERS[1], po: "PO-2026-008411",  lines: 11, value:  5612.00, valueLabel: "€  5,612.00", issues: 0, assigned: "MK", age: "1h"  },
    { id: "ar1107",  status: "review",     fmt: "XLSX",  buyer: BUYERS[5], supplier: SUPPLIERS[4], po: "AR-2026-1107",    lines:  9, value: 14290.00, valueLabel: "€ 14,290.00", issues: 1, assigned: "JT", age: "1h"  },
    { id: "bmt720",  status: "review",     fmt: "CSV",   buyer: BUYERS[6], supplier: SUPPLIERS[3], po: "BMT-PO-7720",     lines: 22, value: 38710.20, valueLabel: "€ 38,710.20", issues: 2, assigned: "—",  age: "2h"  },
    { id: "nrd967",  status: "sent",       fmt: "cXML",  buyer: BUYERS[1], supplier: SUPPLIERS[2], po: "PO-NRD-9967",     lines:  5, value:  3408.00, valueLabel: "€  3,408.00", issues: 0, assigned: "EL", age: "2h"  },
    { id: "sh4118",  status: "ready",      fmt: "API",   buyer: BUYERS[2], supplier: SUPPLIERS[1], po: "SH-PO-44118",     lines: 16, value: 19860.00, valueLabel: "€ 19,860.00", issues: 0, assigned: "MK", age: "3h"  },
    { id: "ar1104",  status: "failed",     fmt: "PDF",   buyer: BUYERS[5], supplier: SUPPLIERS[0], po: "AR-2026-1104",    lines: 28, value: 41205.50, valueLabel: "€ 41,205.50", issues: 5, assigned: "EL", age: "3h"  },
    { id: "850198",  status: "sent",       fmt: "EDI",   buyer: BUYERS[3], supplier: SUPPLIERS[4], po: "850-99198",       lines: 12, value:  9114.40, valueLabel: "€  9,114.40", issues: 0, assigned: "JT", age: "4h"  },
  ];
  SEED.forEach((s) => rows.push({ ...s, rawStatus: MOCK_RAW_STATUS[s.status], ageMin: s.age.endsWith("d") ? parseInt(s.age)*1440 : s.age.endsWith("h") ? parseInt(s.age)*60 : parseInt(s.age) }));

  // Generate remaining rows procedurally
  for (let i = rows.length; i < count; i++) {
    const si = i % STATUSES.length;
    const bi = (i * 7 + si) % BUYERS.length;
    const supi = (i * 3 + bi) % SUPPLIERS.length;
    const ageMin = 5 + (i * 13) % (60 * 72);
    const val = 500 + (i * 1237 + 189) % 98000;
    const valCents = val + ((i * 17) % 100) / 100;
    const lines = 2 + (i * 5) % 48;
    const issues = si === STATUSES.indexOf("failed") ? 1 + (i % 6)
                 : si === STATUSES.indexOf("review")  ? (i % 3)
                 : 0;
    const poNum = 100000 + i;
    const assigned = ASSIGNEES[(i * 3) % ASSIGNEES.length];
    const fmt = FMTS[(i * 2) % FMTS.length];
    rows.push({
      id: `gen-${pad(i, 6)}`,
      status: STATUSES[si],
      rawStatus: MOCK_RAW_STATUS[STATUSES[si]],
      fmt,
      buyer: BUYERS[bi],
      supplier: SUPPLIERS[supi],
      po: `PO-2026-${poNum}`,
      lines,
      value: valCents,
      valueLabel: `€ ${valCents.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`,
      issues,
      assigned,
      age: fmtAge(ageMin),
      ageMin,
    });
  }
  return rows;
}

// ─── API status mapping ───────────────────────────────────────────────────────

// Backend `ready` and `ready_to_deliver` are DIFFERENT pipeline stages and must
// NOT collapse to one display status, or the row badge contradicts the chips:
//   - `ready`            = parsed/normalized, NOT yet transformed (pre-Transform).
//                          Rendered as "Normalized" so it never reads as "Ready to send".
//   - `ready_to_deliver` = post-transform, genuinely ready to send to the supplier.
//                          Rendered as "Ready to send" — the SAME vocabulary as the
//                          "Ready to send" filter chip (which counts ready_to_deliver).
// We reuse the `delivering` CrossingStatus slot (stage 4, distinct blue pill) for
// `ready_to_deliver`; no persisted `delivering` status exists upstream, so this slot
// was otherwise unused. Counting logic / summaryKeys are unchanged — labels only.
function mapStatus(s: string): CrossingStatus {
  if (s === "pending_review") return "review";
  if (s === "parsing" || s === "transforming") return "extracting";
  if (s === "ready_to_deliver") return "delivering";
  if (s === "ready") return "ready";
  if (s === "delivered") return "sent";
  if (s === "delivery_failed" || s === "failed" || s === "transform_failed") return "failed";
  return "new";
}

function summaryToRow(o: OrderSummary): OrderRow {
  const ageMin = Math.max(0, Math.round((Date.now() - new Date(o.createdAt).getTime()) / 60000));
  const fmt =
    o.sourceFormat === "pdf" ? "PDF" :
    o.sourceFormat === "csv" ? "CSV" :
    o.sourceFormat === "xlsx" || o.sourceFormat === "xls" ? "XLSX" :
    o.sourceFormat === "cxml" ? "cXML" :
    o.sourceFormat === "edi" ? "EDI" :
    "API";
  const value = o.totalValue ?? 0;
  const currency = o.currency ?? "EUR";
  const valueLabel = `${currency} ${value.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`;
  return {
    id: o.id,
    status: mapStatus(o.status),
    rawStatus: o.status,
    fmt,
    buyer: o.buyerName ?? "—",
    supplier: o.supplierName,
    po: o.poNumber,
    lines: o.lineCount,
    value,
    valueLabel,
    issues: o.unresolvedCount,
    assigned: "—",
    age: fmtAge(ageMin),
    ageMin,
  };
}

// ─── Status buckets for live action counts ──────────────────────────────────────
// The red "Failed" pill collapses FIVE backend statuses into one (mapStatus above
// folds them all to CrossingStatus "failed"). The live `GET /api/orders/summary`
// returns raw per-OrderStatus counts in `byStatus`, so to surface the same count
// the pill represents we must sum the whole failure bucket. "Needs review" maps to
// the single backend `pending_review` status. Any status absent from byStatus is
// treated as 0 (byStatus is Partial<Record<OrderStatus, number>>).
const FAILED_BUCKET: OrderStatus[] = [
  "failed",
  "transform_failed",
  "delivery_failed",
  "delivery_dead_letter",
  "rejected_by_supplier",
];

function sumStatuses(
  byStatus: Partial<Record<OrderStatus, number>> | undefined,
  keys: OrderStatus[],
): number {
  if (!byStatus) return 0;
  return keys.reduce((acc, k) => acc + (byStatus[k] ?? 0), 0);
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

// `status` drives mock-mode client-side column filtering (CrossingStatus);
// `api` is the backend OrderStatus passed to the live ?status= query param.
// Each chip's `status` (mock client-side CrossingStatus filter) and `api`
// (live ?status= OrderStatus) must resolve to the rows its label promises.
// "Ready to send" filters the backend `ready_to_deliver` status — which mapStatus
// now folds into the `delivering` CrossingStatus slot (labelled "Ready to send"),
// NOT the `ready` slot (labelled "Normalized" — parsed/normalized, pre-transform).
// Using "ready" here would make the chip filter rows that no longer match its
// label. (summaryKeys / api are unchanged: counts still roll up ready_to_deliver.)
// Failure handling is bucketed client-side over all failure statuses (see
// matchesChip) because the red "Failed" pill collapses five backend statuses;
// the live `api: "failed"` value is the closest single server filter (the
// remaining failure statuses are folded in client-side).
// `summaryKeys` lists the backend OrderStatus values whose `byStatus` counts roll
// up into this chip's badge. It is intentionally DECOUPLED from `api` (the single
// server `?status=` filter value): the "Failed" pill collapses five statuses, so
// its badge sums the whole FAILED_BUCKET even though the live filter passes only
// "failed". Chips with no `summaryKeys` (All orders) show the summary `total`.
const FILTER_CHIPS: Array<{
  label: string;
  status?: CrossingStatus;
  api?: OrderStatus;
  summaryKeys?: OrderStatus[];
}> = [
  { label: "All orders" },
  { label: "Needs review",  status: "review", api: "pending_review",   summaryKeys: ["pending_review"]   },
  { label: "Ready to send", status: "delivering", api: "ready_to_deliver", summaryKeys: ["ready_to_deliver"] },
  { label: "Delivered",     status: "sent",   api: "delivered",        summaryKeys: ["delivered"]        },
  { label: "Failed",        status: "failed", api: "failed",           summaryKeys: FAILED_BUCKET        },
];

// ─── Column helper ────────────────────────────────────────────────────────────

const columnHelper = createColumnHelper<OrderRow>();

// Columns depend on the org's direction labels (rail header + unknown-buyer
// fallback), so they're built per-render via useMemo([labels]) inside the
// component rather than living at module scope. getRowId still keys on order id,
// so row stability / selection behaviour is unchanged.
function buildColumns(labels: PartyLabels) {
  return [
  // Checkbox select — selection feeds ONLY the "Send selected" bulk action
  // (POST /redeliver), which the backend accepts from ready_to_deliver /
  // delivery_failed alone. Rows in any other status are NOT selectable
  // (enableRowSelection gates on isRedeliverable in the table options), so
  // "Send selected" can never fire a guaranteed-400 request. TanStack's
  // select-all helpers respect getCanSelect(), so the header checkbox keeps
  // working on filtered views and selects only the sendable rows.
  columnHelper.display({
    id: "select",
    enableHiding: false,
    header: ({ table }) => {
      // Only ready_to_deliver / delivery_failed rows are selectable (enableRowSelection gate). On a
      // view with none (e.g. "All orders" showing only Normalized / Needs review), select-all would
      // select nothing and look DEAD. Disable it + say why, so the click isn't a silent no-op.
      const selectable = table.getRowModel().rows.filter((r) => r.getCanSelect()).length;
      const none = selectable === 0;
      return (
        <input
          type="checkbox"
          disabled={none}
          style={{ accentColor: BLUE, cursor: none ? "not-allowed" : "pointer", width: 13, height: 13, opacity: none ? 0.4 : 1 }}
          checked={!none && table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          aria-label={none ? "No sendable orders on this view" : "Select all sendable orders"}
          title={none
            ? "No orders here can be sent. Switch to the “Ready to send” or “Failed” tab to select orders to deliver."
            : "Selects orders that can be sent (Ready to send or Failed delivery)"}
        />
      );
    },
    cell: ({ row }) => {
      const canSelect = row.getCanSelect();
      return (
        <input
          type="checkbox"
          style={{
            accentColor: BLUE,
            cursor: canSelect ? "pointer" : "not-allowed",
            width: 13,
            height: 13,
            opacity: canSelect ? 1 : 0.35,
          }}
          checked={row.getIsSelected()}
          disabled={!canSelect}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          aria-label={
            canSelect
              ? "Select row"
              : "Can't select — only orders that are Ready to send or have a failed delivery can be sent"
          }
          title={
            canSelect
              ? undefined
              : "Only orders that are Ready to send or have a failed delivery can be sent"
          }
        />
      );
    },
    size: 36,
  }),
  // Order column: PO# + lines/exceptions
  columnHelper.accessor("po", {
    header: "Order",
    enableHiding: false,
    // v2 leading status dot: a small dot coloured by the row's status tone
    // (via tv2DotColor on the raw backend status) leads the PO# — dot + word,
    // where the word is the Status column's UnifiedStatusBadge. Colour always
    // agrees with that badge because both derive from the same status→tone map.
    cell: (info) => (
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: tv2DotColor(info.row.original.rawStatus),
            flexShrink: 0,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span
            className="font-mono text-[12px] font-semibold tabular-nums"
            style={{ color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {info.getValue()}
          </span>
          <div className="text-[11px]" style={{ color: "#5E6779" }}>
            {info.row.original.lines} lines{info.row.original.issues > 0 ? ` · ${info.row.original.issues} to review` : ""}
          </div>
        </div>
      </div>
    ),
    size: 188,
  }),
  // Buyer → Supplier (or Customer → You in inbound mode)
  columnHelper.display({
    id: "lane",
    enableHiding: false,
    header: labels.railHeader,
    cell: ({ row }) => {
      const buyer = row.original.buyer;
      const hasBuyer = buyer != null && buyer.trim() !== "" && buyer.trim() !== "—";
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "12.5px" }}>
          <span style={{ color: hasBuyer ? BLUE_DEEP : "var(--ink-faint)", fontWeight: hasBuyer ? 500 : 400, flex: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}>
            {hasBuyer ? buyer : labels.unknownBuyer}
          </span>
          <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>→</span>
          <span style={{ color: GREEN_DEEP, fontWeight: 500, flex: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}>
            {row.original.supplier}
          </span>
        </div>
      );
    },
    size: 320,
  }),
  columnHelper.accessor("fmt", {
    header: "Source",
    cell: (info) => <FileChip type={info.getValue()} />,
    meta: { label: "Source" },
    size: 72,
  }),
  columnHelper.accessor("value", {
    header: "Value",
    cell: (info) => (
      <span className="font-mono text-[12.5px] font-semibold tabular-nums" style={{ color: "#0B1A2F" }}>
        {info.row.original.valueLabel}
      </span>
    ),
    meta: { numeric: true, label: "Value" },
    size: 110,
  }),
  // Pipeline — standalone 5-node track (status pill lives in its own column)
  columnHelper.accessor("status", {
    header: "Pipeline",
    cell: (info) => (
      <div style={{ minWidth: 132, maxWidth: 176 }}>
        <StatusJourney stage={STATUS_PRESENTATION[info.getValue()].stage} compact />
      </div>
    ),
    meta: { label: "Pipeline" },
    size: 184,
  }),
  // Status pill — soft rounded-full pill with leading dot + full semantic label
  columnHelper.display({
    id: "statusPill",
    enableHiding: false,
    header: "Status",
    // Canonical status pill — one shape/size/padding, Lucide icon + word per tone.
    // Keyed on the RAW backend OrderStatus so it can tell `ready` ("Normalized")
    // apart from `ready_to_deliver` ("Ready to send") — the collapsed display
    // `status` can't (see UnifiedStatusBadge / STATUS_META).
    cell: ({ row }) => <UnifiedStatusBadge status={row.original.rawStatus} icon />,
    size: 124,
  }),
  columnHelper.accessor("ageMin", {
    header: "Updated",
    cell: (info) => <span style={{ color: "#5E6779", fontSize: "12px" }}>{info.row.original.age} ago</span>,
    meta: { label: "Updated" },
    size: 72,
  }),
  // Chevron
  columnHelper.display({
    id: "chevron",
    enableHiding: false,
    header: "",
    cell: () => <span style={{ color: "var(--ink-faint)", fontSize: "15px" }}>›</span>,
    size: 30,
  }),
  ];
}

// ─── Sort indicator ───────────────────────────────────────────────────────────

function SortIcon({ state }: { state: "asc" | "desc" | false }) {
  return (
    <span style={{ fontSize: 10, color: state ? BLUE_DEEP : "#CBD0DA", marginLeft: 4, userSelect: "none" }}>
      {state === "asc" ? "↑" : state === "desc" ? "↓" : "⇅"}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// Mock mode: use a static generated set (50 rows)
const MOCK_ORDERS = isApiMockMode ? generateOrders(50) : [];

const PAGE_SIZE = 25;

export function InboxView() {
  const router = useRouter();
  const queryEnabled = useQueriesEnabled();
  const { direction, labels } = useOrderDirection();
  // Columns depend only on direction labels — memoise so react-table receives a
  // stable reference (rebuilt only when the org's direction changes).
  const columns = useMemo(() => buildColumns(labels), [labels]);
  // Empty-state copy: outbound orders arrive from buyers; inbound from customers.
  // Shown only in the genuinely-empty (no filter active) branch — the filtered
  // zero-result branch has its own "No matching orders" copy, so don't open
  // with "No orders match this filter." here.
  const emptyStateCopy =
    direction === "inbound"
      ? "New orders land here automatically as customers send them, or upload one yourself."
      : "New orders land here automatically as buyers send them, or upload one yourself.";
  // Practice-order CTA for the GENUINE empty state (task 9) — shared hook so
  // analytics/invalidation/routing match every other sample entry point.
  const sample = useSampleOrder("/inbox");
  const [sorting, setSorting]           = useState<SortingState>([{ id: "ageMin", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Column visibility — session-only (no localStorage). Empty = all visible.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnsMenuOpen, setColumnsMenuOpen]   = useState(false);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  // Keyboard row navigation (desktop): j/ArrowDown + k/ArrowUp move a row
  // highlight, Enter opens it. -1 = no active row. The desktop table body is
  // reffed so the active row can be scrolled into view as it moves.
  const [activeRow, setActiveRow] = useState(-1);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const [activeChip, setActiveChip]     = useState(0); // index into FILTER_CHIPS
  const [searchInput, setSearchInput]   = useState(""); // controlled search-box value
  const [search, setSearch]             = useState(""); // committed (debounced) server search
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>(undefined); // live ?status=
  const [page, setPage]                 = useState(1);  // 1-based page index
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bulk "Send selected" lifecycle: idle while no request is in flight, then a
  // visible pending → result feedback so the action is never a silent no-op.
  const [bulkSending, setBulkSending]   = useState(false);
  const [bulkResult, setBulkResult]     = useState<BulkSendResult | null>(null);

  const queryClient = useQueryClient();
  // Live (non-mock) path: the backend returns a paginated envelope and applies
  // status + search filters server-side. A distinct query key keeps this apart
  // from the lightweight ["orders"] working-set used by sidebar/topbar/dashboard.
  const { data: ordersPage, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["orders", "inbox", page, statusFilter ?? "", search],
    queryFn: () => apiClient.getOrders({
      page,
      pageSize: PAGE_SIZE,
      status: statusFilter,
      search: search || undefined,
    }),
    staleTime: 30_000,
    enabled: !isApiMockMode,
    placeholderData: (prev) => prev, // keep the current page visible while the next loads
  });

  // Action counts — the headline "what needs me?". `GET /api/orders/summary`
  // returns whole-account per-status counts (not just the current page/filter), so
  // the chip badges and header summary stay accurate regardless of pagination. This
  // runs in BOTH mock and live so paying customers see real counts (previously the
  // counts rendered only under isApiMockMode). Gated via useQueriesEnabled
  // (mock OR qa-bypass OR signed-in) — mock/qa-bypass have no Clerk session.
  const { data: summary } = useQuery({
    queryKey: ["orders", "summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    staleTime: 30_000,
    enabled: queryEnabled,
  });

  // Memoize so react-table receives a STABLE `data` reference across renders.
  // A bare `.map(summaryToRow)` would build a brand-new array on EVERY render. In
  // the live (non-mock) path the inbox is also subscribed to TanStack Query, so it
  // re-renders on query activity; each render handed react-table a fresh `data`
  // identity, which forced it to rebuild its row models and produce new derived
  // references, scheduling yet another render. Applying a status filter tipped this
  // into an unbounded re-render cascade that locked the main thread (the reported
  // hard freeze). Keying the memo on `ordersPage` keeps the reference stable until
  // the underlying query data actually changes.
  const ALL_ORDERS: OrderRow[] = useMemo(
    () => (isApiMockMode ? MOCK_ORDERS : (ordersPage?.items ?? []).map(summaryToRow)),
    [ordersPage],
  );

  // Status chip → mock filters the column client-side; live sets the server filter.
  const handleChip = useCallback((idx: number) => {
    setActiveChip(idx);
    setPage(1);
    setRowSelection({});
    const chip = FILTER_CHIPS[idx];
    if (isApiMockMode) {
      setColumnFilters(chip.status ? [{ id: "status", value: chip.status }] : []);
    } else {
      setStatusFilter(chip.api);
    }
  }, []);

  // Reset every active filter/search back to "All orders" with no query. Mirrors
  // handleChip(0) plus clearing both the controlled search input and the committed
  // (debounced) live search term. Used by the filter-aware empty state.
  const handleClearFilters = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setActiveChip(0);
    setColumnFilters([]);
    setStatusFilter(undefined);
    setSearchInput("");
    setSearch("");
    setPage(1);
    setRowSelection({});
  }, []);

  // Search box: mock filters instantly client-side; live debounces into a server query.
  // Clear any row selection on every search change (mirrors handleChip): search hides
  // non-matching rows, so a previously-selected row can scroll out of view yet stay
  // silently selected and get swept into a bulk action. Resetting keeps selection in
  // sync with what's actually visible.
  const handleSearch = useCallback((value: string) => {
    setSearchInput(value);
    setPage(1);
    setRowSelection({});
    if (isApiMockMode) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 350);
  }, []);

  // Bulk "Send selected": selection keys are order ids (see getRowId), and
  // selection is gated to redeliverable statuses (see enableRowSelection), so
  // every id here SHOULD be accepted — but the status can still change
  // server-side between render and click (or the request can fail), so each
  // re-deliver runs in parallel and failures are reported BY PO NUMBER with
  // the per-order reason instead of an opaque "N failed".
  const handleSendSelected = useCallback(async () => {
    const ids = Object.keys(rowSelection);
    if (!ids.length || bulkSending) return;
    setBulkSending(true);
    setBulkResult(null);
    // PO labels for failure reporting. Selection can outlive the loaded page
    // (page changes don't clear it), so fall back to a shortened order id for
    // rows no longer in the current data set.
    const poById = new Map(ALL_ORDERS.map((r) => [r.id, r.po]));
    try {
      // Route through apiClient.redeliverOrder so the Clerk auth header is
      // attached (a raw fetch here 401'd for real users). It resolves on
      // success and throws on failure — keep the error message, it carries
      // the backend's actual reason (e.g. the not-redeliverable-status 400).
      const results = await Promise.all(
        ids.map((id) =>
          apiClient
            .redeliverOrder(id)
            .then(() => ({ id, ok: true as const }))
            .catch((err: unknown) => ({
              id,
              ok: false as const,
              reason: err instanceof Error ? err.message : "Unknown error",
            })),
        ),
      );
      const failures = results
        .filter((r): r is { id: string; ok: false; reason: string } => !r.ok)
        .map((r) => ({ po: poById.get(r.id) ?? r.id.slice(0, 8), reason: r.reason }));
      const sent = results.length - failures.length;
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setBulkResult(formatBulkSendResult(sent, failures));
      // Keep ONLY the failed rows selected (so a retry can't re-send the
      // orders that already went out); clear entirely on full success.
      setRowSelection(
        Object.fromEntries(results.filter((r) => !r.ok).map((r) => [r.id, true])),
      );
    } catch {
      setBulkResult({ ok: false, text: "Send failed — please retry" });
    } finally {
      setBulkSending(false);
    }
  }, [rowSelection, bulkSending, queryClient, ALL_ORDERS]);

  const table = useReactTable({
    data: ALL_ORDERS,
    columns,
    // Stable row id keyed on the order id (not the array index). Selection keys are
    // therefore order ids, so bulk actions resolve to the correct orders regardless
    // of current sort / filter / page — never positional `rows[index]` lookups.
    getRowId: (row) => row.id,
    state: { sorting, columnFilters, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Selection exists solely for "Send selected" (POST /redeliver), and the
    // backend rejects every status outside RedeliverableFrom with a 400 — so
    // gate selection on the RAW backend status (the display pill is too
    // coarse: its "failed" bucket mixes redeliverable delivery_failed with
    // non-redeliverable parse/transform failures and dead-letters).
    enableRowSelection: (row) => isRedeliverable(row.original.rawStatus),
  });

  const { rows } = table.getRowModel();

  // Client-side text search only in mock mode (live mode searches server-side).
  const filteredRows = useMemo(() => {
    if (!isApiMockMode || !searchInput) return rows;
    const q = searchInput.toLowerCase();
    return rows.filter((row) =>
      row.original.po.toLowerCase().includes(q) ||
      row.original.buyer.toLowerCase().includes(q) ||
      row.original.supplier.toLowerCase().includes(q),
    );
  }, [rows, searchInput]);

  // Pagination: mock paginates the filtered set client-side; live already holds
  // exactly one server page in `filteredRows`.
  const totalCount = isApiMockMode ? filteredRows.length : (ordersPage?.totalCount ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = isApiMockMode
    ? filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : filteredRows;

  const selectedCount = Object.keys(rowSelection).length;

  // ─── Keyboard row navigation (desktop) ────────────────────────────────────
  // The visible set is what j/k traverses. Reset the highlight whenever it
  // changes underfoot (page / filter / search / sort) so the active index never
  // points past the end or at a now-different row.
  const pageLen = pagedRows.length;
  useEffect(() => {
    setActiveRow(-1);
  }, [currentPage, statusFilter, search, searchInput, activeChip, sorting]);

  // Close the columns menu on outside click / Escape (mirrors BridgeTopbar).
  useEffect(() => {
    if (!columnsMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
        setColumnsMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setColumnsMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [columnsMenuOpen]);

  // Global j/k/Arrow/Enter handler, scoped to the inbox. Ignored while typing in
  // a field, when a modifier is held (don't hijack browser shortcuts), or when
  // the columns menu / a dialog is open. Enter opens the highlighted order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (columnsMenuOpen) return;
      // Skip when focus is in an editable element or any open dialog/menu exists.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      if (pageLen === 0) return;

      const key = e.key;
      if (key === "j" || key === "ArrowDown") {
        e.preventDefault();
        setActiveRow((i) => (i < 0 ? 0 : Math.min(i + 1, pageLen - 1)));
      } else if (key === "k" || key === "ArrowUp") {
        e.preventDefault();
        setActiveRow((i) => (i <= 0 ? 0 : i - 1));
      } else if (key === "Enter") {
        if (activeRow >= 0 && activeRow < pagedRows.length) {
          e.preventDefault();
          router.push(`/inbox/${pagedRows[activeRow].original.id}`);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pageLen, pagedRows, router, columnsMenuOpen, activeRow]);

  // Scroll the highlighted row into view as it moves.
  useEffect(() => {
    if (activeRow < 0 || !tableBodyRef.current) return;
    const rowEl = tableBodyRef.current.querySelectorAll<HTMLTableRowElement>("tr[data-row]")[activeRow];
    rowEl?.scrollIntoView({ block: "nearest" });
  }, [activeRow]);

  // A chip filter is active (not "All orders") OR there is a search query. Drives
  // the filter-aware empty state: 0 rows under a filter/search means "no MATCHING
  // orders" (work may exist, just not here) — distinct from a genuinely empty inbox.
  // searchInput covers both modes (mock filters on it directly; live mirrors it into
  // the debounced `search`), so an in-flight live debounce still counts as filtered.
  const isFiltered = activeChip !== 0 || searchInput.trim() !== "";

  // Whole-account action counts from `GET /api/orders/summary` (byStatus). These
  // drive the header summary AND the per-chip badges in BOTH mock and live. Summing
  // the byStatus buckets (rather than counting the current page's ALL_ORDERS) keeps
  // the headline correct across pagination/filtering. While the summary query is in
  // flight `byStatus`/`total` are undefined → sumStatuses returns 0 (treated as 0
  // per the Partial<Record> contract).
  const byStatus = summary?.byStatus;
  const reviewCount = useMemo(() => sumStatuses(byStatus, ["pending_review"]), [byStatus]);
  const failedCount = useMemo(() => sumStatuses(byStatus, FAILED_BUCKET), [byStatus]);

  // Per-chip badge counts, keyed off the chip's `summaryKeys` roll-up. "All orders"
  // (no summaryKeys) shows the summary `total`. Absent statuses count as 0.
  const chipCounts = useMemo(
    () =>
      FILTER_CHIPS.map(({ summaryKeys }) =>
        summaryKeys ? sumStatuses(byStatus, summaryKeys) : summary?.total ?? 0),
    [byStatus, summary?.total],
  );

  // Initial load: show skeleton ROW BODIES inside the table card while keeping the
  // header + filter chips + search fully rendered, so the chrome doesn't shift in
  // when data arrives. (The old early-return swapped the whole screen for a bare
  // card → layout jump.) Only the very first page load (no placeholder data yet)
  // shows the skeleton; subsequent page/filter fetches keep prior rows visible.
  const isInitialLoading = !isApiMockMode && isLoading && !ordersPage;

  // Error state
  if (!isApiMockMode && isError) {
    return (
      <PageShell variant="wide" className="flex flex-col items-center justify-center">
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: "#FBE3E3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 14px",
            }}
          >
            <span style={{ fontSize: "22px", color: "#B43838" }}>⚠</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "#0B1A2F" }}>
            Couldn't load the queue
          </div>
          <div className="muted" style={{ fontSize: "13px", maxWidth: 380, margin: "6px auto 14px", color: "#5E6779" }}>
            We couldn&apos;t load your orders right now — your data is safe. Try again in a moment.
          </div>
          <button
            onClick={() => refetch()}
            className="rounded-[6px] px-4 text-[12.5px] font-medium"
            style={{ height: 32, border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            ↻ Retry
          </button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell variant="wide" className="flex flex-col">

      {/* Page header — canonical PageHeader on the grey canvas, table floats below in a white card */}
      <PageHeader
          title="Inbox"
          /* Header summary = the live "what needs me?" line. The total order count
             is shown ONCE, in the footer next to pagination — not duplicated here. */
          sub={
            <>
              {reviewCount.toLocaleString()} need review{" · "}{failedCount.toLocaleString()} failed
              {selectedCount > 0 && <span style={{ color: BLUE_DEEP, marginLeft: 8 }}>· {selectedCount} selected</span>}
            </>
          }
          actions={
            <>
              <button
                className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors"
                style={{
                  height: 32,
                  border: "1px solid #E5E8EE",
                  background: "#FFFFFF",
                  color: isFetching ? "var(--ink-faint)" : "#0B1A2F",
                  cursor: isFetching ? "default" : "pointer",
                }}
                onClick={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
                disabled={isFetching}
                aria-busy={isFetching}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    animation: isFetching ? "inbox-sync-spin 0.8s linear infinite" : undefined,
                  }}
                >
                  ↻
                </span>
                <style>{`@keyframes inbox-sync-spin { to { transform: rotate(360deg); } }`}</style>
                {isFetching ? "Syncing…" : "Sync"}
              </button>
              <button
                className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-semibold transition-colors"
                style={{ height: 32, background: BLUE, color: "#FFFFFF", border: 0 }}
                onClick={() => router.push("/upload")}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = BLUE_DEEP; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = BLUE; }}
              >
                ↑ Upload order
              </button>
            </>
          }
        />

      {/* Bulk action bar — shown while selecting AND while a send result is on
          display. A full success clears the selection, which previously
          unmounted the bar together with its "N orders sent" confirmation, so
          the action read as a silent no-op; now the bar stays until dismissed. */}
      {shouldShowBulkBar(selectedCount, bulkResult) && (
        <div
          className="flex items-center justify-between rounded-[8px] px-4 py-2 mb-3 flex-shrink-0"
          style={{ background: "#0B1A2F", color: "#FFFFFF" }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "12.5px", fontWeight: 600 }}>
              {/* Drive the headline from the real result: a fully-failed bulk
                  must not read "Send complete". Falls back to a neutral
                  "Send finished" if a result is on display without a flag. */}
              {selectedCount > 0
                ? `${selectedCount} selected`
                : bulkResult
                  ? (bulkResult.ok ? "Sent" : "Some failed to send")
                  : "Send finished"}
            </span>
            <button
              onClick={() => { setRowSelection({}); setBulkResult(null); }}
              style={{ background: "none", border: "none", color: "var(--ink-faint)", fontSize: "12px", cursor: "pointer" }}
            >
              {selectedCount > 0 ? "Clear" : "Dismiss"}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {bulkResult && (
              <span
                role="status"
                aria-live="polite"
                style={{ fontSize: "12px", fontWeight: 600, color: bulkResult.ok ? "#7FD18A" : "#F2A6A6" }}
              >
                {bulkResult.ok ? "✓ " : "⚠ "}{bulkResult.text}
              </span>
            )}
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={handleSendSelected}
                disabled={bulkSending}
                style={{
                  background: "none",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: bulkSending ? "default" : "pointer",
                  opacity: bulkSending ? 0.6 : 1,
                  padding: 0,
                }}
              >
                {bulkSending ? "Sending…" : "Send selected"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter chips + search input — toolbar on the grey canvas, above the table card.
          Mobile: chips on a horizontal-scroll row, search full-width on its own row below.
          sm+: both sit side by side on one row. */}
      <div
        className="flex flex-col gap-2 pb-3 sm:flex-row sm:flex-wrap sm:items-center flex-shrink-0"
        style={{ background: "var(--bg)" }}
      >
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto flex-nowrap w-full sm:w-auto sm:flex-1 min-w-0">
          {FILTER_CHIPS.map(({ label }, i) => {
            const active = i === activeChip;
            return (
              <button
                key={label}
                onClick={() => handleChip(i)}
                className="flex items-center gap-1.5 rounded-[6px] pl-2.5 pr-2 text-[12px] font-medium transition-colors flex-shrink-0"
                style={{
                  height: 28,
                  border: `1px solid ${active ? INK : "#E5E8EE"}`,
                  background: active ? INK : "#FFFFFF",
                  color: active ? "#FFFFFF" : "#5E6779",
                  cursor: "pointer",
                }}
              >
                {label}
                <span
                  className="inline-flex items-center justify-center font-mono text-[10.5px] font-semibold rounded-[8px]"
                  style={{
                    minWidth: 18,
                    height: 17,
                    padding: "0 5px",
                    background: active ? "rgba(255,255,255,0.16)" : "#F1F3F7",
                    color: active ? "#FFFFFF" : "#5E6779",
                  }}
                >
                  {chipCounts[i]?.toLocaleString() ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search input — full width on its own row on mobile, capped on sm+ */}
        <div
          className="flex items-center gap-1.5 rounded-[6px] px-3 w-full sm:w-auto sm:min-w-[160px] sm:max-w-[240px] sm:flex-shrink-0"
          style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", height: 32 }}
        >
          <span aria-hidden="true" style={{ fontSize: "14px", color: "var(--ink-faint)", flexShrink: 0 }}>🔍</span>
          <input
            type="text"
            aria-label="Search orders"
            placeholder="Search PO, buyer, supplier…"
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            style={{
              border: "none",
              background: "none",
              fontSize: "12.5px",
              color: "#0B1A2F",
              flex: 1,
              minWidth: 0,
              padding: 0,
            }}
          />
        </div>

        {/* Columns visibility menu — desktop table only. Toggles the optional
            columns (Source / Value / Pipeline / Updated); structural columns are
            enableHiding:false so they never appear here. Session-only state. */}
        <div ref={columnsMenuRef} className="relative hidden lg:block sm:flex-shrink-0">
          <button
            type="button"
            onClick={() => setColumnsMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={columnsMenuOpen}
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors"
            style={{
              height: 32,
              border: `1px solid ${columnsMenuOpen ? INK : "#E5E8EE"}`,
              background: "#FFFFFF",
              color: "#5E6779",
              cursor: "pointer",
            }}
          >
            <span aria-hidden style={{ fontSize: "13px" }}>▦</span>
            Columns
          </button>
          {columnsMenuOpen && (
            <div
              role="menu"
              aria-label="Toggle columns"
              className="absolute right-0 z-20 mt-1.5 rounded-[8px] py-1.5"
              style={{
                top: "100%",
                minWidth: 168,
                background: "#FFFFFF",
                border: "1px solid #E5E8EE",
                boxShadow: "0 8px 24px rgba(11,26,47,0.12)",
              }}
            >
              <div
                className="px-3 pb-1.5 pt-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
                style={{ color: "var(--ink-faint)" }}
              >
                Show columns
              </div>
              {table.getAllLeafColumns()
                .filter((col) => col.getCanHide())
                .map((col) => {
                  const label = col.columnDef.meta?.label ?? col.id;
                  const visible = col.getIsVisible();
                  return (
                    <button
                      key={col.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={visible}
                      onClick={() => col.toggleVisibility()}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#F6F7FA]"
                      style={{ color: "#0B1A2F", background: "none", border: "none", cursor: "pointer" }}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={visible}
                        tabIndex={-1}
                        style={{ accentColor: BLUE, cursor: "pointer", width: 13, height: 13, pointerEvents: "none" }}
                      />
                      {label}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* ── Queue table / mobile route cards — floating white card on grey canvas ── */}
      <div
        className="flex-1 min-h-0 overflow-auto mb-3"
        style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", borderRadius: 12 }}
      >
        <div className="flex flex-col gap-2.5 p-3 lg:hidden">
          {/* Mobile loading skeleton — card-shaped, matching the route cards below
              so the list doesn't reflow when data lands. */}
          {isInitialLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`sk-${i}`}
                className="rounded-[10px] px-4 py-3.5"
                style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.05)" }}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 h-[15px] w-32 rounded bg-[#E5E8EE] animate-pulse" />
                    <div className="h-[13px] w-44 rounded bg-[#EEF1F6] animate-pulse" />
                  </div>
                  <div className="h-[18px] w-20 rounded-full bg-[#EEF1F6] animate-pulse" />
                </div>
                <div className="mb-2 h-[18px] w-14 rounded bg-[#EEF1F6] animate-pulse" />
                <div className="h-[15px] w-2/3 rounded bg-[#EEF1F6] animate-pulse" />
              </div>
            ))}
          {!isInitialLoading && pagedRows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
              <div style={{ fontSize: 28, color: "#CBD0DA" }}>⊘</div>
              {isFiltered ? (
                <>
                  <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>No matching orders</p>
                  <p className="text-[13px]" style={{ color: "#5E6779" }}>
                    No orders match the current filter or search. Try a different filter, or clear them to see everything.
                  </p>
                  <button
                    onClick={handleClearFilters}
                    style={{
                      marginTop: 8,
                      height: 32,
                      padding: "0 16px",
                      borderRadius: 6,
                      background: "#FFFFFF",
                      color: "#0B1A2F",
                      border: "1px solid #E5E8EE",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>Your inbox is clear</p>
                  <p className="text-[13px]" style={{ color: "#5E6779" }}>{emptyStateCopy}</p>
                  <button
                    onClick={() => router.push("/upload")}
                    style={{
                      marginTop: 8,
                      height: 32,
                      padding: "0 16px",
                      borderRadius: 6,
                      background: BLUE,
                      color: "#FFFFFF",
                      border: "none",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ↑ Upload an order
                  </button>
                  {/* Practice-order path (task 9) — genuine-empty branch only,
                      never the filtered-zero branch. */}
                  <button
                    onClick={() => sample.runSample()}
                    disabled={sample.isPending}
                    style={{
                      height: 32,
                      padding: "0 16px",
                      borderRadius: 6,
                      background: "#FFFFFF",
                      color: "#0B1A2F",
                      border: "1px solid #E5E8EE",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: sample.isPending ? "default" : "pointer",
                      opacity: sample.isPending ? 0.6 : 1,
                    }}
                  >
                    {sample.isPending ? "Starting practice order…" : "Try a practice order"}
                  </button>
                  {sample.error && (
                    <p className="text-[12px]" style={{ color: "#B43838" }}>{sample.error.message}</p>
                  )}
                </>
              )}
            </div>
          )}
          {pagedRows.map((row) => (
            <button
              key={row.id}
              className="block w-full rounded-[10px] px-4 py-3.5 text-left transition-colors active:bg-[#F6F7FA]"
              style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.05)", minHeight: 44 }}
              onClick={() => router.push(`/inbox/${row.original.id}`)}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="truncate font-mono text-[13px] font-semibold" style={{ color: INK }}>
                      {row.original.po}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-faint)" }}>
                    {row.original.age} ago · {row.original.lines} lines · {row.original.valueLabel}
                  </p>
                </div>
                <span style={{ flexShrink: 0, marginLeft: 8 }}>
                  <StatusDotPill status={row.original.status} compact />
                </span>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <FileChip type={row.original.fmt} />
                {row.original.issues > 0 && (
                  <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: "#FBE3E3", color: "#B43838" }}>
                    {row.original.issues} to review
                  </span>
                )}
              </div>
              {(() => {
                const buyer = row.original.buyer;
                const hasBuyer = buyer != null && buyer.trim() !== "" && buyer.trim() !== "—";
                // Missing buyer → one honest line (supplier only) instead of two
                // disconnected dashes. Present buyer → buyer → supplier rail that
                // stacks vertically on mobile, horizontal from sm up.
                if (!hasBuyer) {
                  return (
                    <div className="flex items-center gap-1.5 text-[13px]">
                      <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>{labels.unknownBuyer}</span>
                      <span aria-hidden style={{ color: "#CBD0DA" }}>→</span>
                      <span className="truncate font-medium" style={{ color: GREEN_DEEP }}>{row.original.supplier}</span>
                    </div>
                  );
                }
                return (
                  <div className="flex flex-col gap-1 text-[13px] sm:flex-row sm:items-center sm:gap-2">
                    <span className="truncate font-medium" style={{ color: BLUE_DEEP }}>{buyer}</span>
                    <span
                      aria-hidden
                      className="h-px w-5 flex-shrink-0 hidden sm:block"
                      style={{ background: "linear-gradient(90deg, #1E66C9, #2E8E3A)" }}
                    />
                    <span aria-hidden className="text-[11px] leading-none sm:hidden" style={{ color: "#CBD0DA" }}>↓</span>
                    <span className="truncate font-medium" style={{ color: GREEN_DEEP }}>{row.original.supplier}</span>
                  </div>
                );
              })()}
            </button>
          ))}
        </div>

        <div className="hidden overflow-x-auto lg:block">
        <table
          style={{
            width: "100%",
            minWidth: 1180,
            borderCollapse: "collapse",
            fontSize: 12.5,
            tableLayout: "fixed",
          }}
        >
          {/* Colgroup for fixed widths — must track the VISIBLE leaf columns so
              widths stay aligned when the Columns menu hides one (tableLayout:fixed
              maps <col> positionally onto rendered cells). */}
          <colgroup>
            {table.getVisibleLeafColumns().map((col) => (
              <col key={col.id} style={{ width: col.getSize() }} />
            ))}
          </colgroup>

          {/* Sticky header */}
          <thead style={{ position: "sticky", top: 0, zIndex: 4 }}>
            {table.getHeaderGroups().map((hg) => (
              // v2 tinted header band (surface-2) — full-bleed table treatment.
              <tr key={hg.id} style={{ borderBottom: "1px solid #E5E8EE", background: "#F1F3F7" }}>
                {hg.headers.map((header, hi) => {
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const toggleSort = header.column.getToggleSortingHandler();
                  return (
                    <th
                      key={header.id}
                      // Sortable headers are keyboard-operable: focusable, exposed
                      // as a button to AT, and toggled with Enter/Space. aria-sort
                      // announces the current direction. Veterans live on the keyboard.
                      role={canSort ? "button" : undefined}
                      tabIndex={canSort ? 0 : undefined}
                      aria-sort={
                        canSort
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                            ? "descending"
                            : "none"
                          : undefined
                      }
                      style={{
                        padding: "10px 10px",
                        paddingLeft: hi === 0 ? 16 : 10,
                        textAlign: "left",
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: "0.07em",
                        textTransform: "uppercase",
                        color: "var(--ink-muted)",
                        whiteSpace: "nowrap",
                        cursor: canSort ? "pointer" : "default",
                        userSelect: "none",
                        background: "#F1F3F7",
                      }}
                      onClick={canSort ? toggleSort : undefined}
                      onKeyDown={
                        canSort
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleSort?.(e);
                              }
                            }
                          : undefined
                      }
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && <SortIcon state={sorted} />}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody ref={tableBodyRef}>
            {/* Desktop loading skeleton — one pulse bar per visible column, so the
                table keeps its real shape (header stays mounted above) instead of
                swapping to a bare card. */}
            {isInitialLoading &&
              Array.from({ length: 9 }).map((_, ri) => (
                <tr key={`sk-row-${ri}`} style={{ height: 44, borderBottom: "1px solid #EEF0F4" }}>
                  {table.getVisibleLeafColumns().map((col, ci) => (
                    <td key={col.id} style={{ padding: "0 10px", paddingLeft: ci === 0 ? 16 : 10 }}>
                      <div
                        className="h-[14px] rounded bg-[#EEF1F6] animate-pulse"
                        style={{ width: ci === 0 ? 24 : "70%" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            {!isInitialLoading && pagedRows.map((row, rowIndex) => {
              const isSelected = row.getIsSelected();
              const isActive = rowIndex === activeRow;
              return (
                <tr
                  key={row.id}
                  data-row
                  onClick={() => router.push(`/inbox/${row.original.id}`)}
                  style={{
                    height: 44,
                    borderBottom: "1px solid #EEF0F4",
                    cursor: "pointer",
                    background: isSelected
                      ? "#EAF0F8"
                      : isActive
                      ? "#EEF4FE"
                      : row.original.status === "review"
                      ? "#FAF1DD08"
                      : row.original.status === "failed"
                      ? "#FBE3E308"
                      : "#FFFFFF",
                    boxShadow: isActive ? "inset 2px 0 0 #1E66C9, inset 0 0 0 1px #1E66C9" : undefined,
                    transition: "background 80ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isActive) (e.currentTarget as HTMLElement).style.background = "#F6F7FA";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !isActive) {
                      const s = row.original.status;
                      (e.currentTarget as HTMLElement).style.background =
                        s === "review" ? "#FAF1DD08" : s === "failed" ? "#FBE3E308" : "#FFFFFF";
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell, ci) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: "0 10px",
                        paddingLeft: ci === 0 ? 16 : 10,
                        verticalAlign: "middle",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}

            {/* Empty state — filter-aware: 0 rows under a filter/search means "no
                MATCHING orders" (clear filters), not a genuinely empty inbox. */}
            {!isInitialLoading && pagedRows.length === 0 && (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} style={{ textAlign: "center", padding: "64px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 16, color: "#CBD0DA" }}>⊘</div>
                  {isFiltered ? (
                    <>
                      <p
                        style={{
                          fontSize: 20,
                          fontWeight: 600,
                          color: "#0B1A2F",
                          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                          marginBottom: 8,
                        }}
                      >
                        No matching orders
                      </p>
                      <p style={{ fontSize: 13, marginTop: 4, color: "#5E6779", maxWidth: 380, margin: "8px auto 0" }}>
                        No orders match the current filter or search. Try a different filter, or clear them to see everything.
                      </p>
                      <button
                        onClick={handleClearFilters}
                        style={{
                          marginTop: 16,
                          height: 32,
                          padding: "0 16px",
                          borderRadius: 6,
                          background: "#FFFFFF",
                          color: "#0B1A2F",
                          border: "1px solid #E5E8EE",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <p
                        style={{
                          fontSize: 20,
                          fontWeight: 600,
                          color: "#0B1A2F",
                          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                          marginBottom: 8,
                        }}
                      >
                        Your inbox is clear
                      </p>
                      <p style={{ fontSize: 13, marginTop: 4, color: "#5E6779", maxWidth: 380, margin: "8px auto 0" }}>
                        {emptyStateCopy}
                      </p>
                      <button
                        onClick={() => router.push("/upload")}
                        style={{
                          marginTop: 16,
                          height: 32,
                          padding: "0 16px",
                          borderRadius: 6,
                          background: BLUE,
                          color: "#FFFFFF",
                          border: "none",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        ↑ Upload an order
                      </button>
                      {/* Practice-order path (task 9) — genuine-empty branch only,
                          never the filtered-zero branch. */}
                      <button
                        onClick={() => sample.runSample()}
                        disabled={sample.isPending}
                        style={{
                          marginTop: 8,
                          marginLeft: 8,
                          height: 32,
                          padding: "0 16px",
                          borderRadius: 6,
                          background: "#FFFFFF",
                          color: "#0B1A2F",
                          border: "1px solid #E5E8EE",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: sample.isPending ? "default" : "pointer",
                          opacity: sample.isPending ? 0.6 : 1,
                        }}
                      >
                        {sample.isPending ? "Starting practice order…" : "Try a practice order"}
                      </button>
                      {sample.error && (
                        <p style={{ fontSize: 12, marginTop: 8, color: "#B43838" }}>{sample.error.message}</p>
                      )}
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Footer: total + pagination controls — on the grey canvas, below the card */}
      <div
        className="flex-shrink-0 flex flex-wrap items-center gap-3 pt-0.5"
        style={{ background: "var(--bg)" }}
      >
        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {totalCount.toLocaleString()} order{totalCount !== 1 ? "s" : ""}
          {selectedCount > 0 && <span style={{ color: BLUE_DEEP }}> · {selectedCount} selected</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="rounded-[6px] px-2.5 text-[12px] font-medium"
            style={{ height: 28, border: "1px solid #E5E8EE", background: "#FFFFFF", color: currentPage <= 1 ? "#CBD0DA" : "#0B1A2F", cursor: currentPage <= 1 ? "default" : "pointer" }}
          >
            ← Prev
          </button>
          <span className="text-[11px] font-mono" style={{ color: "#5E6779", minWidth: 92, textAlign: "center" }}>
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="rounded-[6px] px-2.5 text-[12px] font-medium"
            style={{ height: 28, border: "1px solid #E5E8EE", background: "#FFFFFF", color: currentPage >= totalPages ? "#CBD0DA" : "#0B1A2F", cursor: currentPage >= totalPages ? "default" : "pointer" }}
          >
            Next →
          </button>
        </div>
      </div>
    </PageShell>
  );
}
