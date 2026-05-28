"use client";

// Bridge Dashboard — the signature Wire Topology screen.
// "Order topology" — not "Dashboard".

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WireTopology } from "./WireTopology";
import type { WireBuyer, WireSupplier, Wire } from "./WireTopology";
import { FileChip } from "./FileChip";
import { LaneDrawer } from "./LaneDrawer";
import type { Lane } from "./LaneDrawer";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { apiClient, isApiMockMode } from "@/lib/api-client";

// ─── Mock data (MSW will replace these) ─────────────────────────────────────

const BUYERS: WireBuyer[] = [
  { id: "b1", name: "Heinrich Industries",   code: "HEI", volume: "412/wk" },
  { id: "b2", name: "Nordmark Logistics",    code: "NRD", volume: "287/wk" },
  { id: "b3", name: "Steelhouse Const.",     code: "SHC", volume: "198/wk" },
  { id: "b4", name: "Centralis Pharma",      code: "CPH", volume: "94/wk"  },
  { id: "b5", name: "Westmark Tools",        code: "WMT", volume: "76/wk"  },
  { id: "b6", name: "Atlas Reseller AG",     code: "ARA", volume: "142/wk" },
];

const SUPPLIERS: WireSupplier[] = [
  { id: "s1", name: "Acme Components",    code: "ACM", volume: "610/wk", health: 97 },
  { id: "s2", name: "BoltWorks BV",       code: "BWK", volume: "382/wk", health: 91 },
  { id: "s3", name: "VanDerBerg Metaal",  code: "VDB", volume: "245/wk", health: 88 },
  { id: "s4", name: "Nordix Distribution",code: "NDX", volume: "178/wk", health: 73 },
  { id: "s5", name: "MedicaSupply OY",    code: "MDS", volume: "99/wk",  health: 96 },
];

const WIRES: Wire[] = [
  { buyerId: "b1", supplierId: "s1", weight: 4, health: "ok",   alert: 3 },
  { buyerId: "b1", supplierId: "s2", weight: 2, health: "ok" },
  { buyerId: "b2", supplierId: "s3", weight: 3, health: "risk", alert: 1 },
  { buyerId: "b2", supplierId: "s2", weight: 2, health: "ok" },
  { buyerId: "b3", supplierId: "s3", weight: 2, health: "ok" },
  { buyerId: "b3", supplierId: "s2", weight: 3, health: "ok" },
  { buyerId: "b4", supplierId: "s5", weight: 1, health: "ok" },
  { buyerId: "b4", supplierId: "s4", weight: 1, health: "down", alert: 6 },
  { buyerId: "b5", supplierId: "s1", weight: 1, health: "ok" },
  { buyerId: "b6", supplierId: "s4", weight: 2, health: "risk", alert: 1 },
  { buyerId: "b6", supplierId: "s1", weight: 2, health: "ok" },
];


const IN_TRANSIT = [
  { po: "PO-2026-008412", buyer: "Heinrich", supplier: "Acme",        fmt: "PDF",  stage: "Validate" },
  { po: "PO-NRD-9981",    buyer: "Nordmark", supplier: "BoltWorks",   fmt: "cXML", stage: "Parse"    },
  { po: "SH-PO-44120",    buyer: "Steel.",   supplier: "VanDerBerg",  fmt: "XLSX", stage: "Extract"  },
  { po: "850-99201",      buyer: "Centralis",supplier: "MedicaSupply",fmt: "EDI",  stage: "Failed"   },
  { po: "WMT-2026-0341",  buyer: "Westmark", supplier: "Acme",        fmt: "EMAIL",stage: "Ready"    },
];

const STAGE_COLOR: Record<string, string> = {
  Parse:    "#1E66C9",
  Extract:  "#6F4FCE",
  Validate: "#C97A14",
  Ready:    "#2E8E3A",
  Failed:   "#C53A3A",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function BridgeDashboard() {
  const [activeLane, setActiveLane] = useState<Lane | null>(null);

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
      // Static mock KPIs for demo mode
      return [
        { value: "1,209",  label: "Orders today",         sub: "Today, UTC",                      accent: "up"   as const },
        { value: "—",      label: "Avg processing time",  sub: "Coming with usage metering",       accent: "none" as const },
        { value: "3",      label: "Urgent exceptions",    sub: "Today, UTC",                       accent: "warn" as const },
        { value: "84%",    label: "Auto-processed",       sub: "This period",                      accent: "up"   as const },
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

  const showChecklist =
    onboardingStatus != null &&
    !(onboardingStatus.hasSupplier && onboardingStatus.hasUpload && onboardingStatus.hasDelivery);

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

      <div className="flex flex-1 flex-col gap-4 p-3 sm:gap-5 sm:p-5">
        {/* Onboarding checklist — shown until all steps are complete */}
        {showChecklist && (
          <OnboardingChecklist
            status={onboardingStatus!}
            supplierCount={suppliers?.length ?? 0}
            orderCount={orders?.length ?? 0}
          />
        )}

        {/* Wire topology canvas */}
        <WireTopology
          buyers={BUYERS}
          suppliers={SUPPLIERS}
          wires={WIRES}
          height={480}
          onWireClick={handleWireClick}
        />

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
              {IN_TRANSIT.map((row, i) => (
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
              ))}
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
              {SUPPLIERS.map((s) => {
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
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
