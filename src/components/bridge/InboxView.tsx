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
  { label: "All orders" },
  { label: "Needs review", status: "review"     },
  { label: "Ready",        status: "ready"      },
  { label: "Delivering",   status: "delivering" },
  { label: "Delivered",    status: "sent"       },
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
  // Order column: PO# + lines/exceptions
  columnHelper.accessor("po", {
    header: "Order",
    cell: (info) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="font-mono text-[12px] font-semibold" style={{ color: "#0F4FA8" }}>
            {info.getValue()}
          </span>
          {info.row.original.assigned !== "—" && (
            <span
              className="font-mono text-[9.5px]"
              style={{
                background: "#EEE7FB",
                color: "#6F4FCE",
                padding: "0 5px",
                height: 17,
                display: "flex",
                alignItems: "center",
                borderRadius: 3,
              }}
            >
              AI
            </span>
          )}
        </div>
        <div
          className="text-[11px]"
          style={{ color: "#56627A" }}
        >
          {info.row.original.lines} lines{info.row.original.issues > 0 ? ` · ${info.row.original.issues} exceptions` : ""}
        </div>
      </div>
    ),
    size: 180,
  }),
  // Buyer → Supplier
  columnHelper.display({
    id: "lane",
    header: "Buyer → Supplier",
    cell: ({ row }) => (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "12.5px" }}>
        <span style={{ color: "#1E66C9", fontWeight: 500, flex: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}>
          {row.original.buyer}
        </span>
        <span style={{ color: "#8A93A5", flexShrink: 0 }}>→</span>
        <span style={{ color: "#2E8E3A", fontWeight: 500, flex: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}>
          {row.original.supplier}
        </span>
      </div>
    ),
    size: 320,
  }),
  columnHelper.accessor("fmt", {
    header: "Source",
    cell: (info) => <FileChip type={info.getValue()} />,
    size: 72,
  }),
  columnHelper.accessor("value", {
    header: "Value",
    cell: (info) => (
      <span className="font-mono text-[12.5px] font-semibold" style={{ color: "#0B1A2F" }}>
        {info.row.original.valueLabel}
      </span>
    ),
    meta: { numeric: true },
    size: 110,
  }),
  // Pipeline (StatusJourney compact)
  columnHelper.accessor("status", {
    header: "Pipeline",
    cell: (info) => <StatusCell status={info.getValue()} />,
    size: 120,
  }),
  // Status pill
  columnHelper.display({
    id: "statusPill",
    header: "Status",
    cell: ({ row }) => (
      <span
        style={{
          display: "inline-block",
          padding: "3px 8px",
          borderRadius: 4,
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "capitalize",
          background:
            row.original.status === "review"
              ? "#FAEFD6"
              : row.original.status === "failed"
              ? "#FBE3E3"
              : row.original.status === "sent"
              ? "#E2F1E2"
              : "#E3EDFB",
          color:
            row.original.status === "review"
              ? "#C97A14"
              : row.original.status === "failed"
              ? "#C53A3A"
              : row.original.status === "sent"
              ? "#2E8E3A"
              : "#1E66C9",
        }}
      >
        {row.original.status === "sent" ? "Delivered" : row.original.status}
      </span>
    ),
    size: 88,
  }),
  columnHelper.accessor("ageMin", {
    header: "Updated",
    cell: (info) => <span style={{ color: "#56627A", fontSize: "12px" }}>{info.row.original.age} ago</span>,
    size: 72,
  }),
  // Chevron
  columnHelper.display({
    id: "chevron",
    header: "",
    cell: () => <span style={{ color: "#8A93A5", fontSize: "15px" }}>›</span>,
    size: 30,
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
  const [searchQuery, setSearchQuery]   = useState(""); // for PO#, buyer, supplier search

  const queryClient = useQueryClient();
  const { data: rawOrders, isLoading, isError, refetch } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders(),
    staleTime: 30_000,
    enabled: !isApiMockMode,
  });

  // Memoize so react-table receives a STABLE `data` reference across renders.
  // Previously this was `(rawOrders ?? []).map(summaryToRow)` — a brand-new array
  // on EVERY render. In the live (non-mock) path the inbox is also subscribed to
  // TanStack Query, so it re-renders on query activity; each render handed
  // react-table a fresh `data` identity, which forced it to rebuild its row models
  // and produce new derived references, scheduling yet another render. Applying a
  // status filter tipped this into an unbounded re-render cascade that locked the
  // main thread (the reported hard freeze). Keying the memo on `rawOrders` keeps
  // the reference stable until the underlying query data actually changes.
  const ALL_ORDERS: OrderRow[] = useMemo(
    () => (isApiMockMode ? MOCK_ORDERS : (rawOrders ?? []).map(summaryToRow)),
    [rawOrders],
  );

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

  // Global search filter function
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        row.original.po.toLowerCase().includes(q) ||
        row.original.buyer.toLowerCase().includes(q) ||
        row.original.supplier.toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery]);

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
      <div className="flex flex-col h-full min-h-0 overflow-hidden items-center justify-center" style={{ background: "#F6F7FA" }}>
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
            <span style={{ fontSize: "22px", color: "#C53A3A" }}>⚠</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "#0B1A2F" }}>
            Couldn't load the queue
          </div>
          <div className="muted" style={{ fontSize: "13px", maxWidth: 380, margin: "6px auto 14px", color: "#56627A" }}>
            The order service returned <span className="font-mono" style={{ fontSize: "12px" }}>503</span> — your orders are safe and nothing was lost. This is usually transient.
          </div>
          <button
            onClick={() => refetch()}
            className="rounded-[6px] px-4 text-[12.5px] font-medium"
            style={{ height: 32, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            ↻ Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>

      {/* Page header */}
      <div
        className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:gap-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div className="flex-1">
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            Inbox
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {ALL_ORDERS.length.toLocaleString()} order{ALL_ORDERS.length !== 1 ? "s" : ""}
            {" · "}{ALL_ORDERS.filter((o) => o.status === "review").length} need review
            {" · "}{ALL_ORDERS.filter((o) => o.status === "failed").length} failed
            {selectedCount > 0 && <span style={{ color: "#1E66C9", marginLeft: 8 }}>· {selectedCount} selected</span>}
          </p>
        </div>

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
            style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
            onClick={() => router.push("/upload")}
          >
            ↑ Upload order
          </button>
        </div>
      </div>

      {/* Bulk action bar (shown full-width when selecting) */}
      {selectedCount > 0 && (
        <div
          className="flex items-center justify-between px-4 py-2 sm:px-6 flex-shrink-0"
          style={{ background: "#0B1A2F", color: "#FFFFFF" }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "12.5px", fontWeight: 600 }}>{selectedCount} selected</span>
            <button
              onClick={() => setRowSelection({})}
              style={{ background: "none", border: "none", color: "#8A93A5", fontSize: "12px", cursor: "pointer" }}
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              style={{
                background: "none",
                border: "none",
                color: "#FFFFFF",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
              }}
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
              Cross selected
            </button>
            <button
              style={{
                background: "none",
                border: "none",
                color: "#FFFFFF",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
              }}
              onClick={() => {}}
            >
              Export
            </button>
          </div>
        </div>
      )}

      {/* Filter chips + search input */}
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0">
          {FILTER_CHIPS.map(({ label }, i) => {
            const active = i === activeChip;
            return (
              <button
                key={label}
                onClick={() => handleChip(i)}
                className="flex items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors flex-shrink-0"
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
        </div>

        {/* Search input */}
        <div
          className="flex items-center gap-1.5 rounded-[6px] px-3 flex-shrink-0"
          style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", height: 32, minWidth: 160, maxWidth: 240 }}
        >
          <span style={{ fontSize: "14px", color: "#8A93A5", flexShrink: 0 }}>🔍</span>
          <input
            type="text"
            placeholder="Filter…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              border: "none",
              outline: "none",
              background: "none",
              fontSize: "12.5px",
              color: "#0B1A2F",
              flex: 1,
              minWidth: 0,
              padding: 0,
            }}
          />
        </div>
      </div>

      {/* ── Queue table / mobile route cards ──────────────────────────────────── */}
      <div className="flex-1 overflow-auto" style={{ background: "#FFFFFF" }}>
        <div className="divide-y divide-[#F0F2F6] md:hidden">
          {filteredRows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
              <div style={{ fontSize: 28, color: "#C6CDDA" }}>⊘</div>
              <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>Your inbox is clear</p>
              <p className="text-[13px]" style={{ color: "#56627A" }}>No orders match this filter. New orders land here automatically as buyers send them, or upload one yourself.</p>
              <button
                onClick={() => router.push("/upload")}
                style={{
                  marginTop: 8,
                  height: 32,
                  padding: "0 16px",
                  borderRadius: 6,
                  background: "#1E66C9",
                  color: "#FFFFFF",
                  border: "none",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ↑ Upload an order
              </button>
            </div>
          )}
          {filteredRows.map((row) => (
            <button
              key={row.id}
              className="block w-full px-4 py-3 text-left"
              style={{ background: "#FFFFFF", border: "none" }}
              onClick={() => router.push(`/inbox/${row.original.id}`)}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="truncate font-mono text-[12px] font-semibold" style={{ color: "#0F4FA8" }}>
                      {row.original.po}
                    </p>
                    {row.original.assigned !== "—" && (
                      <span
                        className="font-mono text-[9px] flex-shrink-0"
                        style={{
                          background: "#EEE7FB",
                          color: "#6F4FCE",
                          padding: "0 5px",
                          height: 16,
                          display: "flex",
                          alignItems: "center",
                          borderRadius: 3,
                        }}
                      >
                        AI
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11.5px]" style={{ color: "#8A93A5" }}>
                    {row.original.age} ago · {row.original.lines} lines · {row.original.valueLabel}
                  </p>
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontSize: "11px",
                    fontWeight: 600,
                    background:
                      row.original.status === "review"
                        ? "#FAEFD6"
                        : row.original.status === "failed"
                        ? "#FBE3E3"
                        : row.original.status === "sent"
                        ? "#E2F1E2"
                        : "#E3EDFB",
                    color:
                      row.original.status === "review"
                        ? "#C97A14"
                        : row.original.status === "failed"
                        ? "#C53A3A"
                        : row.original.status === "sent"
                        ? "#2E8E3A"
                        : "#1E66C9",
                    flexShrink: 0,
                    marginLeft: 8,
                  }}
                >
                  {row.original.status === "sent" ? "Delivered" : row.original.status}
                </span>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <FileChip type={row.original.fmt} />
                {row.original.issues > 0 && (
                  <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: "#FBE3E3", color: "#C53A3A" }}>
                    {row.original.issues} exceptions
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
            {filteredRows.map((row) => {
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
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: "center", padding: "64px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 16, color: "#C6CDDA" }}>⊘</div>
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
                  <p style={{ fontSize: 13, marginTop: 4, color: "#56627A", maxWidth: 380, margin: "8px auto 0" }}>
                    No orders match this filter. New orders land here automatically as buyers send them, or upload one yourself.
                  </p>
                  <button
                    onClick={() => router.push("/upload")}
                    style={{
                      marginTop: 16,
                      height: 32,
                      padding: "0 16px",
                      borderRadius: 6,
                      background: "#1E66C9",
                      color: "#FFFFFF",
                      border: "none",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ↑ Upload an order
                  </button>
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
          Showing {filteredRows.length.toLocaleString()} rows · {ALL_ORDERS.length.toLocaleString()} total
          {selectedCount > 0 && <span style={{ color: "#1E66C9" }}> · {selectedCount} selected</span>}
        </span>
      </div>
    </div>
  );
}
