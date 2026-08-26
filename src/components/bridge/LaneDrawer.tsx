"use client";

// LaneDrawer — slides in from right when a wire is clicked in WireTopology.
// Shows lane overview: buyer + supplier, health, recent crossings on this wire.

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { OrderStatus } from "@/types/procurement";
import { NUMBER_LOCALE } from "@/lib/format-number";

/**
 * The population behind `Lane.health`, and whether it is the whole one.
 *
 * The same shape, and the same reason, as `BlockersReading` on the dashboard: the count
 * is honest about the set it was computed over, and the VERDICT is the thing that needs
 * an entitlement. `deriveTopology` buckets `allOrders`, which is one `pageSize: 100`
 * page, so on the client-derived path a wire's `failed === 0` means "no failures in the
 * orders we loaded", not "no failures on this connection".
 *
 * Not optional, deliberately: a construction site that has not decided cannot fall
 * through to the favourable answer.
 */
export interface LaneHealthBasis {
  /** True when the verdict really does cover every order on this connection. */
  complete: boolean;
  /** How many orders the verdict was computed over. Only read when `complete` is false. */
  scanned: number;
}

export type Lane = {
  buyerName: string;
  buyerCode: string;
  supplierName: string;
  supplierCode: string;
  /**
   * The supplier id the clicked wire was drawn from, when the topology had one.
   *
   * The drawer used to carry only display names, so the only way to reach this
   * supplier's orders was an exact normalized NAME match against the suppliers
   * list — which breaks the moment somebody renames a supplier, and breaks
   * silently, because a disabled query reports `isLoading: false` and the empty
   * state then asserted "no recent deliveries" over a question never asked.
   *
   * OPTIONAL, and CONFIRMED rather than trusted (see `resolvedSupplierId`). The
   * derived-topology path in `BridgeDashboard.deriveTopology` synthesises an id
   * (`sup-<normalised-name>`) for a supplier that has orders but no record in the
   * library, so an id arriving here is a CANDIDATE, not a guarantee.
   */
  supplierId?: string;
  health: "ok" | "risk" | "down";
  healthBasis: LaneHealthBasis;
  volume: string;
  alert?: number;
};

/**
 * What the "Recent deliveries" panel is entitled to say.
 *
 * Four answers, because there are four different things that can be true, and the
 * panel previously collapsed three of them into one sentence — "No recent
 * deliveries on this connection yet." The orders query is gated on a resolved
 * supplier id, and a query that never ran reports `isLoading: false` with an
 * empty `data`, so a rename, a failed suppliers fetch, or a supplier that simply
 * has no library record all rendered as a confident, wrong absence.
 *
 * ORDER IS THE POINT. Failure is read first: a fetch that broke must never fall
 * through to "we looked and there is nothing", which is the exact shape of every
 * unknown-renders-as-success defect in this repo.
 */
export type RecentDeliveriesReading =
  | { state: "loading" }
  /** A query we needed answered came back an error. We do not know. */
  | { state: "unavailable" }
  /** We never asked: nothing in the library matched this connection's supplier. */
  | { state: "unlinked" }
  /** We asked, and this supplier genuinely has no recent orders. */
  | { state: "empty" }
  | { state: "orders"; count: number };

export function readRecentDeliveries(input: {
  /** Clerk/mock gating — false means the queries have not been allowed to start. */
  queriesEnabled: boolean;
  suppliersFailed: boolean;
  suppliersLoaded: boolean;
  /** The id the orders query was actually enabled on, or undefined. */
  supplierId: string | undefined;
  ordersFailed: boolean;
  ordersLoading: boolean;
  orderCount: number;
}): RecentDeliveriesReading {
  if (input.suppliersFailed || input.ordersFailed) return { state: "unavailable" };
  if (!input.queriesEnabled || !input.suppliersLoaded) return { state: "loading" };
  if (!input.supplierId) return { state: "unlinked" };
  if (input.ordersLoading) return { state: "loading" };
  if (input.orderCount > 0) return { state: "orders", count: input.orderCount };
  return { state: "empty" };
}

const HEALTH_COLOR: Record<string, string> = {
  ok:   "#2E8E3A",
  risk: "#B36D14",
  down: "#B43838",
};

/**
 * The text sibling of HEALTH_COLOR. Not a darkening of it: HEALTH_COLOR still
 * paints the buyer→supplier gradient wire (non-text, 3:1), while these two land
 * in `color:` on the health label and the Health stat. ok was 3.8846:1 on --bg
 * and 4.0165:1 on the stat tile's #FAFBFC; risk was 3.8330 / 3.9633:1. The
 * replacements are 5.9863 / 6.1897:1 and 5.8949 / 6.0952:1. down was already
 * over the floor (5.5012 / 5.6881:1) and is the same value in both maps.
 */
const HEALTH_TEXT_COLOR: Record<string, string> = {
  ok:   "#1E6D29",
  risk: "#8A5310",
  down: "#B43838",
};

const HEALTH_LABEL: Record<string, string> = {
  ok:   "Healthy",
  risk: "At risk",
  down: "Down",
};

/**
 * What a truncated working set is allowed to call a clean connection.
 *
 * "Healthy" is a claim about the connection; "No failures seen" is a claim about what
 * was looked at, and that is the difference the sample can carry.
 */
export const PARTIAL_OK_LABEL = "No failures seen";

/**
 * The health word this Lane has evidence for.
 *
 * Only the FAVOURABLE verdict retreats. "At risk" and "Down" are existential — one
 * failure in the sample is a real failure, and a wider window can only add more — so a
 * truncated set proves them exactly as well as a complete one does. "Healthy" is
 * universal: it asserts something about every order on the connection, which is the one
 * thing a first-100-orders sample cannot establish. Widening the page size would make
 * the wrong predicate right by accident; the fix is the claim.
 */
export function laneHealthLabel(health: Lane["health"], basis: LaneHealthBasis): string {
  if (basis.complete || health !== "ok") return HEALTH_LABEL[health];
  return PARTIAL_OK_LABEL;
}

/**
 * The sentence that names the population, or null when the verdict covers everything.
 *
 * Rendered under the stats row rather than folded into the label because the label is a
 * 9px eyebrow and a 14px stat value — neither has room to carry a scope, and a scope
 * that does not fit is a scope that gets dropped.
 */
export function laneHealthScopeNote(basis: LaneHealthBasis): string | null {
  if (basis.complete) return null;
  return `Based on the ${basis.scanned.toLocaleString(NUMBER_LOCALE)} most recent orders in this account, not every order on this connection.`;
}

// Mock recent crossings for the selected lane
const MOCK_CROSSINGS = [
  { po: "PO-DEMO-001", orderId: "demo-001", age: "2m",  status: "review",     lines: 14, value: "€24,180" },
  { po: "PO-2026-008411", orderId: "008411", age: "1h",  status: "sent",       lines: 11, value: "€5,612"  },
  { po: "PO-2026-008399", orderId: "008399", age: "3h",  status: "sent",       lines: 8,  value: "€9,140"  },
  { po: "PO-2026-008381", orderId: "008381", age: "1d",  status: "failed",     lines: 22, value: "€31,800" },
  { po: "PO-2026-008360", orderId: "008360", age: "2d",  status: "sent",       lines: 6,  value: "€3,402"  },
];

const STATUS_DOT: Record<string, string> = {
  review: "#B36D14",
  sent:   "#2E8E3A",
  failed: "#B43838",
  new:    "#1E66C9",
};

// Real-order status → dot colour (mirrors the inbox status palette).
function liveStatusDot(status: OrderStatus | string): string {
  switch (status) {
    case "delivered":
      return "#2E8E3A";
    // Amber = waiting on a human. delivery_held (billing hold) and delivery_unconfirmed
    // (a crash lost the outcome) are here rather than on the default blue "in progress"
    // dot: neither is progressing — both are parked for an operator decision.
    case "pending_review":
    case "delivery_held":
    case "delivery_unconfirmed":
      return "#B36D14";
    case "failed":
    case "transform_failed":
    case "delivery_failed":
    case "delivery_dead_letter":
    case "rejected_by_supplier":
      return "#B43838";
    default:
      return "#1E66C9";
  }
}

/** Shared chrome for the three empty-panel actions, so they stay one control. */
const EMPTY_ACTION_STYLE: React.CSSProperties = {
  borderRadius: 7,
  padding: "7px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  background: "#FFFFFF",
  color: "#0F4FA8",
  border: "1px solid #E5E8EE",
  cursor: "pointer",
};

interface LaneDrawerProps {
  lane: Lane;
  onClose: () => void;
}

export function LaneDrawer({ lane, onClose }: LaneDrawerProps) {
  const hc     = HEALTH_COLOR[lane.health];      // the gradient wire — non-text
  const hcText = HEALTH_TEXT_COLOR[lane.health]; // the health label + stat — text
  // One word, read by both sites that print it, so the eyebrow and the stat tile cannot
  // disagree about what this connection's evidence supports.
  const healthWord = laneHealthLabel(lane.health, lane.healthBasis);
  const healthScopeNote = laneHealthScopeNote(lane.healthBasis);
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

  const {
    data: suppliers,
    isError: suppliersFailed,
    refetch: refetchSuppliers,
  } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    enabled: liveEnabled,
    staleTime: 60_000,
    retry: 1,
  });

  /**
   * The supplier id this connection's orders can be fetched with, or undefined.
   *
   * Id first, name second. The id from the wire survives a rename; the name match
   * does not, and a rename silently disabling the query is what let the panel
   * assert an absence it never checked. The id is still CONFIRMED against the
   * library rather than trusted, because `deriveTopology` mints a synthetic
   * `sup-<name>` id for suppliers that have orders but no library record, and
   * querying orders by an id no supplier has would answer "empty" — the same lie
   * in a new place.
   */
  const resolvedSupplierId = useMemo(() => {
    if (!suppliers) return undefined;
    if (lane.supplierId) {
      const byId = suppliers.find(s => s.id === lane.supplierId);
      if (byId) return byId.id;
    }
    const want = lane.supplierName.trim().toLowerCase();
    return suppliers.find(s => s.name.trim().toLowerCase() === want)?.id;
  }, [suppliers, lane.supplierId, lane.supplierName]);

  const {
    data: ordersPage,
    isLoading: ordersLoading,
    isError: ordersFailed,
    refetch: refetchOrders,
  } = useQuery({
    queryKey: ["lane-orders", resolvedSupplierId],
    queryFn: () => apiClient.getOrders({ supplierId: resolvedSupplierId, pageSize: 5 }),
    enabled: liveEnabled && !!resolvedSupplierId,
    staleTime: 15_000,
    retry: 1,
  });
  const recentOrders = ordersPage?.items ?? [];

  const reading = readRecentDeliveries({
    queriesEnabled: liveEnabled,
    suppliersFailed,
    suppliersLoaded: !!suppliers,
    supplierId: resolvedSupplierId,
    ordersFailed,
    ordersLoading,
    orderCount: recentOrders.length,
  });

  // Escape, focus-in, Tab trap, focus restore and the body scroll lock — the whole
  // modal contract, from the one shared implementation. This drawer shipped as a
  // scrimmed 400px panel of plain <div>s: no role, no aria-modal, no trap, no
  // restore, and a hand-rolled document-level Escape listener that fired even when
  // a dialog opened on top of it. The dialog gate could not see it, because that
  // gate keys on the PRESENCE of role="dialog"/aria-modal — an unmarked modal was
  // invisible to it. See src/test/unmarked-modal.test.ts, which now catches the
  // shape rather than the marking.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogA11y({ open: true, onClose, panelRef });

  return (
    <>
      {/* Dim overlay. aria-hidden: it carries no content, and its click-to-close is
          duplicated by the header's real Close button and by Escape. */}
      <div
        aria-hidden
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lane-drawer-title"
        data-testid="lane-drawer"
        tabIndex={-1}
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
            borderBottom: "1px solid #E5E8EE",
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
              id="lane-drawer-title"
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
              aria-label="Close"
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
              border: "1px solid #E5E8EE",
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
                  color: hcText,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  // Caps the scoped wording so it wraps inside this column instead of
                  // stretching the row and squeezing the two party names either side.
                  // Never binds on "Healthy"/"At risk"/"Down", so the complete-verdict
                  // layout is byte-identical.
                  maxWidth: 86,
                  textAlign: "center",
                }}
              >
                {healthWord}
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
                  // 9px/700 on the row's #F6F7FA: #2E8E3A is 3.8846:1, #1E6D29 is 5.9863:1.
                  color: "#1E6D29",
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
                  // Same pair as the eyebrow above: 3.8846:1 → 5.9863:1 on #F6F7FA.
                  color: "#1E6D29",
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
              border: "1px solid #E5E8EE",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {[
              { label: "Volume",  value: lane.volume },
              { label: "Health",  value: healthWord, color: hcText },
              { label: "Alerts",  value: lane.alert ? `${lane.alert}` : "—", color: lane.alert ? "#8A5310" : undefined },
            ].map(({ label, value, color }, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  textAlign: "center",
                  borderRight: i < 2 ? "1px solid #E5E8EE" : undefined,
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

          {/* Which orders the Health verdict actually read. Absent when it read all of
              them — a scope note under a complete verdict would be noise, and the
              server-aggregated topology path is complete. */}
          {healthScopeNote && (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 11,
                lineHeight: 1.45,
                color: "var(--ink-muted)",
              }}
            >
              {healthScopeNote}
            </p>
          )}
        </div>

        {/* Recent crossings */}
        <div style={{ flex: 1, overflow: "auto" }} data-testid="lane-drawer-recent">
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
          {!isApiMockMode && reading.state === "loading" && (
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

          {!isApiMockMode && reading.state === "orders" && recentOrders.map((o) => (
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
                    color: "#5E6779",
                  }}
                >
                  {o.totalValue.toLocaleString(NUMBER_LOCALE, {
                    style: "currency",
                    currency: o.currency || "EUR",
                    maximumFractionDigits: 0,
                  })}
                </span>
              )}
            </div>
          ))}

          {/* THREE nothings, three sentences. Which one is on screen is decided by
              `readRecentDeliveries`, not by `recentOrders.length === 0`, because
              that length is 0 for all three and the panel used to print the most
              flattering of them over the other two. */}

          {/* A query broke. We do not know whether there are deliveries. */}
          {!isApiMockMode && reading.state === "unavailable" && (
            <div style={{ padding: "24px 20px", textAlign: "center" }} role="alert">
              <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 600, marginBottom: 4 }}>
                We couldn&apos;t load recent deliveries for this connection.
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-muted)", marginBottom: 12 }}>
                That is not the same as there being none — the lookup itself failed.
              </div>
              <button
                onClick={() => { void refetchSuppliers(); void refetchOrders(); }}
                style={EMPTY_ACTION_STYLE}
              >
                Try again
              </button>
            </div>
          )}

          {/* We never asked: no supplier record to look the orders up by. */}
          {!isApiMockMode && reading.state === "unlinked" && (
            <div style={{ padding: "24px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 600, marginBottom: 4 }}>
                We haven&apos;t checked recent deliveries for this connection.
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-muted)", marginBottom: 12 }}>
                {lane.supplierName} doesn&apos;t match a supplier in your library, so there was
                nothing to look its orders up by.
              </div>
              <button
                onClick={() => { onClose(); router.push("/library/suppliers"); }}
                style={EMPTY_ACTION_STYLE}
              >
                Open suppliers →
              </button>
            </div>
          )}

          {/* We asked, and the answer really was none. */}
          {!isApiMockMode && reading.state === "empty" && (
            <div style={{ padding: "24px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 12 }}>
                No recent deliveries on this connection yet.
              </div>
              <button
                onClick={() => { onClose(); router.push("/inbox"); }}
                style={EMPTY_ACTION_STYLE}
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
                  color: "#5E6779",
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
            borderTop: "1px solid #E5E8EE",
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
              router.push(
                resolvedSupplierId ? `/library/suppliers/${resolvedSupplierId}` : "/library/suppliers",
              );
            }}
            style={{
              borderRadius: 7,
              padding: "9px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: "#FFFFFF",
              color: "#5E6779",
              border: "1px solid #E5E8EE",
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
