"use client";

// LaneDrawer — slides in from right when a wire is clicked in WireTopology.
// Shows lane overview: buyer + supplier, health, recent crossings on this wire.

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import type { OrderStatus } from "@/types/procurement";

export type Lane = {
  buyerName: string;
  buyerCode: string;
  supplierName: string;
  supplierCode: string;
  health: "ok" | "risk" | "down";
  volume: string;
  alert?: number;
};

const HEALTH_COLOR: Record<string, string> = {
  ok:   "#2E8E3A",
  risk: "#C97A14",
  down: "#C53A3A",
};

const HEALTH_LABEL: Record<string, string> = {
  ok:   "Healthy",
  risk: "At risk",
  down: "Down",
};

// Mock recent crossings for the selected lane
const MOCK_CROSSINGS = [
  { po: "PO-DEMO-001", orderId: "demo-001", age: "2m",  status: "review",     lines: 14, value: "€24,180" },
  { po: "PO-2026-008411", orderId: "008411", age: "1h",  status: "sent",       lines: 11, value: "€5,612"  },
  { po: "PO-2026-008399", orderId: "008399", age: "3h",  status: "sent",       lines: 8,  value: "€9,140"  },
  { po: "PO-2026-008381", orderId: "008381", age: "1d",  status: "failed",     lines: 22, value: "€31,800" },
  { po: "PO-2026-008360", orderId: "008360", age: "2d",  status: "sent",       lines: 6,  value: "€3,402"  },
];

const STATUS_DOT: Record<string, string> = {
  review: "#C97A14",
  sent:   "#2E8E3A",
  failed: "#C53A3A",
  new:    "#1E66C9",
};

// Real-order status → dot colour (mirrors the inbox status palette).
function liveStatusDot(status: OrderStatus | string): string {
  switch (status) {
    case "delivered":
      return "#2E8E3A";
    case "pending_review":
      return "#C97A14";
    case "failed":
    case "transform_failed":
    case "delivery_failed":
    case "delivery_dead_letter":
    case "rejected_by_supplier":
      return "#C53A3A";
    default:
      return "#1E66C9";
  }
}

interface LaneDrawerProps {
  lane: Lane;
  onClose: () => void;
}

export function LaneDrawer({ lane, onClose }: LaneDrawerProps) {
  const hc     = HEALTH_COLOR[lane.health];
  const router = useRouter();
  // Direction-aware party labels (avoids a split-brain "Supplier" UI for inbound
  // orgs). railHeader is "Buyer → Supplier" (outbound) / "Customer → You"
  // (inbound); split it into the two side labels.
  const { labels } = useOrderDirection();
  const [leftPartyLabel, rightPartyLabel] = (() => {
    const parts = labels.railHeader.split("→").map(s => s.trim());
    return [parts[0] || "Buyer", parts[1] || "Supplier"];
  })();

  // ── Live data (real customers) ────────────────────────────────────────────
  // The Lane carries only display names/codes — not a supplier id — so resolve
  // the id from the suppliers list by matching on name, then fetch this
  // supplier's recent orders (the best filter the API supports; there is no
  // buyer↔supplier pair filter, so this is supplier-scoped). In mock mode the
  // staged MOCK_CROSSINGS render instead and these queries stay disabled.
  // Known repo gotcha: queries gated only on clerkReady starve in mock mode
  // and live QA-bypass e2e (no Clerk session). useQueriesEnabled covers both;
  // the mock path doesn't use these queries, so exclude mock here. Call the
  // hook unconditionally (rules-of-hooks), then combine.
  const queriesEnabled = useQueriesEnabled();
  const liveEnabled = !isApiMockMode && queriesEnabled;

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    enabled: liveEnabled,
    staleTime: 60_000,
    retry: 1,
  });

  const supplierId = useMemo(() => {
    if (!suppliers) return undefined;
    const want = lane.supplierName.trim().toLowerCase();
    return suppliers.find(s => s.name.trim().toLowerCase() === want)?.id;
  }, [suppliers, lane.supplierName]);

  const { data: ordersPage, isLoading: ordersLoading } = useQuery({
    queryKey: ["lane-orders", supplierId],
    queryFn: () => apiClient.getOrders({ supplierId, pageSize: 5 }),
    enabled: liveEnabled && !!supplierId,
    staleTime: 15_000,
    retry: 1,
  });
  const recentOrders = ordersPage?.items ?? [];

  // esc closes
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [onClose]);

  return (
    <>
      {/* Dim overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(11,26,47,0.3)",
          zIndex: 8998,
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          maxWidth: "100vw",
          background: "#FFFFFF",
          boxShadow: "-8px 0 32px rgba(11,26,47,0.14)",
          zIndex: 8999,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 20px 16px",
            borderBottom: "1px solid #E2E6EE",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                fontSize: 17,
                fontWeight: 700,
                color: "#0B1A2F",
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Connection detail
            </h2>
            <button
              onClick={onClose}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 18,
                color: "var(--ink-faint)",
                padding: "0 4px",
              }}
            >
              ✕
            </button>
          </div>

          {/* Buyer → Supplier */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              background: "#F6F7FA",
              borderRadius: 8,
              border: "1px solid #E2E6EE",
            }}
          >
            {/* Buyer */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "#1E66C9",
                  marginBottom: 2,
                }}
              >
                {leftPartyLabel}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0B1A2F",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {lane.buyerName}
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10.5,
                  color: "#1E66C9",
                  fontWeight: 600,
                }}
              >
                {lane.buyerCode}
              </div>
            </div>

            {/* Wire arrow */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 2,
                  background: `linear-gradient(90deg, #1E66C9, ${hc})`,
                  borderRadius: 99,
                }}
              />
              <div
                style={{
                  fontSize: 9,
                  color: hc,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
              >
                {HEALTH_LABEL[lane.health]}
              </div>
            </div>

            {/* Supplier */}
            <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "#2E8E3A",
                  marginBottom: 2,
                }}
              >
                {rightPartyLabel}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0B1A2F",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {lane.supplierName}
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10.5,
                  color: "#2E8E3A",
                  fontWeight: 600,
                }}
              >
                {lane.supplierCode}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              gap: 0,
              marginTop: 12,
              border: "1px solid #E2E6EE",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {[
              { label: "Volume",  value: lane.volume },
              { label: "Health",  value: HEALTH_LABEL[lane.health], color: hc },
              { label: "Alerts",  value: lane.alert ? `${lane.alert}` : "—", color: lane.alert ? "#C97A14" : undefined },
            ].map(({ label, value, color }, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  textAlign: "center",
                  borderRight: i < 2 ? "1px solid #E2E6EE" : undefined,
                  background: "#FAFBFC",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: color ?? "#0B1A2F",
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  }}
                >
                  {value}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 1 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent crossings */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <div
            style={{
              padding: "12px 20px 8px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            Recent deliveries
          </div>

          {/* Live mode — real orders for this supplier (best available filter). */}
          {!isApiMockMode && ordersLoading && (
            <div style={{ padding: "0 20px" }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    height: 14,
                    margin: "14px 0",
                    borderRadius: 4,
                    background: "#EEF1F6",
                  }}
                  className="animate-pulse"
                />
              ))}
            </div>
          )}

          {!isApiMockMode && !ordersLoading && recentOrders.length > 0 && recentOrders.map((o) => (
            <div
              key={o.id}
              role="button"
              tabIndex={0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 20px",
                borderBottom: "1px solid #F0F2F6",
                cursor: "pointer",
              }}
              onClick={() => { onClose(); router.push(`/inbox/${o.id}`); }}
              onKeyDown={(e) => { if (e.key === "Enter") { onClose(); router.push(`/inbox/${o.id}`); }}}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "#F6F7FA")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "transparent")
              }
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: liveStatusDot(o.status),
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#0F4FA8",
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {o.poNumber}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{o.lineCount}L</span>
              {typeof o.totalValue === "number" && (
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11.5,
                    color: "#56627A",
                  }}
                >
                  {o.totalValue.toLocaleString(undefined, {
                    style: "currency",
                    currency: o.currency || "EUR",
                    maximumFractionDigits: 0,
                  })}
                </span>
              )}
            </div>
          ))}

          {/* Honest empty state — no always-empty fake list; offer a real path. */}
          {!isApiMockMode && !ordersLoading && recentOrders.length === 0 && (
            <div style={{ padding: "24px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 12 }}>
                No recent deliveries on this connection yet.
              </div>
              <button
                onClick={() => { onClose(); router.push("/inbox"); }}
                style={{
                  borderRadius: 7,
                  padding: "7px 14px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: "#FFFFFF",
                  color: "#0F4FA8",
                  border: "1px solid #E2E6EE",
                  cursor: "pointer",
                }}
              >
                Open inbox →
              </button>
            </div>
          )}

          {isApiMockMode && MOCK_CROSSINGS.map((c, i) => (
            <div
              key={i}
              role="button"
              tabIndex={0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 20px",
                borderBottom: "1px solid #F0F2F6",
                cursor: "pointer",
              }}
              onClick={() => { onClose(); router.push(`/inbox/${c.orderId}`); }}
              onKeyDown={(e) => { if (e.key === "Enter") { onClose(); router.push(`/inbox/${c.orderId}`); }}}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "#F6F7FA")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "transparent")
              }
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: STATUS_DOT[c.status] ?? "var(--ink-faint)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#0F4FA8",
                  flex: 1,
                }}
              >
                {c.po}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{c.lines}L</span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11.5,
                  color: "#56627A",
                }}
              >
                {c.value}
              </span>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{c.age}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid #E2E6EE",
            display: "flex",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => { onClose(); router.push("/inbox"); }}
            style={{
              flex: 1,
              borderRadius: 7,
              padding: "9px 0",
              fontSize: 13,
              fontWeight: 600,
              background: "#0B1A2F",
              color: "#FFFFFF",
              border: "none",
              cursor: "pointer",
            }}
          >
            View all deliveries →
          </button>
          <button
            onClick={() => {
              onClose();
              // Deep-link to the resolved supplier when we have its id; otherwise
              // fall back to the suppliers list so the button is never a no-op.
              router.push(supplierId ? `/library/suppliers/${supplierId}` : "/library/suppliers");
            }}
            style={{
              borderRadius: 7,
              padding: "9px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: "#FFFFFF",
              color: "#56627A",
              border: "1px solid #E2E6EE",
              cursor: "pointer",
            }}
          >
            Connection settings
          </button>
        </div>
      </div>
    </>
  );
}
