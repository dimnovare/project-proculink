"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { OrderSummary, OrderStatus } from "@/types/procurement";

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  navy:        "#0B1A2F",
  bg:          "#F6F7FA",
  surface:     "#FFFFFF",
  surface2:    "#F1F3F7",
  border:      "#E2E6EE",
  borderFaint: "#EEF0F4",
  borderStrong:"#CBD0DA",
  ink:         "#0B1A2F",
  inkMuted:    "#56627A",
  inkFaint:    "#8A93A5",
  amber:       "#C97A14",
  amberBg:     "#FEF3C7",
  danger:      "#C53A3A",
  dangerBg:    "#FEE2E2",
  blue:        "#1E66C9",
  blueBg:      "#DBEAFE",
  green:       "#2E8E3A",
  greenBg:     "#DCFCE7",
  violet:      "#6F4FCE",
  violetBg:    "#EDE9FE",
  teal:        "#0F766E",
  tealBg:      "#CCFBF1",
  mono:        '"JetBrains Mono", ui-monospace, monospace',
  display:     '"Bricolage Grotesque", "Inter", system-ui, sans-serif',
  ui:          '"Inter", system-ui, sans-serif',
};

// ─── Source format chip ───────────────────────────────────────────────────────

const SRC_META: Record<string, { bg: string; color: string; label: string }> = {
  pdf:   { bg: T.dangerBg,  color: "#B91C1C", label: "PDF"   },
  csv:   { bg: T.blueBg,    color: "#1D4ED8", label: "CSV"   },
  xlsx:  { bg: T.greenBg,   color: "#15803D", label: "XLSX"  },
  cxml:  { bg: T.tealBg,    color: T.teal,    label: "cXML"  },
  edi:   { bg: T.amberBg,   color: "#B45309", label: "EDI"   },
  email: { bg: T.violetBg,  color: "#7C3AED", label: "EMAIL" },
};

function SrcChip({ format }: { format: string | null | undefined }) {
  if (!format) return null;
  const meta = SRC_META[format.toLowerCase()] ?? { bg: T.surface2, color: T.inkFaint, label: format.toUpperCase() };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      height: 20, padding: "0 6px", borderRadius: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
      background: meta.bg, color: meta.color,
      flexShrink: 0,
    }}>
      {meta.label}
    </span>
  );
}

// ─── Status dot (table-row variant, lighter than StatusBadge pill) ────────────

const STATUS_DOT: Record<string, { color: string; label: string; spin?: boolean }> = {
  parsing:          { color: T.blue,   label: "Parsing",       spin: true  },
  pending_review:   { color: T.amber,  label: "Needs review"               },
  ready:            { color: T.green,  label: "Ready"                      },
  transforming:     { color: T.blue,   label: "Transforming",  spin: true  },
  ready_to_deliver: { color: T.blue,   label: "Ready"                      },
  delivered:        { color: T.green,  label: "Delivered"                  },
  failed:           { color: T.danger, label: "Failed"                     },
  transform_failed: { color: T.danger, label: "Failed"                     },
  delivery_failed:  { color: T.danger, label: "Failed"                     },
};

function StatusDot({ status }: { status: string }) {
  const meta = STATUS_DOT[status] ?? { color: T.inkFaint, label: status };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%",
        background: meta.color, flexShrink: 0,
      }} />
      <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>
        {meta.label}
      </span>
    </span>
  );
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke={T.inkFaint} strokeWidth="1.4"/>
      <path d="M11 11l3 3" stroke={T.inkFaint} strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 3l6 6M9 3l-6 6" stroke={T.inkFaint} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M13 3v3.5h-3.5M3 13V9.5H6.5" stroke={T.inkMuted} strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M11.8 6.5A4.5 4.5 0 0 0 3.6 6M4.2 9.5a4.5 4.5 0 0 0 8.2.5" stroke={T.inkMuted} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
function IconUpload() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M8 11V3M5 6l3-3 3 3M3 12v1.5h10V12" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconChevronLeft() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M7.5 2.5L4 6l3.5 3.5" stroke={T.inkFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M4.5 2.5L8 6l-3.5 3.5" stroke={T.inkFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconChevronDown() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 4.5L6 8l3.5-3.5" stroke={T.inkMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Status dropdown ──────────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ value: OrderStatus | "all"; label: string }> = [
  { value: "all",            label: "All statuses"   },
  { value: "parsing",        label: "Parsing"        },
  { value: "pending_review", label: "Needs review"   },
  { value: "ready",          label: "Ready"          },
  { value: "transforming",   label: "Transforming"   },
  { value: "delivered",      label: "Delivered"      },
  { value: "failed",         label: "Failed"         },
];

function StatusDropdown({
  value,
  onChange,
}: {
  value: OrderStatus | "all";
  onChange: (v: OrderStatus | "all") => void;
}) {
  const [open, setOpen] = useState(false);
  const current = STATUS_OPTIONS.find(o => o.value === value) ?? STATUS_OPTIONS[0];
  const isFiltered = value !== "all";

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          height: 32, padding: "0 10px 0 12px",
          borderRadius: 6,
          background: isFiltered ? `${T.blue}0f` : T.surface,
          border: `1px solid ${isFiltered ? `${T.blue}40` : T.borderStrong}`,
          display: "inline-flex", alignItems: "center", gap: 8,
          fontSize: 12.5,
          color: isFiltered ? T.blue : T.inkMuted,
          fontWeight: isFiltered ? 600 : 400,
          cursor: "pointer", minWidth: 140,
          fontFamily: T.ui,
        }}
      >
        <span style={{ flex: 1, textAlign: "left" }}>{current.label}</span>
        <IconChevronDown />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0,
            width: 192, background: T.surface,
            border: `1px solid ${T.border}`, borderRadius: 8,
            boxShadow: "0 8px 24px rgba(11,26,47,0.10)", padding: "4px 4px", zIndex: 51,
          }}>
            {STATUS_OPTIONS.map(o => (
              <div
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  padding: "7px 10px", borderRadius: 5, fontSize: 12.5,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                  color: T.ink,
                  background: value === o.value ? T.surface2 : "transparent",
                  fontWeight: value === o.value ? 500 : 400,
                  fontFamily: T.ui,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = T.surface2)}
                onMouseLeave={e => (e.currentTarget.style.background = value === o.value ? T.surface2 : "transparent")}
              >
                {o.value !== "all" && (
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: (STATUS_DOT[o.value]?.color ?? T.inkFaint),
                  }} />
                )}
                {o.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Column header ────────────────────────────────────────────────────────────

function ColHead({
  label, sortKey, currentSort, onSort, align = "left",
}: {
  label: string;
  sortKey?: string;
  currentSort?: { key: string; dir: "asc" | "desc" };
  onSort?: (k: string) => void;
  align?: "left" | "right";
}) {
  const active = sortKey && currentSort?.key === sortKey;
  return (
    <th style={{ padding: "10px 0", textAlign: align, fontWeight: "normal" }}>
      {sortKey ? (
        <button
          style={{
            background: "transparent", border: 0, padding: 0,
            display: "inline-flex", alignItems: "center", gap: 4,
            color: active ? T.inkMuted : T.inkFaint,
            fontSize: 10.5, fontWeight: 500,
            textTransform: "uppercase", letterSpacing: "0.08em",
            cursor: "pointer", fontFamily: T.ui,
            justifyContent: align === "right" ? "flex-end" : "flex-start",
            width: "100%",
          }}
          onClick={() => onSort?.(sortKey)}
        >
          {label}
          {active && (
            <span style={{ fontSize: 9 }}>
              {currentSort?.dir === "asc" ? "↑" : "↓"}
            </span>
          )}
        </button>
      ) : (
        <span style={{
          display: "flex", alignItems: "center",
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          color: T.inkFaint, fontSize: 10.5, fontWeight: 500,
          textTransform: "uppercase", letterSpacing: "0.08em",
          fontFamily: T.ui,
        }}>
          {label}
        </span>
      )}
    </th>
  );
}

// ─── Time formatter ───────────────────────────────────────────────────────────

function fmtUpdated(iso: string): string {
  const d   = new Date(iso);
  const now = new Date();
  const todayStr = now.toDateString();
  const timeStr  = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  if (d.toDateString() === todayStr) return timeStr;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yest ${timeStr}`;

  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + timeStr;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtCurrency(value: number, currency = "EUR"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.bg, fontFamily: T.ui }}>
      <div style={{ padding: "28px 32px 22px", background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ width: 90, height: 28, borderRadius: 4, background: "#EDF0F5" }} />
        <div style={{ width: 160, height: 12, borderRadius: 3, background: "#EDF0F5", marginTop: 10 }} />
      </div>
      <div style={{ padding: "12px 32px", background: T.surface, borderBottom: `1px solid ${T.border}`, display: "flex", gap: 10 }}>
        <div style={{ width: 360, height: 32, borderRadius: 6, background: "#EDF0F5" }} />
        <div style={{ width: 140, height: 32, borderRadius: 6, background: "#EDF0F5" }} />
      </div>
      <div style={{ padding: "20px 32px 32px", flex: 1 }}>
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          {Array.from({ length: 6 }).map((_, r) => (
            <div key={r} style={{ padding: "14px 24px", borderTop: r > 0 ? `1px solid ${T.borderFaint}` : "none", display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ width: 36, height: 18, borderRadius: 3, background: "#EDF0F5" }} />
              <div style={{ width: 140, height: 13, borderRadius: 3, background: "#EDF0F5" }} />
              <div style={{ width: 120, height: 13, borderRadius: 3, background: "#EDF0F5" }} />
              <div style={{ width: 80, height: 13, borderRadius: 3, background: "#EDF0F5" }} />
              <div style={{ width: 40, height: 13, borderRadius: 3, background: "#EDF0F5" }} />
              <div style={{ width: 70, height: 13, borderRadius: 3, background: "#EDF0F5" }} />
              <div style={{ width: 70, height: 20, borderRadius: 10, background: "#EDF0F5" }} />
              <div style={{ width: 50, height: 13, borderRadius: 3, background: "#EDF0F5" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [query, setQuery]               = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [sort, setSort]                 = useState<{ key: string; dir: "asc" | "desc" }>({ key: "createdAt", dir: "desc" });

  const {
    data: orders = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["orders"],
    queryFn:  () => apiClient.getOrders(),
    retry: 2,
    refetchInterval: (query) =>
      query.state.data?.some((o: OrderSummary) =>
        o.status === "parsing" || o.status === "transforming",
      ) ? 8000 : false,
  });

  const toggleSort = (key: string) =>
    setSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });

  const filtered: OrderSummary[] = orders
    .filter((o: OrderSummary) => {
      const q = query.toLowerCase();
      return (
        (o.poNumber.toLowerCase().includes(q) ||
         o.supplierName.toLowerCase().includes(q) ||
         (o.buyerName ?? "").toLowerCase().includes(q)) &&
        (statusFilter === "all" || o.status === statusFilter)
      );
    })
    .sort((a: OrderSummary, b: OrderSummary) => {
      let cmp = 0;
      if      (sort.key === "createdAt")  cmp = new Date(a.createdAt).getTime()  - new Date(b.createdAt).getTime();
      else if (sort.key === "po")         cmp = a.poNumber.localeCompare(b.poNumber);
      else if (sort.key === "supplier")   cmp = a.supplierName.localeCompare(b.supplierName);
      else if (sort.key === "orderDate")  cmp = new Date(a.orderDate).getTime()  - new Date(b.orderDate).getTime();
      else if (sort.key === "lines")      cmp = a.lineCount - b.lineCount;
      else if (sort.key === "total")      cmp = (a.totalValue ?? 0) - (b.totalValue ?? 0);
      return sort.dir === "desc" ? -cmp : cmp;
    });

  const reviewCount = orders.filter((o: OrderSummary) => o.status === "pending_review").length;
  const failedCount = orders.filter((o: OrderSummary) => o.status === "failed" || o.status === "transform_failed" || o.status === "delivery_failed").length;

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.bg, fontFamily: T.ui }}>

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "26px 32px 20px",
        display: "flex", alignItems: "flex-end", gap: 24, flexShrink: 0,
      }}>
        <div>
          <h1 style={{
            margin: 0, fontFamily: T.display,
            fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em",
            color: T.ink, lineHeight: 1,
          }}>
            Orders
          </h1>
          {!isError && (
            <div style={{ marginTop: 6, fontSize: 12.5, color: T.inkMuted, display: "flex", alignItems: "center", gap: 0 }}>
              <span style={{ color: T.ink, fontWeight: 500 }}>{orders.length}</span>
              <span style={{ marginLeft: 4 }}>total</span>
              {reviewCount > 0 && (
                <>
                  <span style={{ margin: "0 8px", color: T.borderStrong }}>·</span>
                  <span style={{ color: T.amber, fontWeight: 600 }}>{reviewCount}</span>
                  <span style={{ marginLeft: 4 }}>need review</span>
                </>
              )}
              {failedCount > 0 && (
                <>
                  <span style={{ margin: "0 8px", color: T.borderStrong }}>·</span>
                  <span style={{ color: T.danger, fontWeight: 600 }}>{failedCount}</span>
                  <span style={{ marginLeft: 4 }}>failed</span>
                </>
              )}
            </div>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => refetch()}
            title="Refresh"
            style={{
              width: 32, height: 32, borderRadius: 6,
              background: "transparent", border: `1px solid ${T.border}`,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <IconRefresh />
          </button>
          <Link
            href="/upload"
            style={{
              height: 32, padding: "0 14px", borderRadius: 6,
              background: T.navy, color: "#fff",
              display: "inline-flex", alignItems: "center", gap: 7,
              fontSize: 12.5, fontWeight: 500, textDecoration: "none",
            }}
          >
            <IconUpload />
            Upload
          </Link>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div style={{
        padding: "10px 32px",
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        display: "flex", alignItems: "center", gap: 10,
        flexShrink: 0,
      }}>
        {/* Search */}
        <div style={{
          height: 32, flex: 1, maxWidth: 400,
          display: "flex", alignItems: "center", gap: 8,
          border: `1px solid ${T.borderStrong}`, borderRadius: 6,
          padding: "0 11px", background: T.surface,
        }}>
          <IconSearch />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by PO number, supplier, buyer or SKU…"
            style={{
              flex: 1, border: 0, outline: "none",
              fontSize: 12.5, background: "transparent",
              color: T.ink, fontFamily: T.ui,
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{
                background: "transparent", border: 0,
                cursor: "pointer", padding: 0,
                display: "inline-flex",
              }}
            >
              <IconClose />
            </button>
          )}
        </div>

        {/* Status filter */}
        <StatusDropdown value={statusFilter} onChange={setStatusFilter} />

        {/* Active filter count */}
        {filtered.length !== orders.length && (
          <span style={{ fontSize: 11.5, color: T.inkFaint, whiteSpace: "nowrap" }}>
            {filtered.length} of {orders.length}
          </span>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto", padding: "18px 32px 32px" }}>
        {isError ? (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: "48px 32px", textAlign: "center",
          }}>
            <p style={{ fontSize: 13, color: T.danger, margin: "0 0 12px", fontFamily: T.ui }}>
              Failed to load orders: {error instanceof Error ? error.message : "Unknown error"}
            </p>
            <button
              onClick={() => refetch()}
              style={{
                height: 32, padding: "0 16px", borderRadius: 6,
                border: `1px solid ${T.border}`, background: T.surface,
                fontSize: 12.5, color: T.ink, cursor: "pointer", fontFamily: T.ui,
              }}
            >
              Retry
            </button>
          </div>

        ) : filtered.length === 0 ? (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: "64px 32px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 11, background: T.surface2,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.inkFaint} strokeWidth="1.5">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>No orders found</span>
            <span style={{ fontSize: 12.5, color: T.inkMuted }}>
              {query || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "Upload your first purchase order to get started"}
            </span>
            {!query && statusFilter === "all" && (
              <Link
                href="/upload"
                style={{
                  marginTop: 8, height: 34, padding: "0 18px", borderRadius: 7,
                  background: T.navy, color: "#fff",
                  display: "inline-flex", alignItems: "center",
                  fontSize: 12.5, fontWeight: 500, textDecoration: "none",
                }}
              >
                Upload Order
              </Link>
            )}
          </div>

        ) : (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
            overflow: "hidden",
          }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {/* PO NUMBER */}
                    <th style={{ padding: "10px 0 10px 20px", width: 240 }}>
                      <span style={{
                        display: "flex", alignItems: "center", gap: 4,
                        color: T.inkFaint, fontSize: 10.5, fontWeight: 500,
                        textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: T.ui,
                      }}>
                        PO Number
                      </span>
                    </th>
                    {/* SUPPLIER */}
                    <ColHead label="Supplier" sortKey="supplier" currentSort={sort} onSort={toggleSort} />
                    {/* DATE */}
                    <ColHead label="Date" sortKey="orderDate" currentSort={sort} onSort={toggleSort} />
                    {/* LINES */}
                    <ColHead label="Lines" sortKey="lines" currentSort={sort} onSort={toggleSort} align="right" />
                    {/* TOTAL */}
                    <ColHead label="Total" sortKey="total" currentSort={sort} onSort={toggleSort} align="right" />
                    {/* STATUS */}
                    <ColHead label="Status" />
                    {/* UPDATED */}
                    <ColHead label="Updated" sortKey="createdAt" currentSort={sort} onSort={toggleSort} align="right" />
                    <th style={{ width: 20, padding: "10px 20px 10px 0" }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((order: OrderSummary) => (
                    <tr
                      key={order.id}
                      style={{ borderTop: `1px solid ${T.borderFaint}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = T.surface2)}
                      onMouseLeave={e => (e.currentTarget.style.background = T.surface)}
                    >
                      {/* PO Number + source chip */}
                      <td style={{ padding: "13px 16px 13px 20px", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <SrcChip format={order.sourceFormat} />
                          <Link
                            href={`/orders/${order.id}`}
                            style={{
                              fontFamily: T.mono, fontSize: 12.5, fontWeight: 500,
                              color: T.ink, textDecoration: "none",
                            }}
                            onMouseEnter={e => ((e.target as HTMLElement).style.color = T.blue)}
                            onMouseLeave={e => ((e.target as HTMLElement).style.color = T.ink)}
                          >
                            {order.poNumber}
                          </Link>
                        </div>
                      </td>

                      {/* Supplier + buyer (from) */}
                      <td style={{ padding: "13px 16px 13px 0", verticalAlign: "middle", maxWidth: 220 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 500, color: T.ink,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {order.supplierName}
                        </div>
                        {order.buyerName && (
                          <div style={{
                            fontSize: 11.5, color: T.inkFaint, marginTop: 1,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            from {order.buyerName}
                          </div>
                        )}
                      </td>

                      {/* Date */}
                      <td style={{ padding: "13px 16px 13px 0", verticalAlign: "middle" }}>
                        <span style={{ fontSize: 12.5, color: T.inkMuted }}>{fmtDate(order.orderDate)}</span>
                      </td>

                      {/* Lines (+ unresolved count) */}
                      <td style={{ padding: "13px 16px 13px 0", verticalAlign: "middle", textAlign: "right" }}>
                        <span style={{ fontFamily: T.mono, fontSize: 13, color: T.ink }}>
                          {order.lineCount}
                        </span>
                        {order.unresolvedCount > 0 && (
                          <span style={{ fontFamily: T.mono, fontSize: 12, color: T.amber, marginLeft: 4 }}>
                            · {order.unresolvedCount}
                          </span>
                        )}
                      </td>

                      {/* Total */}
                      <td style={{ padding: "13px 16px 13px 0", verticalAlign: "middle", textAlign: "right" }}>
                        {order.totalValue != null && order.currency ? (
                          <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.ink }}>
                            {fmtCurrency(order.totalValue, order.currency)}
                          </span>
                        ) : (
                          <span style={{ color: T.inkFaint, fontSize: 12 }}>—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "13px 16px 13px 0", verticalAlign: "middle" }}>
                        <StatusDot status={order.status} />
                      </td>

                      {/* Updated */}
                      <td style={{ padding: "13px 0 13px 0", verticalAlign: "middle", textAlign: "right" }}>
                        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkFaint }}>
                          {fmtUpdated(order.createdAt)}
                        </span>
                      </td>

                      <td style={{ width: 20, padding: "13px 20px 13px 0" }} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            <div style={{
              padding: "11px 20px",
              background: T.surface, borderTop: `1px solid ${T.border}`,
              display: "flex", alignItems: "center",
              fontSize: 12, color: T.inkMuted, fontFamily: T.ui,
            }}>
              <span>
                Showing{" "}
                <span style={{ color: T.ink, fontWeight: 500 }}>{filtered.length}</span>
                {" "}of{" "}
                <span style={{ color: T.ink, fontWeight: 500 }}>{orders.length}</span>
              </span>
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <button style={{ background: "transparent", border: 0, cursor: "pointer", padding: 4, opacity: 0.4, display: "inline-flex" }}>
                  <IconChevronLeft />
                </button>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkFaint }}>1 / 1</span>
                <button style={{ background: "transparent", border: 0, cursor: "pointer", padding: 4, opacity: 0.4, display: "inline-flex" }}>
                  <IconChevronRight />
                </button>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
