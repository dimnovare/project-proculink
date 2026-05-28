"use client";

// Inbox — TanStack Table order queue
// Sort on every column header · filter chips by status · bulk-select rows
// Click a row → /inbox/[orderId] (Canonical Spine Review)

import { useRouter } from "next/navigation";
import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { OrderSummary } from "@/types/procurement";
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
} from "@tanstack/react-table";
import { FileChip } from "./FileChip";
import { StatusCell, type CrossingStatus } from "./StatusJourney";

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string;
  status: CrossingStatus;
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

function generateOrders(count: number): OrderRow[] {
  const rows: OrderRow[] = [];
  // Seed with the original 12 hand-crafted rows first
  const SEED: Array<Omit<OrderRow, "ageMin">> = [
    { id: "008412",  status: "review",     fmt: "PDF",   buyer: BUYERS[0], supplier: SUPPLIERS[0], po: "PO-2026-008412",  lines: 14, value: 24180.50, valueLabel: "€ 24,180.50", issues: 3, assigned: "MK", age: "2m"  },
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
  SEED.forEach((s) => rows.push({ ...s, ageMin: s.age.endsWith("d") ? parseInt(s.age)*1440 : s.age.endsWith("h") ? parseInt(s.age)*60 : parseInt(s.age) }));

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

function mapStatus(s: string): CrossingStatus {
  if (s === "pending_review") return "review";
  if (s === "parsing" || s === "transforming") return "extracting";
  if (s === "ready" || s === "ready_to_deliver") return "ready";
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

// ─── Filter chips ─────────────────────────────────────────────────────────────

const FILTER_CHIPS: Array<{ label: string; status?: CrossingStatus }> = [
  { label: "All" },
  { label: "New",          status: "new"        },
  { label: "Extracting",   status: "extracting" },
  { label: "Needs review", status: "review"     },
  { label: "Ready",        status: "ready"      },
  { label: "Sent",         status: "sent"       },
  { label: "Failed",       status: "failed"     },
];

// ─── Column helper ────────────────────────────────────────────────────────────

const columnHelper = createColumnHelper<OrderRow>();

const columns = [
  // Checkbox select
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <input
        type="checkbox"
        style={{ accentColor: "#1E66C9", cursor: "pointer", width: 13, height: 13 }}
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        style={{ accentColor: "#1E66C9", cursor: "pointer", width: 13, height: 13 }}
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        onClick={(e) => e.stopPropagation()}
        aria-label="Select row"
      />
    ),
    size: 36,
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => <StatusCell status={info.getValue()} />,
    size: 120,
  }),
  columnHelper.accessor("ageMin", {
    header: "Received",
    cell: (info) => <span style={{ color: "#56627A" }}>{info.row.original.age}</span>,
    size: 72,
  }),
  columnHelper.accessor("fmt", {
    header: "Source",
    cell: (info) => <FileChip type={info.getValue()} />,
    size: 72,
  }),
  columnHelper.accessor("buyer", {
    header: "Buyer",
    cell: (info) => <span style={{ color: "#0B1A2F" }}>{info.getValue()}</span>,
    size: 200,
  }),
  columnHelper.accessor("supplier", {
    header: "Supplier",
    cell: (info) => <span style={{ color: "#0B1A2F" }}>{info.getValue()}</span>,
    size: 180,
  }),
  columnHelper.accessor("po", {
    header: "PO #",
    cell: (info) => (
      <span className="font-mono text-[11.5px]" style={{ color: "#0F4FA8" }}>{info.getValue()}</span>
    ),
    size: 150,
  }),
  columnHelper.accessor("lines", {
    header: "Lines",
    cell: (info) => <span style={{ color: "#56627A" }}>{info.getValue()}</span>,
    meta: { numeric: true },
    size: 56,
  }),
  columnHelper.accessor("value", {
    header: "Value",
    cell: (info) => (
      <span className="font-mono text-[11.5px]" style={{ color: "#0B1A2F" }}>
        {info.row.original.valueLabel}
      </span>
    ),
    meta: { numeric: true },
    size: 110,
  }),
  columnHelper.accessor("issues", {
    header: "Issues",
    cell: (info) =>
      info.getValue() > 0 ? (
        <span className="font-semibold" style={{ color: "#C53A3A" }}>⚠ {info.getValue()}</span>
      ) : (
        <span style={{ color: "#8A93A5" }}>—</span>
      ),
    size: 64,
  }),
  columnHelper.accessor("assigned", {
    header: "Assigned",
    cell: (info) => <span style={{ color: "#56627A" }}>{info.getValue()}</span>,
    size: 72,
  }),
];

// ─── Sort indicator ───────────────────────────────────────────────────────────

function SortIcon({ state }: { state: "asc" | "desc" | false }) {
  return (
    <span style={{ fontSize: 10, color: state ? "#1E66C9" : "#C6CDDA", marginLeft: 4, userSelect: "none" }}>
      {state === "asc" ? "↑" : state === "desc" ? "↓" : "⇅"}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// Mock mode: use a static generated set (50 rows)
const MOCK_ORDERS = isApiMockMode ? generateOrders(50) : [];

export function InboxView() {
  const router = useRouter();
  const [sorting, setSorting]           = useState<SortingState>([{ id: "ageMin", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [activeChip, setActiveChip]     = useState(0); // index into FILTER_CHIPS

  const queryClient = useQueryClient();
  const { data: rawOrders, isLoading, isError, refetch } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders(),
    staleTime: 30_000,
    enabled: !isApiMockMode,
  });

  const ALL_ORDERS: OrderRow[] = isApiMockMode
    ? MOCK_ORDERS
    : (rawOrders ?? []).map(summaryToRow);

  // Status filter: when a chip is selected, filter by status column
  const handleChip = useCallback((idx: number) => {
    setActiveChip(idx);
    const chip = FILTER_CHIPS[idx];
    if (chip.status) {
      setColumnFilters([{ id: "status", value: chip.status }]);
    } else {
      setColumnFilters([]);
    }
    setRowSelection({});
  }, []);

  const table = useReactTable({
    data: ALL_ORDERS,
    columns,
    state: { sorting, columnFilters, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableRowSelection: true,
  });

  const { rows } = table.getRowModel();

  const selectedCount = Object.keys(rowSelection).length;

  // Chip counts against full dataset (before status filter)
  const chipCounts = useMemo(
    () => FILTER_CHIPS.map(({ status }) =>
      status ? ALL_ORDERS.filter((o) => o.status === status).length : ALL_ORDERS.length
    ),
    [ALL_ORDERS]
  );

  // Loading state
  if (!isApiMockMode && isLoading) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
        <div className="flex-1 flex flex-col gap-0 bg-white">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3 border-b border-[#F0F2F6]">
              <div className="h-5 w-20 rounded bg-[#E2E6EE] animate-pulse" />
              <div className="h-5 flex-1 rounded bg-[#E2E6EE] animate-pulse" />
              <div className="h-5 w-24 rounded bg-[#E2E6EE] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (!isApiMockMode && isError) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden items-center justify-center gap-3 bg-white">
        <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>Could not load orders</p>
        <button
          onClick={() => refetch()}
          className="rounded-[6px] px-4 text-[12.5px] font-medium"
          style={{ height: 32, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>

      {/* Page header */}
      <div
        className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-end lg:gap-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            Inbox
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {rows.length.toLocaleString()} of {ALL_ORDERS.length.toLocaleString()} orders
            {selectedCount > 0 && <span style={{ color: "#1E66C9", marginLeft: 8 }}>· {selectedCount} selected</span>}
            <span style={{ color: "#C6CDDA", margin: "0 6px" }}>·</span>last sync 14s ago
          </p>
        </div>

        {/* Bulk action bar */}
        {selectedCount > 0 && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-[6px] text-[12px]"
            style={{ background: "#E3EDFB", border: "1px solid #1E66C933", color: "#0F4FA8" }}
          >
            <span className="font-semibold">{selectedCount} selected</span>
            <span style={{ color: "#BDD0EE" }}>·</span>
            <button
              style={{ color: "#0F4FA8", background: "none", border: 0, cursor: "pointer", fontWeight: 600 }}
              onClick={async () => {
                const ids = Object.keys(rowSelection).map(k => rows[Number(k)]?.original.id).filter(Boolean);
                if (!ids.length) return;
                try {
                  await Promise.all(
                    ids.map(id =>
                      fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5223"}/api/orders/${id}/redeliver`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                      }).catch(() => null)
                    )
                  );
                  queryClient.invalidateQueries({ queryKey: ["orders"] });
                  setRowSelection({});
                } catch { /* ignore */ }
              }}
            >
              Re-process
            </button>
            <button
              disabled
              title="Discard requires the soft-delete endpoint (Group L)"
              style={{ color: "#8A93A5", background: "none", border: 0, cursor: "not-allowed", fontWeight: 600 }}
            >
              Discard
            </button>
          </div>
        )}

        <div className="flex w-full flex-wrap gap-2 lg:ml-auto lg:w-auto">
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors"
            style={{ height: 32, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
            onClick={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
          >
            ↻ Sync
          </button>
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{ height: 32, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
            onClick={() => router.push("/upload")}
          >
            ↑ Upload
          </button>
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
            onClick={() => router.push("/upload")}
          >
            + New order
          </button>
        </div>
      </div>

      {/* Filter chips + view toggle */}
      <div
        className="flex items-center gap-1.5 overflow-x-auto px-4 py-2 sm:px-5 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        {FILTER_CHIPS.map(({ label }, i) => {
          const active = i === activeChip;
          return (
            <button
              key={label}
              onClick={() => handleChip(i)}
              className="flex items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors"
              style={{
                height: 26,
                border: `1px solid ${active ? "#1E66C933" : "#E2E6EE"}`,
                background: active ? "#E3EDFB" : "#FFFFFF",
                color: active ? "#0F4FA8" : "#0B1A2F",
                cursor: "pointer",
              }}
            >
              {label}
              <span
                className="text-[11px] font-mono"
                style={{ color: active ? "#0F4FA8" : "#8A93A5" }}
              >
                {chipCounts[i].toLocaleString()}
              </span>
            </button>
          );
        })}

        <div className="hidden flex-1 lg:block" />

        {/* View toggle */}
        <div
          className="hidden rounded-[6px] overflow-hidden text-[12px] lg:flex"
          style={{ border: "1px solid #E2E6EE" }}
        >
          <button
            className="px-3 py-1"
            style={{ background: "#FFFFFF", color: "#56627A", borderRight: "1px solid #E2E6EE", cursor: "pointer" }}
            onClick={() => router.push("/bridge")}
          >
            Bridge view
          </button>
          <button
            className="px-3 py-1 font-medium"
            style={{ background: "#0B1A2F", color: "#FFFFFF", cursor: "pointer" }}
          >
            List view
          </button>
        </div>
      </div>

      {/* Time-strip ribbon */}
      <div
        className="flex items-center gap-3 px-4 sm:px-6 flex-shrink-0"
        style={{ height: 52, borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <span
          className="text-[10.5px] font-bold uppercase tracking-[0.06em] flex-shrink-0 w-[80px]"
          style={{ color: "#8A93A5" }}
        >
          Last 24h
        </span>
        <svg className="flex-1" height={32} viewBox="0 0 816 32" preserveAspectRatio="none">
          <defs>
            <linearGradient id="inb-rib" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1E66C9" stopOpacity={0.65} />
              <stop offset="100%" stopColor="#1E66C9" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          {Array.from({ length: 48 }).map((_, i) => {
            const h = 6 + (Math.sin(i * 0.3) + 1.4) * 8 + (i > 38 ? 6 : 0);
            return (
              <rect key={i} x={i * 17} y={32 - h} width={13} height={h} fill="url(#inb-rib)" rx={1.5} />
            );
          })}
          <rect x={640} y={0} width={176} height={32} fill="#1E66C9" fillOpacity={0.08}
                stroke="#1E66C9" strokeWidth={1.5} rx={2} />
        </svg>
        <span
          className="text-[11px] font-mono flex-shrink-0 text-right"
          style={{ color: "#56627A", width: 130 }}
        >
          last 2h · {rows.length > 100 ? "100+" : rows.length} orders
        </span>
      </div>

      {/* ── Queue table / mobile route cards ──────────────────────────────────── */}
      <div className="flex-1 overflow-auto" style={{ background: "#FFFFFF" }}>
        <div className="divide-y divide-[#F0F2F6] md:hidden">
          {rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
              <div style={{ fontSize: 28, color: "#C6CDDA" }}>⊘</div>
              <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>No orders match this filter</p>
              <p className="text-[13px]" style={{ color: "#56627A" }}>Try a different status filter above.</p>
            </div>
          )}
          {rows.map((row) => (
            <button
              key={row.id}
              className="block w-full px-4 py-3 text-left"
              style={{ background: "#FFFFFF", border: "none" }}
              onClick={() => router.push(`/inbox/${row.original.id}`)}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[12px] font-semibold" style={{ color: "#0F4FA8" }}>
                    {row.original.po}
                  </p>
                  <p className="mt-0.5 text-[11.5px]" style={{ color: "#8A93A5" }}>
                    {row.original.age} ago · {row.original.lines} lines · {row.original.valueLabel}
                  </p>
                </div>
                <StatusCell status={row.original.status} />
              </div>
              <div className="mb-2 flex items-center gap-2">
                <FileChip type={row.original.fmt} />
                {row.original.issues > 0 && (
                  <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: "#FBE3E3", color: "#C53A3A" }}>
                    {row.original.issues} issues
                  </span>
                )}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-[12px]">
                <span className="truncate" style={{ color: "#1E66C9" }}>{row.original.buyer}</span>
                <span className="h-px w-5" style={{ background: "linear-gradient(90deg, #1E66C9, #2E8E3A)" }} />
                <span className="truncate text-right" style={{ color: "#2E8E3A" }}>{row.original.supplier}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
        <table
          style={{
            width: "100%",
            minWidth: 1180,
            borderCollapse: "collapse",
            fontSize: 12.5,
            tableLayout: "fixed",
          }}
        >
          {/* Colgroup for fixed widths */}
          <colgroup>
            {table.getAllColumns().map((col) => (
              <col key={col.id} style={{ width: col.getSize() }} />
            ))}
          </colgroup>

          {/* Sticky header */}
          <thead style={{ position: "sticky", top: 0, zIndex: 4 }}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} style={{ borderBottom: "2px solid #E2E6EE", background: "#FFFFFF" }}>
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      style={{
                        padding: "8px 10px",
                        textAlign: "left",
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#8A93A5",
                        whiteSpace: "nowrap",
                        cursor: canSort ? "pointer" : "default",
                        userSelect: "none",
                        background: "#FFFFFF",
                      }}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && <SortIcon state={sorted} />}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {rows.map((row) => {
              const isSelected = row.getIsSelected();
              return (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/inbox/${row.original.id}`)}
                  style={{
                    height: 38,
                    borderBottom: "1px solid #F0F2F6",
                    cursor: "pointer",
                    background: isSelected
                      ? "#EEF4FC"
                      : row.original.status === "review"
                      ? "#FAEFD608"
                      : row.original.status === "failed"
                      ? "#FBE3E308"
                      : "#FFFFFF",
                    transition: "background 80ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F6F7FA";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      const s = row.original.status;
                      (e.currentTarget as HTMLElement).style.background =
                        s === "review" ? "#FAEFD608" : s === "failed" ? "#FBE3E308" : "#FFFFFF";
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: "0 10px",
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

            {/* Empty state */}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: "center", padding: "64px 0", color: "#8A93A5" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>⊘</div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F" }}>No orders match this filter</p>
                  <p style={{ fontSize: 13, marginTop: 4 }}>Try a different status filter above.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Footer row count */}
      <div
        className="flex-shrink-0 flex items-center px-5"
        style={{ height: 32, borderTop: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <span className="text-[11px]" style={{ color: "#8A93A5" }}>
          Showing {rows.length.toLocaleString()} rows · {ALL_ORDERS.length.toLocaleString()} total
          {selectedCount > 0 && <span style={{ color: "#1E66C9" }}> · {selectedCount} selected</span>}
        </span>
      </div>
    </div>
  );
}
