"use client";

// Inbox — TanStack Table order queue
// Sort on every column header · filter chips by status · bulk-select rows
// Click a row → /inbox/[orderId] (Canonical Spine Review)

import { useRouter } from "next/navigation";
import { useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
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
} from "@tanstack/react-table";
import { FileChip } from "./FileChip";
import { StatusJourney, type CrossingStatus, type OrderStage } from "./StatusJourney";
import { useOrderDirection, type PartyLabels } from "@/hooks/useOrderDirection";

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
const STATUS_PRESENTATION: Record<
  CrossingStatus,
  { key: string; label: string; stage: OrderStage }
> = {
  new:        { key: "new",        label: "New",          stage: 0 },
  extracting: { key: "extracting", label: "Extracting",   stage: 1 },
  review:     { key: "review",     label: "Needs review", stage: 2 },
  ready:      { key: "ready",      label: "Ready",        stage: 3 },
  sent:       { key: "sent",       label: "Delivered",    stage: 4 },
  delivering: { key: "delivering", label: "Delivering",   stage: 4 },
  failed:     { key: "failed",     label: "Failed",       stage: "failed" },
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
// "Ready to send" filters `ready_to_deliver` (mock CrossingStatus "ready") —
// the old "Delivering" chip filtered `ready_to_deliver` too but mislabelled it
// (no persisted `delivering` status exists, so it never matched its label).
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
  { label: "Ready to send", status: "ready",  api: "ready_to_deliver", summaryKeys: ["ready_to_deliver"] },
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
  // Checkbox select
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <input
        type="checkbox"
        style={{ accentColor: BLUE, cursor: "pointer", width: 13, height: 13 }}
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        style={{ accentColor: BLUE, cursor: "pointer", width: 13, height: 13 }}
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
          <span className="font-mono text-[12px] font-semibold" style={{ color: INK }}>
            {info.getValue()}
          </span>
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
  // Buyer → Supplier (or Customer → You in inbound mode)
  columnHelper.display({
    id: "lane",
    header: labels.railHeader,
    cell: ({ row }) => {
      const buyer = row.original.buyer;
      const hasBuyer = buyer != null && buyer.trim() !== "" && buyer.trim() !== "—";
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "12.5px" }}>
          <span style={{ color: hasBuyer ? BLUE_DEEP : "#8A93A5", fontWeight: hasBuyer ? 500 : 400, flex: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}>
            {hasBuyer ? buyer : labels.unknownBuyer}
          </span>
          <span style={{ color: "#8A93A5", flexShrink: 0 }}>→</span>
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
  // Pipeline — standalone 5-node track (status pill lives in its own column)
  columnHelper.accessor("status", {
    header: "Pipeline",
    cell: (info) => (
      <div style={{ minWidth: 132, maxWidth: 176 }}>
        <StatusJourney stage={STATUS_PRESENTATION[info.getValue()].stage} compact />
      </div>
    ),
    size: 184,
  }),
  // Status pill — soft rounded-full pill with leading dot + full semantic label
  columnHelper.display({
    id: "statusPill",
    header: "Status",
    cell: ({ row }) => <StatusDotPill status={row.original.status} />,
    size: 124,
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
}

// ─── Sort indicator ───────────────────────────────────────────────────────────

function SortIcon({ state }: { state: "asc" | "desc" | false }) {
  return (
    <span style={{ fontSize: 10, color: state ? BLUE_DEEP : "#C6CDDA", marginLeft: 4, userSelect: "none" }}>
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
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const clerkReady = clerkLoaded && !!isSignedIn;
  const { direction, labels } = useOrderDirection();
  // Columns depend only on direction labels — memoise so react-table receives a
  // stable reference (rebuilt only when the org's direction changes).
  const columns = useMemo(() => buildColumns(labels), [labels]);
  // Empty-state copy: outbound orders arrive from buyers; inbound from customers.
  const emptyStateCopy =
    direction === "inbound"
      ? "No orders match this filter. New orders land here automatically as customers send them, or upload one yourself."
      : "No orders match this filter. New orders land here automatically as buyers send them, or upload one yourself.";
  const [sorting, setSorting]           = useState<SortingState>([{ id: "ageMin", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [activeChip, setActiveChip]     = useState(0); // index into FILTER_CHIPS
  const [searchInput, setSearchInput]   = useState(""); // controlled search-box value
  const [search, setSearch]             = useState(""); // committed (debounced) server search
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>(undefined); // live ?status=
  const [page, setPage]                 = useState(1);  // 1-based page index
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bulk "Send selected" lifecycle: idle while no request is in flight, then a
  // visible pending → result feedback so the action is never a silent no-op.
  const [bulkSending, setBulkSending]   = useState(false);
  const [bulkResult, setBulkResult]     = useState<{ ok: boolean; text: string } | null>(null);

  const queryClient = useQueryClient();
  // Live (non-mock) path: the backend returns a paginated envelope and applies
  // status + search filters server-side. A distinct query key keeps this apart
  // from the lightweight ["orders"] working-set used by sidebar/topbar/dashboard.
  const { data: ordersPage, isLoading, isError, refetch } = useQuery({
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
  // counts rendered only under isApiMockMode). Gated on (mock OR clerkReady) per the
  // query rule — mock mode has no Clerk session.
  const { data: summary } = useQuery({
    queryKey: ["orders", "summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    staleTime: 30_000,
    enabled: isApiMockMode || clerkReady,
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
  const handleSearch = useCallback((value: string) => {
    setSearchInput(value);
    setPage(1);
    if (isApiMockMode) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 350);
  }, []);

  // Bulk "Send selected": selection keys are order ids (see getRowId). Re-deliver
  // each in parallel, surface a pending state, then a success/failure summary
  // instead of silently firing and forgetting.
  const handleSendSelected = useCallback(async () => {
    const ids = Object.keys(rowSelection);
    if (!ids.length || bulkSending) return;
    setBulkSending(true);
    setBulkResult(null);
    try {
      // Route through apiClient.redeliverOrder so the Clerk auth header is
      // attached (a raw fetch here 401'd for real users). It resolves on
      // success and throws on failure → map each to a boolean.
      const results = await Promise.all(
        ids.map((id) =>
          apiClient
            .redeliverOrder(id)
            .then(() => true)
            .catch(() => false),
        ),
      );
      const sent = results.filter(Boolean).length;
      const failed = results.length - sent;
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      if (failed === 0) {
        setBulkResult({ ok: true, text: `${sent} order${sent !== 1 ? "s" : ""} sent` });
        setRowSelection({});
      } else {
        setBulkResult({
          ok: false,
          text: sent > 0 ? `${sent} sent · ${failed} failed` : `Couldn't send ${failed} order${failed !== 1 ? "s" : ""}`,
        });
      }
    } catch {
      setBulkResult({ ok: false, text: "Send failed — please retry" });
    } finally {
      setBulkSending(false);
    }
  }, [rowSelection, bulkSending, queryClient]);

  const table = useReactTable({
    data: ALL_ORDERS,
    columns,
    // Stable row id keyed on the order id (not the array index). Selection keys are
    // therefore order ids, so bulk actions resolve to the correct orders regardless
    // of current sort / filter / page — never positional `rows[index]` lookups.
    getRowId: (row) => row.id,
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

  // Loading state
  if (!isApiMockMode && isLoading) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
        <div
          className="flex-1 min-h-0 flex flex-col gap-0 overflow-hidden m-4 sm:m-6"
          style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12 }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5 border-b border-[#F0F2F6]">
              <div className="h-5 w-24 rounded bg-[#E2E6EE] animate-pulse" />
              <div className="h-5 flex-1 rounded bg-[#EEF1F6] animate-pulse" />
              <div className="h-5 w-24 rounded bg-[#EEF1F6] animate-pulse" />
              <div className="h-5 w-16 rounded bg-[#EEF1F6] animate-pulse" />
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

      {/* Page header — sits on the grey canvas, table floats below in a white card */}
      <div
        className="flex flex-col items-start gap-3 px-4 pt-5 pb-3 sm:px-6 lg:flex-row lg:items-center lg:gap-4 flex-shrink-0"
        style={{ background: "#F6F7FA" }}
      >
        <div className="flex-1">
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            Inbox
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {totalCount.toLocaleString()} order{totalCount !== 1 ? "s" : ""}
            {" · "}{reviewCount.toLocaleString()} need review{" · "}{failedCount.toLocaleString()} failed
            {selectedCount > 0 && <span style={{ color: BLUE_DEEP, marginLeft: 8 }}>· {selectedCount} selected</span>}
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
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-semibold transition-colors"
            style={{ height: 32, background: BLUE, color: "#FFFFFF", border: 0 }}
            onClick={() => router.push("/upload")}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = BLUE_DEEP; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = BLUE; }}
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
              onClick={() => { setRowSelection({}); setBulkResult(null); }}
              style={{ background: "none", border: "none", color: "#8A93A5", fontSize: "12px", cursor: "pointer" }}
            >
              Clear
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
          </div>
        </div>
      )}

      {/* Filter chips + search input — toolbar on the grey canvas, above the table card.
          Mobile: chips on a horizontal-scroll row, search full-width on its own row below.
          sm+: both sit side by side on one row. */}
      <div
        className="flex flex-col gap-2 px-4 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-6 flex-shrink-0"
        style={{ background: "#F6F7FA" }}
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
                  border: `1px solid ${active ? INK : "#E2E6EE"}`,
                  background: active ? INK : "#FFFFFF",
                  color: active ? "#FFFFFF" : "#56627A",
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
                    background: active ? "rgba(255,255,255,0.16)" : "#EFF2F7",
                    color: active ? "#FFFFFF" : "#56627A",
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
          style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", height: 32 }}
        >
          <span aria-hidden="true" style={{ fontSize: "14px", color: "#8A93A5", flexShrink: 0 }}>🔍</span>
          <input
            type="text"
            aria-label="Search orders"
            placeholder="Search PO, buyer, supplier…"
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
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

      {/* ── Queue table / mobile route cards — floating white card on grey canvas ── */}
      <div
        className="flex-1 min-h-0 overflow-auto mx-4 sm:mx-6 mb-3"
        style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12 }}
      >
        <div className="flex flex-col gap-2.5 p-3 lg:hidden">
          {pagedRows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
              <div style={{ fontSize: 28, color: "#C6CDDA" }}>⊘</div>
              {isFiltered ? (
                <>
                  <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>No matching orders</p>
                  <p className="text-[13px]" style={{ color: "#56627A" }}>
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
                      border: "1px solid #E2E6EE",
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
                  <p className="text-[13px]" style={{ color: "#56627A" }}>{emptyStateCopy}</p>
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
                </>
              )}
            </div>
          )}
          {pagedRows.map((row) => (
            <button
              key={row.id}
              className="block w-full rounded-[10px] px-4 py-3.5 text-left transition-colors active:bg-[#F6F7FA]"
              style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.05)", minHeight: 44 }}
              onClick={() => router.push(`/inbox/${row.original.id}`)}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="truncate font-mono text-[13px] font-semibold" style={{ color: INK }}>
                      {row.original.po}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: "#8A93A5" }}>
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
                  <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: "#FBE3E3", color: "#C53A3A" }}>
                    {row.original.issues} exceptions
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
                      <span className="text-[11.5px]" style={{ color: "#8A93A5" }}>{labels.unknownBuyer}</span>
                      <span aria-hidden style={{ color: "#C6CDDA" }}>→</span>
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
                    <span aria-hidden className="text-[11px] leading-none sm:hidden" style={{ color: "#C6CDDA" }}>↓</span>
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
          {/* Colgroup for fixed widths */}
          <colgroup>
            {table.getAllColumns().map((col) => (
              <col key={col.id} style={{ width: col.getSize() }} />
            ))}
          </colgroup>

          {/* Sticky header */}
          <thead style={{ position: "sticky", top: 0, zIndex: 4 }}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
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
                        padding: "11px 10px",
                        paddingLeft: hi === 0 ? 16 : 10,
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

          <tbody>
            {pagedRows.map((row) => {
              const isSelected = row.getIsSelected();
              return (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/inbox/${row.original.id}`)}
                  style={{
                    height: 56,
                    borderBottom: "1px solid #F0F2F6",
                    cursor: "pointer",
                    background: isSelected
                      ? "#E3EDFB"
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
                  {row.getVisibleCells().map((cell, ci) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: "9px 10px",
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
            {pagedRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: "center", padding: "64px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 16, color: "#C6CDDA" }}>⊘</div>
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
                      <p style={{ fontSize: 13, marginTop: 4, color: "#56627A", maxWidth: 380, margin: "8px auto 0" }}>
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
                          border: "1px solid #E2E6EE",
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
                      <p style={{ fontSize: 13, marginTop: 4, color: "#56627A", maxWidth: 380, margin: "8px auto 0" }}>
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
        className="flex-shrink-0 flex flex-wrap items-center gap-3 px-4 sm:px-6 pb-3 pt-0.5"
        style={{ background: "#F6F7FA" }}
      >
        <span className="text-[11px]" style={{ color: "#8A93A5" }}>
          {totalCount.toLocaleString()} order{totalCount !== 1 ? "s" : ""}
          {selectedCount > 0 && <span style={{ color: BLUE_DEEP }}> · {selectedCount} selected</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="rounded-[6px] px-2.5 text-[12px] font-medium"
            style={{ height: 28, border: "1px solid #E2E6EE", background: "#FFFFFF", color: currentPage <= 1 ? "#C6CDDA" : "#0B1A2F", cursor: currentPage <= 1 ? "default" : "pointer" }}
          >
            ← Prev
          </button>
          <span className="text-[11px] font-mono" style={{ color: "#56627A", minWidth: 92, textAlign: "center" }}>
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="rounded-[6px] px-2.5 text-[12px] font-medium"
            style={{ height: 28, border: "1px solid #E2E6EE", background: "#FFFFFF", color: currentPage >= totalPages ? "#C6CDDA" : "#0B1A2F", cursor: currentPage >= totalPages ? "default" : "pointer" }}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
