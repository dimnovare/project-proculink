"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Upload, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { OrderSummary, OrderStatus } from "@/types/procurement";
import { StatusBadge } from "@/components/ui/status-badge";

// ─── Status filter options ────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ value: OrderStatus | "all"; label: string }> = [
  { value: "all",            label: "All statuses"    },
  { value: "parsing",        label: "Parsing"         },
  { value: "pending_review", label: "Pending Review"  },
  { value: "ready",          label: "Ready"           },
  { value: "transforming",   label: "Transforming"    },
  { value: "delivered",      label: "Delivered"       },
  { value: "failed",         label: "Failed"          },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ColHeader({
  children,
  onClick,
  sorted,
  dir,
  align = "left",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  sorted?: boolean;
  dir?: "asc" | "desc";
  align?: "left" | "right";
}) {
  const base: React.CSSProperties = {
    padding: "8px 16px",
    fontSize: 11,
    fontWeight: 600,
    color: "#56627A",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    textAlign: align,
    whiteSpace: "nowrap",
    background: "#FAFBFC",
    borderBottom: "1px solid #E2E6EE",
  };
  if (onClick) {
    return (
      <th style={{ ...base, cursor: "pointer" }} onClick={onClick}>
        {children}
        <span style={{ marginLeft: 4, opacity: sorted ? 1 : 0.35, fontSize: 9 }}>
          {sorted ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </th>
    );
  }
  return <th style={base}>{children}</th>;
}

const TD: React.CSSProperties = {
  padding: "10px 16px",
  verticalAlign: "middle",
  borderBottom: "1px solid #F0F2F6",
};

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#F6F7FA" }}>
      {/* header */}
      <div style={{ padding: "16px 24px", background: "#FFFFFF", borderBottom: "1px solid #E2E6EE" }}>
        <div style={{ width: 160, height: 20, borderRadius: 4, background: "#EDF0F5" }} />
        <div style={{ width: 80, height: 12, borderRadius: 3, background: "#EDF0F5", marginTop: 6 }} />
      </div>
      {/* filter bar */}
      <div style={{ padding: "10px 24px", background: "#FFFFFF", borderBottom: "1px solid #E2E6EE", display: "flex", gap: 10 }}>
        <div style={{ width: 300, height: 32, borderRadius: 6, background: "#EDF0F5" }} />
        <div style={{ width: 140, height: 32, borderRadius: 6, background: "#EDF0F5" }} />
      </div>
      {/* table header row */}
      <div style={{ display: "flex", gap: 16, padding: "8px 16px", background: "#FAFBFC", borderBottom: "1px solid #E2E6EE" }}>
        {[80, 120, 80, 40, 60, 70, 80].map((w, i) => (
          <div key={i} style={{ width: w, height: 10, borderRadius: 3, background: "#EDF0F5" }} />
        ))}
      </div>
      {/* rows */}
      {Array.from({ length: 8 }).map((_, r) => (
        <div
          key={r}
          style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", background: "#FFFFFF", borderBottom: "1px solid #F0F2F6" }}
        >
          {[90, 130, 72, 24, 30, 68, 70].map((w, c) => (
            <div
              key={c}
              className="animate-pulse"
              style={{ width: w, height: 12, borderRadius: 3, background: "#EDF0F5" }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [sortField, setSortField]     = useState<"createdAt" | "poNumber">("createdAt");
  const [sortDir, setSortDir]         = useState<"asc" | "desc">("desc");

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
        o.status === "parsing" || o.status === "transforming"
      ) ? 8000 : false,
  });

  const filtered = orders
    .filter((o: OrderSummary) => {
      const q = search.toLowerCase();
      return (
        (o.poNumber.toLowerCase().includes(q) ||
          o.supplierName.toLowerCase().includes(q)) &&
        (statusFilter === "all" || o.status === statusFilter)
      );
    })
    .sort((a: OrderSummary, b: OrderSummary) => {
      let cmp = 0;
      if (sortField === "createdAt") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        cmp = a.poNumber.localeCompare(b.poNumber);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#F6F7FA" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "14px 24px",
        background: "#FFFFFF",
        borderBottom: "1px solid #E2E6EE",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: "#0B1A2F", margin: 0 }}>
            Purchase Orders
          </h1>
          <p style={{ fontSize: 12, color: "#8A93A5", margin: "2px 0 0" }}>
            {orders.length > 0
              ? `${orders.length} order${orders.length !== 1 ? "s" : ""} total`
              : "No orders yet"}
          </p>
        </div>
        <Link
          href="/upload"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 7,
            background: "#0B1A2F", color: "#FFFFFF",
            fontSize: 12.5, fontWeight: 700, textDecoration: "none",
          }}
        >
          <Upload style={{ width: 13, height: 13 }} />
          Upload
        </Link>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "9px 24px",
        background: "#FFFFFF",
        borderBottom: "1px solid #E2E6EE",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <Search
            style={{
              position: "absolute", left: 9, top: "50%",
              transform: "translateY(-50%)", width: 13, height: 13, color: "#8A93A5",
            }}
          />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by PO number or supplier…"
            style={{
              width: "100%", height: 32, paddingLeft: 30, paddingRight: 10,
              border: "1px solid #E2E6EE", borderRadius: 6,
              fontSize: 12.5, color: "#0B1A2F", background: "#FFFFFF",
              outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as OrderStatus | "all")}
          style={{
            height: 32, padding: "0 10px",
            border: "1px solid #E2E6EE", borderRadius: 6,
            fontSize: 12.5, color: "#0B1A2F", background: "#FFFFFF",
            outline: "none", cursor: "pointer",
          }}
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={() => refetch()}
          title="Refresh"
          style={{
            width: 32, height: 32, border: "1px solid #E2E6EE", borderRadius: 6,
            background: "#FFFFFF", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <RefreshCw style={{ width: 13, height: 13, color: "#56627A" }} />
        </button>
        {filtered.length !== orders.length && (
          <span style={{ fontSize: 12, color: "#8A93A5", whiteSpace: "nowrap" }}>
            {filtered.length} of {orders.length}
          </span>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {isError ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <p style={{ fontSize: 13, color: "#C53A3A", margin: 0 }}>
              Failed to load orders:{" "}
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
            <button
              onClick={() => refetch()}
              style={{
                fontSize: 12, padding: "6px 14px",
                borderRadius: 6, border: "1px solid #E2E6EE",
                background: "#FFFFFF", cursor: "pointer", color: "#0B1A2F",
              }}
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, padding: 40 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 11, background: "#EDF0F5",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8A93A5" strokeWidth="1.5">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F" }}>
              No orders found
            </span>
            <span style={{ fontSize: 12.5, color: "#8A93A5" }}>
              {search || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "Upload your first purchase order to get started"}
            </span>
            {!search && statusFilter === "all" && (
              <Link
                href="/upload"
                style={{
                  marginTop: 8, padding: "7px 16px", borderRadius: 7,
                  background: "#0B1A2F", color: "#FFFFFF",
                  fontSize: 12.5, fontWeight: 700, textDecoration: "none",
                }}
              >
                Upload Order
              </Link>
            )}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#FFFFFF" }}>
            <thead>
              <tr>
                <ColHeader onClick={() => toggleSort("poNumber")} sorted={sortField === "poNumber"} dir={sortDir}>
                  PO Number
                </ColHeader>
                <ColHeader>Supplier</ColHeader>
                <ColHeader>Order Date</ColHeader>
                <ColHeader align="right">Lines</ColHeader>
                <ColHeader align="right">Unresolved</ColHeader>
                <ColHeader>Status</ColHeader>
                <ColHeader onClick={() => toggleSort("createdAt")} sorted={sortField === "createdAt"} dir={sortDir}>
                  Created
                </ColHeader>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order: OrderSummary) => (
                <tr
                  key={order.id}
                  style={{ background: "#FFFFFF" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#F6F7FA")}
                  onMouseLeave={e => (e.currentTarget.style.background = "#FFFFFF")}
                >
                  <td style={TD}>
                    <Link
                      href={`/orders/${order.id}`}
                      style={{ fontSize: 13, fontWeight: 700, color: "#1E66C9", textDecoration: "none" }}
                    >
                      {order.poNumber}
                    </Link>
                  </td>
                  <td style={{ ...TD, fontSize: 13, color: "#0B1A2F" }}>
                    {order.supplierName}
                  </td>
                  <td style={{ ...TD, fontSize: 12.5, color: "#56627A" }}>
                    {fmtDate(order.orderDate)}
                  </td>
                  <td style={{ ...TD, fontSize: 12.5, fontFamily: "ui-monospace, monospace", textAlign: "right" }}>
                    {order.lineCount}
                  </td>
                  <td style={{ ...TD, textAlign: "right" }}>
                    {order.unresolvedCount > 0 ? (
                      <span style={{ fontSize: 12.5, fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#C97A14" }}>
                        {order.unresolvedCount}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12.5, color: "#C5CDD8" }}>—</span>
                    )}
                  </td>
                  <td style={TD}>
                    <StatusBadge status={order.status} size="sm" />
                  </td>
                  <td style={{ ...TD, fontSize: 12, color: "#8A93A5" }}>
                    {fmtDate(order.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
