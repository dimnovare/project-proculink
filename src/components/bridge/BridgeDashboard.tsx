"use client";

// Bridge Dashboard — the signature Wire Topology screen.
// "Order topology" — not "Dashboard".

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WireTopology } from "./WireTopology";
import type { WireBuyer, WireSupplier, Wire } from "./WireTopology";
import { FileChip } from "./FileChip";
import { LaneDrawer } from "./LaneDrawer";
import type { Lane } from "./LaneDrawer";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { OnboardingWizard } from "./OnboardingWizard";
import { apiClient, isApiMockMode } from "@/lib/api-client";

// Mock topology data has moved into api-client.ts (mockGetDashboardTopology).
// In production this query resolves to empty arrays; we render an empty state.

const IN_TRANSIT_MOCK_FALLBACK = [
  { po: "PO-DEMO-001",    buyer: "Heinrich", fmt: "PDF",  stage: "Validate" },
  { po: "PO-NRD-9981",    buyer: "Nordmark", fmt: "cXML", stage: "Parse"    },
  { po: "SH-PO-44120",    buyer: "Steel.",   fmt: "XLSX", stage: "Extract"  },
  { po: "850-99201",      buyer: "Centralis",fmt: "EDI",  stage: "Failed"   },
  { po: "WMT-2026-0341",  buyer: "Westmark", fmt: "EMAIL",stage: "Ready"    },
];

/** Statuses that represent orders actively moving through the bridge pipeline. */
const ACTIVE_STATUSES = new Set([
  "parsing",
  "pending_parse",
  "pending_review",
  "transforming",
  "delivering",
  "delivery_failed",
]);

/** Maps a raw API status to a short human label for the stage badge. */
function stageLabel(status: string): string {
  switch (status) {
    case "parsing":        return "Parse";
    case "pending_parse":  return "Parse";
    case "pending_review": return "Validate";
    case "transforming":   return "Extract";
    case "delivering":     return "Ready";
    case "delivery_failed":return "Failed";
    default:               return status;
  }
}

const STAGE_COLOR: Record<string, string> = {
  // Human labels (used by the mock fallback rows)
  Parse:    "#1E66C9",
  Extract:  "#6F4FCE",
  Validate: "#C97A14",
  Ready:    "#2E8E3A",
  Failed:   "#C53A3A",
  // Raw API status values (used by live rows)
  parsing:         "#1E66C9",
  pending_parse:   "#1E66C9",
  pending_review:  "#C97A14",
  transforming:    "#6F4FCE",
  delivering:      "#2E8E3A",
  delivery_failed: "#C53A3A",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function BridgeDashboard() {
  const [activeLane, setActiveLane] = useState<Lane | null>(null);
  const [wizardDismissed, setWizardDismissed] = useState(false);

  const { data: onboardingStatus } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => apiClient.getOnboardingStatus(),
    staleTime: 60_000,
  });
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    staleTime: 60_000,
  });
  const { data: orders, isLoading: ordersLoading, isError: ordersError } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders(),
    staleTime: 60_000,
  });
  const { data: topology, isLoading: topologyLoading } = useQuery({
    queryKey: ["dashboard-topology"],
    queryFn: () => apiClient.getDashboardTopology(),
    staleTime: 60_000,
  });

  const topologyBuyers = (topology?.buyers ?? []) as WireBuyer[];
  const topologySuppliers = (topology?.suppliers ?? []) as WireSupplier[];
  const topologyWires = (topology?.wires ?? []) as Wire[];
  const topologyIsEmpty =
    !topologyLoading &&
    topologyBuyers.length === 0 &&
    topologySuppliers.length === 0;

  // KPI computation — safe with undefined/empty orders
  const kpis = (() => {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const ordersToday = (orders ?? []).filter(
      o => new Date(o.createdAt) >= todayStart
    ).length;

    const urgentExceptions = (orders ?? []).filter(
      o => o.status === "pending_review" || o.status === "delivery_failed"
    ).length;

    const eligible = (orders ?? []).filter(o =>
      ["ready", "ready_to_deliver", "delivered"].includes(o.status)
    );
    const autoProcessed =
      eligible.length >= 3
        ? Math.round((eligible.filter(o => o.unresolvedCount === 0).length / eligible.length) * 100)
        : null;

    if (isApiMockMode && !orders) {
      // Static mock KPIs for demo mode — honest placeholders, never fabricated numbers
      return [
        { value: "—",      label: "Orders today",         sub: "Today, UTC",                      accent: "none" as const },
        { value: "—",      label: "Avg processing time",  sub: "Coming with usage metering",       accent: "none" as const },
        { value: "3",      label: "Urgent exceptions",    sub: "Today, UTC",                       accent: "warn" as const },
        { value: "—",      label: "Auto-processed",       sub: "This period",                      accent: "none" as const },
        { value: "—",      label: "Cost per order",       sub: "Coming with usage metering",       accent: "none" as const },
      ];
    }

    return [
      {
        value: ordersLoading ? "…" : ordersToday.toLocaleString(),
        label: "Orders today",
        sub: "Today, UTC",
        accent: "up" as const,
      },
      {
        value: "—",
        label: "Avg processing time",
        // TODO: wire to /api/dashboard/kpis when available (needs updatedAt on OrderSummary)
        sub: "Coming with usage metering",
        accent: "none" as const,
      },
      {
        value: ordersLoading ? "…" : ordersError ? "—" : urgentExceptions.toLocaleString(),
        label: "Urgent exceptions",
        sub: "Today, UTC",
        accent: urgentExceptions > 0 ? "warn" as const : "up" as const,
      },
      {
        value: ordersLoading ? "…" : ordersError || autoProcessed === null ? "—" : `${autoProcessed}%`,
        label: "Auto-processed",
        sub: ordersError ? "Live KPIs unavailable" : "This period",
        accent: "up" as const,
      },
      {
        value: "—",
        label: "Cost per order",
        sub: "Coming with usage metering",
        accent: "none" as const,
      },
    ];
  })();

  // ── In-transit rows derived from live orders ──────────────────────────────
  const inTransitRows = (() => {
    const liveRows = (orders ?? [])
      .filter(o => ACTIVE_STATUSES.has(o.status))
      .map(o => ({
        po:    o.poNumber,
        buyer: o.buyerName ?? "Unknown",
        fmt:   o.sourceFormat ?? "csv",
        stage: stageLabel(o.status),
      }));

    // In mock mode: fall back to the hardcoded demo rows when no active-status
    // orders exist, so the topology screen still looks populated during demos.
    if (isApiMockMode && liveRows.length === 0) {
      return IN_TRANSIT_MOCK_FALLBACK;
    }

    return liveRows;
  })();

  const showChecklist =
    onboardingStatus != null &&
    !(onboardingStatus.hasSupplier && onboardingStatus.hasUpload && onboardingStatus.hasDelivery);

  // Show the guided wizard overlay for brand-new users (no supplier yet) unless dismissed
  const showWizard =
    !wizardDismissed &&
    onboardingStatus != null &&
    !onboardingStatus.hasSupplier;

  function handleWireClick(wire: Wire, buyer: WireBuyer, supplier: WireSupplier) {
    setActiveLane({
      buyerName:    buyer.name,
      buyerCode:    buyer.code,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      health:       wire.health,
      volume:       buyer.volume,
      alert:        wire.alert,
    });
  }

  /** Renders the topology area: skeleton while loading, empty-state when no
   *  buyers/suppliers yet, otherwise the live WireTopology canvas. */
  function renderTopologyArea(height: number) {
    if (topologyLoading) {
      return (
        <div
          className="animate-pulse rounded-card"
          style={{
            height,
            background: "#EFF2F7",
            border: "1px solid #E2E6EE",
            boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
          }}
        />
      );
    }
    if (topologyIsEmpty) {
      return (
        <div
          className="flex flex-col items-center justify-center text-center rounded-card"
          style={{
            height,
            background: "#FFFFFF",
            border: "1px solid #E2E6EE",
            boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
            padding: 24,
            fontFamily: "Inter, sans-serif",
          }}
        >
          <div
            className="text-[16px] font-semibold"
            style={{ color: "#0B1A2F" }}
          >
            No supplier wires yet
          </div>
          <div
            className="text-[13px] mt-1 max-w-[420px]"
            style={{ color: "#56627A" }}
          >
            Add a supplier and upload your first PO to see your topology come alive.
          </div>
          <Link
            href="/library/suppliers"
            className="mt-4 inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#F6F7FA]"
            style={{
              border: "1px solid #E2E6EE",
              background: "#FFFFFF",
              color: "#0B1A2F",
            }}
          >
            Add a supplier →
          </Link>
        </div>
      );
    }
    return (
      <WireTopology
        buyers={topologyBuyers}
        suppliers={topologySuppliers}
        wires={topologyWires}
        height={height}
        onWireClick={handleWireClick}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto" style={{ background: "#F6F7FA" }}>
      {/* Page header */}
      <div
        className="flex flex-shrink-0 flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-6"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div className="min-w-0 flex-1">
          <h1
            className="text-[22px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            Order topology
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: "#56627A" }}>
            Live wire view · last update 14s ago
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Period selector */}
          <div
            className="flex min-w-0 items-center overflow-hidden rounded-[6px] text-[12.5px]"
            style={{ border: "1px solid #E2E6EE" }}
          >
            {["Today", "7d", "30d", "Quarter"].map((p, i) => (
              <button
                key={p}
                className="min-w-0 px-3 py-1.5 font-medium transition-colors"
                style={{
                  background: i === 0 ? "#0B1A2F" : "#FFFFFF",
                  color: i === 0 ? "#FFFFFF" : "#56627A",
                  borderRight: i < 3 ? "1px solid #E2E6EE" : undefined,
                }}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            className="flex items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium"
            style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}
          >
            ↓ Export report
          </button>
        </div>
      </div>

      {/* Onboarding wizard — full-screen overlay for new users without a supplier */}
      {showWizard && (
        <OnboardingWizard onDismiss={() => setWizardDismissed(true)} />
      )}

      <div className="flex flex-1 flex-col gap-4 p-3 sm:gap-5 sm:p-5">
        {/* Onboarding checklist + WireTopology — when the checklist is visible,
            render them side-by-side on lg+ screens so the topology fills the
            otherwise-empty space to the right of the checklist. When the
            checklist is hidden (all milestones done), topology spans full width. */}
        {showChecklist ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <div className="flex flex-col items-start gap-3">
              <OnboardingChecklist
                status={onboardingStatus!}
                supplierCount={suppliers?.length ?? 0}
                orderCount={orders?.length ?? 0}
              />
              {/* "Get started" shortcut — only visible when no supplier yet and wizard was dismissed */}
              {wizardDismissed && !onboardingStatus!.hasSupplier && (
                <button
                  onClick={() => setWizardDismissed(false)}
                  style={{
                    height: 36,
                    padding: "0 16px",
                    background: "#0B1A2F",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    letterSpacing: "0.01em",
                    whiteSpace: "nowrap",
                  }}
                >
                  Get started →
                </button>
              )}
            </div>
            {renderTopologyArea(360)}
          </div>
        ) : (
          renderTopologyArea(480)
        )}

        {activeLane && (
          <LaneDrawer
            lane={activeLane}
            onClose={() => setActiveLane(null)}
          />
        )}

        {/* KPI strip — 2×2 on mobile, 5-col on xl */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {kpis.map((kpi, i) => (
            <div
              key={i}
              className="rounded-card p-4"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E6EE",
                borderTop: i === 0
                  ? "3px solid transparent"
                  : "1px solid #E2E6EE",
                backgroundImage:
                  i === 0
                    ? "linear-gradient(#FFFFFF 0%, #FFFFFF 100%), linear-gradient(90deg, #1E66C9, #2E8E3A)"
                    : undefined,
                backgroundClip: i === 0 ? "padding-box, border-box" : undefined,
                backgroundOrigin: i === 0 ? "padding-box, border-box" : undefined,
                boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
              }}
            >
              <div
                className={`monument${!isApiMockMode && ordersLoading ? " animate-pulse text-[#C6CDDA]" : ""}`}
                style={{
                  fontSize: "clamp(28px, 4vw, 36px)",
                  color: "#0B1A2F",
                }}
              >
                {kpi.value}
              </div>
              <div className="text-[12px] font-medium mt-1" style={{ color: "#56627A" }}>
                {kpi.label}
              </div>
              <div
                className="text-[11.5px] mt-0.5 font-medium"
                style={{
                  color:
                    kpi.accent === "up"
                      ? "#1E6D29"
                      : kpi.accent === "warn"
                      ? "#C97A14"
                      : "#56627A",
                }}
              >
                {kpi.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom row: In transit + Dock health */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* In transit */}
          <div
            className="rounded-card overflow-hidden"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E6EE",
              boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
            }}
          >
            <div
              className="flex items-center px-4 py-3"
              style={{ borderBottom: "1px solid #E2E6EE" }}
            >
              <span className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>
                In transit
              </span>
              <span className="ml-2 text-[11.5px]" style={{ color: "#8A93A5" }}>
                · last 10 min
              </span>
            </div>
            <div className="divide-y" style={{ borderColor: "#E2E6EE" }}>
              {ordersLoading ? (
                // Skeleton rows while orders are loading
                [0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="h-3 flex-1 animate-pulse rounded" style={{ background: "#E2E6EE" }} />
                    <div className="h-3 w-16 animate-pulse rounded" style={{ background: "#E2E6EE" }} />
                    <div className="h-5 w-12 animate-pulse rounded" style={{ background: "#E2E6EE" }} />
                  </div>
                ))
              ) : inTransitRows.length === 0 ? (
                // Empty state — no active orders
                <div className="px-4 py-6 text-center text-[12.5px]" style={{ color: "#8A93A5" }}>
                  No orders in flight right now.
                </div>
              ) : (
                inTransitRows.map((row, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-[#F6F7FA] cursor-pointer transition-colors"
                  >
                    <span
                      className="min-w-[150px] flex-1 truncate font-mono text-[11.5px] font-medium"
                      style={{ color: "#0F4FA8" }}
                    >
                      {row.po}
                    </span>
                    <span className="max-w-[90px] truncate text-[12px] text-[#56627A]">
                      {row.buyer}
                    </span>
                    <FileChip type={row.fmt} />
                    <span
                      className="text-[11px] font-semibold rounded px-1.5 py-0.5"
                      style={{
                        color: STAGE_COLOR[row.stage] ?? "#56627A",
                        background: `${STAGE_COLOR[row.stage] ?? "#56627A"}18`,
                      }}
                    >
                      {row.stage}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Supplier dock health */}
          <div
            className="rounded-card overflow-hidden"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E6EE",
              boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
            }}
          >
            <div
              className="flex items-center px-4 py-3"
              style={{ borderBottom: "1px solid #E2E6EE" }}
            >
              <span className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>
                Supplier dock health
              </span>
            </div>
            <div className="divide-y" style={{ borderColor: "#E2E6EE" }}>
              {topologySuppliers.length === 0 ? (
                <div
                  className="text-center"
                  style={{ color: "#8A93A5", padding: "16px", fontSize: 12.5 }}
                >
                  No supplier dock data yet.
                </div>
              ) : (
                topologySuppliers.map((s) => {
                  const color =
                    s.health >= 95
                      ? "#2E8E3A"
                      : s.health >= 85
                      ? "#C97A14"
                      : "#C53A3A";
                  const barBg =
                    s.health >= 95
                      ? "#E2F1E2"
                      : s.health >= 85
                      ? "#FAEFD6"
                      : "#FBE3E3";
                  return (
                    <div key={s.id} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="min-w-0 truncate pr-3 text-[12.5px] font-medium" style={{ color: "#0B1A2F" }}>
                          {s.name}
                        </span>
                        <span
                          className="text-[12px] font-bold"
                          style={{ color, fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {s.health}%
                        </span>
                      </div>
                      <div
                        className="rounded-full overflow-hidden"
                        style={{ height: 5, background: barBg }}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${s.health}%`, background: color }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
