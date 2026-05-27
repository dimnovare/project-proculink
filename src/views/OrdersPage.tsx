"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { OrderSummary, OrderStatus } from "@/types/procurement";
import { StatusBadge } from "@/components/ui/status-badge";

// ─── Design tokens (from The Bridge Layer design system) ──────────────────────
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
  amberSoft:   "#FAEFD6",
  danger:      "#C53A3A",
  blue:        "#1E66C9",
  green:       "#2E8E3A",
  mono:        '"JetBrains Mono", ui-monospace, monospace',
  display:     '"Bricolage Grotesque", "Inter", system-ui, sans-serif',
  ui:          '"Inter", system-ui, sans-serif',
};

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
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 4.5L6 8l3.5-3.5" stroke={T.inkFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          height: 32, padding: "0 12px",
          borderRadius: 6, background: T.surface,
          border: `1px solid ${T.borderStrong}`,
          display: "inline-flex", alignItems: "center", gap: 10,
          fontSize: 12.5, color: T.ink, fontWeight: 500,
          cursor: "pointer", minWidth: 160,
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
            width: 200, background: T.surface,
            border: `1px solid ${T.border}`, borderRadius: 8,
            boxShadow: "0 8px 24px rgba(11,26,47,0.10)", padding: 4, zIndex: 51,
          }}>
            {STATUS_OPTIONS.map(o => (
              <div
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  padding: "7px 10px", borderRadius: 5, fontSize: 12.5, cursor: "pointer",
                  color: T.ink, background: value === o.value ? T.surface2 : "transparent",
                  fontWeight: value === o.value ? 500 : 400,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = T.surface2)}
                onMouseLeave={e => (e.currentTarget.style.background = value === o.value ? T.surface2 : "transparent")}
              >
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
  const style: React.CSSProperties = {
    background: "transparent", border: 0, padding: 0,
    display: "inline-flex", alignItems: "center", gap: 4,
    color: active ? T.inkMuted : T.inkFaint,
    fontSize: 10.5, fontWeight: 500,
    textTransform: "uppercase", letterSpacing: "0.08em",
    cursor: sortKey ? "pointer" : "default",
    fontFamily: T.ui,
    justifyContent: align === "right" ? "flex-end" : "flex-start",
    width: "100%",
  };
  return (
    <th style={{ padding: "10px 0", textAlign: align }}>
      {sortKey ? (
        <button style={style} onClick={() => onSort?.(sortKey)}>
          {label}
          {active && <span style={{ fontSize: 9 }}>{currentSort?.dir === "asc" ? "↑" : "↓"}</span>}
        </button>
      ) : (
        <span style={{ ...style, display: "flex" }}>{label}</span>
      )}
    </th>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.bg }}>
      <div style={{ padding: "28px 32px 22px", background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ width: 100, height: 28, borderRadius: 4, background: "#EDF0F5" }} />
        <div style={{ width: 160, height: 12, borderRadius: 3, background: "#EDF0F5", marginTop: 10 }} />
      </div>
      <div style={{ padding: "14px 32px", background: T.surface, borderBottom: `1px solid ${T.border}`, display: "flex", gap: 10 }}>
        <div style={{ width: 360, height: 32, borderRadius: 6, background: "#EDF0F5" }} />
        <div style={{ width: 160, height: 32, borderRadius: 6, background: "#EDF0F5" }} />
      </div>
      <div style={{ padding: "20px 32px 32px", flex: 1 }}>
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 24px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 20 }}>
            {[120, 160, 80, 50, 80, 100, 60].map((w, i) => (
              <div key={i} style={{ width: w, height: 10, borderRadius: 3, background: "#EDF0F5" }} />
            ))}
          </div>
          {Array.from({ length: 7 }).map((_, r) => (
            <div key={r} className="animate-pulse" style={{ padding: "16px 24px", borderTop: `1px solid ${T.borderFaint}`, display: "flex", gap: 20, alignItems: "center" }}>
              {[120, 160, 80, 50, 80, 100, 60].map((w, c) => (
                <div key={c} style={{ width: w, height: 12, borderRadius: 3, background: "#EDF0F5", flexShrink: 0 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [query, setQuery]           = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [sort, setSort]             = useState<{ key: string; dir: "asc" | "desc" }>({ key: "createdAt", dir: "desc" });

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
        (o.poNumber.toLowerCase().includes(q) || o.supplierName.toLowerCase().includes(q)) &&
        (statusFilter === "all" || o.status === statusFilter)
      );
    })
    .sort((a: OrderSummary, b: OrderSummary) => {
      let cmp = 0;
      if (sort.key === "createdAt") cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      else if (sort.key === "po") cmp = a.poNumber.localeCompare(b.poNumber);
      else if (sort.key === "supplier") cmp = a.supplierName.localeCompare(b.supplierName);
      else if (sort.key === "orderDate") cmp = new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime();
      else if (sort.key === "lines") cmp = a.lineCount - b.lineCount;
      return sort.dir === "desc" ? -cmp : cmp;
    });

  const reviewCount = orders.filter((o: OrderSummary) => o.status === "pending_review").length;
  const failedCount = orders.filter((o: OrderSummary) => o.status === "failed").length;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const fmtRelative = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  };

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.bg, fontFamily: T.ui }}>

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "28px 32px 22px",
        display: "flex", alignItems: "flex-end", gap: 24, flexShrink: 0,
      }}>
        <div>
          <h1 style={{
            margin: 0, fontFamily: T.display,
            fontSize: 28, fontWeight: 600, letterSpacing: "-0.022em",
            color: T.ink, lineHeight: 1,
          }}>
            Orders
          </h1>
          {!isError && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: T.inkMuted }}>
              <span style={{ color: T.ink }}>{orders.length}</span> total
              {reviewCount > 0 && (
                <>
                  <span style={{ margin: "0 8px", color: T.borderStrong }}>·</span>
                  <span style={{ color: T.amber, fontWeight: 500 }}>{reviewCount}</span>
                  <span style={{ marginLeft: 5 }}>need review</span>
                </>
              )}
              {failedCount > 0 && (
                <>
                  <span style={{ margin: "0 8px", color: T.borderStrong }}>·</span>
                  <span style={{ color: T.danger, fontWeight: 500 }}>{failedCount}</span>
                  <span style={{ marginLeft: 5 }}>failed</span>
                </>
              )}
            </div>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
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
        padding: "12px 32px",
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        display: "flex", alignItems: "center", gap: 10,
        flexShrink: 0,
      }}>
        <div style={{
          height: 32, flex: 1, maxWidth: 420,
          display: "flex", alignItems: "center", gap: 9,
          background: T.surface,
          border: `1px solid ${T.borderStrong}`, borderRadius: 6,
          padding: "0 12px",
        }}>
          <IconSearch />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by PO number or supplier…"
            style={{
              flex: 1, border: 0, outline: "none",
              fontSize: 12.5, background: "transparent", color: T.ink,
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{
                background: "transparent", border: 0,
                cursor: "pointer", padding: 0,
                display: "inline-flex", color: T.inkFaint,
              }}
            >
              <IconClose />
            </button>
          )}
        </div>
        <StatusDropdown value={statusFilter} onChange={setStatusFilter} />
        {filtered.length !== orders.length && (
          <span style={{ fontSize: 11.5, color: T.inkFaint, whiteSpace: "nowrap" }}>
            {filtered.length} of {orders.length}
          </span>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 32px 32px" }}>
        {isError ? (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: "48px 32px", textAlign: "center",
          }}>
            <p style={{ fontSize: 13, color: T.danger, margin: "0 0 12px" }}>
              Failed to load orders: {error instanceof Error ? error.message : "Unknown error"}
            </p>
            <button
              onClick={() => refetch()}
              style={{
                height: 32, padding: "0 16px", borderRadius: 6,
                border: `1px solid ${T.border}`, background: T.surface,
                fontSize: 12.5, color: T.ink, cursor: "pointer",
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
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.surface }}>
                    <th style={{ width: 24, padding: "10px 0 10px 24px" }} />
                    <ColHead
                      label="PO Number" sortKey="po"
                      currentSort={sort} onSort={toggleSort}
                    />
                    <ColHead
                      label="Supplier" sortKey="supplier"
                      currentSort={sort} onSort={toggleSort}
                    />
                    <ColHead
                      label="Date" sortKey="orderDate"
                      currentSort={sort} onSort={toggleSort}
                    />
                    <ColHead
                      label="Lines" sortKey="lines"
                      currentSort={sort} onSort={toggleSort}
                      align="right"
                    />
                    <ColHead label="Status" />
                    <ColHead
                      label="Updated" sortKey="createdAt"
                      currentSort={sort} onSort={toggleSort}
                      align="right"
                    />
                    <th style={{ width: 24, padding: "10px 24px 10px 0" }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((order: OrderSummary, i: number) => (
                    <tr
                      key={order.id}
                      style={{ borderTop: `1px solid ${T.borderFaint}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = T.surface2)}
                      onMouseLeave={e => (e.currentTarget.style.background = T.surface)}
                    >
                      {/* spacer */}
                      <td style={{ padding: "14px 0 14px 24px", width: 24 }} />

                      {/* PO Number */}
                      <td style={{ padding: "14px 16px 14px 0", verticalAlign: "middle" }}>
                        <Link
                          href={`/orders/${order.id}`}
                          style={{
                            fontFamily: T.mono, fontSize: 12.5, fontWeight: 500,
                            color: T.ink, textDecoration: "none", letterSpacing: "-0.005em",
                          }}
                          onMouseEnter={e => ((e.target as HTMLElement).style.color = T.blue)}
                          onMouseLeave={e => ((e.target as HTMLElement).style.color = T.ink)}
                        >
                          {order.poNumber}
                        </Link>
                      </td>

                      {/* Supplier */}
                      <td style={{ padding: "14px 16px 14px 0", verticalAlign: "middle", maxWidth: 240 }}>
                        <div style={{
                          fontSize: 13, color: T.ink, fontWeight: 500,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {order.supplierName}
                        </div>
                      </td>

                      {/* Date */}
                      <td style={{ padding: "14px 16px 14px 0", verticalAlign: "middle" }}>
                        <span style={{ fontSize: 12.5, color: T.inkMuted }}>{fmtDate(order.orderDate)}</span>
                      </td>

                      {/* Lines (+ unresolved inline) */}
                      <td style={{ padding: "14px 16px 14px 0", verticalAlign: "middle", textAlign: "right" }}>
                        {order.unresolvedCount > 0 ? (
                          <span>
                            <span style={{ fontFamily: T.mono, fontSize: 13, color: T.ink }}>{order.lineCount}</span>
                            <span style={{ color: T.amber, fontWeight: 500, marginLeft: 4, fontSize: 11.5 }}>
                              · {order.unresolvedCount}
                            </span>
                          </span>
                        ) : (
                          <span style={{ fontFamily: T.mono, fontSize: 13, color: T.ink }}>{order.lineCount}</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "14px 16px 14px 0", verticalAlign: "middle" }}>
                        <StatusBadge status={order.status} size="sm" />
                      </td>

                      {/* Updated */}
                      <td style={{ padding: "14px 0 14px 0", verticalAlign: "middle", textAlign: "right" }}>
                        <span style={{ fontSize: 11.5, color: T.inkFaint }}>{fmtRelative(order.createdAt)}</span>
                      </td>

                      {/* spacer */}
                      <td style={{ padding: "14px 24px 14px 0", width: 24 }} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            <div style={{
              padding: "12px 24px",
              background: T.surface, borderTop: `1px solid ${T.border}`,
              display: "flex", alignItems: "center",
              fontSize: 11.5, color: T.inkMuted,
            }}>
              <span>
                Showing{" "}
                <span style={{ color: T.ink, fontWeight: 500 }}>{filtered.length}</span>
                {" "}of{" "}
                <span style={{ color: T.ink, fontWeight: 500 }}>{orders.length}</span>
              </span>
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
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
