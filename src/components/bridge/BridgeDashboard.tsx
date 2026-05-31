"use client";

// Bridge Dashboard — the signature Wire Topology screen ("Order topology").
//
// The Wire Topology is the hero: a live buyer → supplier lane map derived from
// real orders + suppliers. The dashboard never fabricates data —
//   • topology is built from the org's actual orders/suppliers (the backend
//     /api/dashboard/topology aggregation isn't live yet, so we derive it
//     client-side instead of showing a false "no wires" empty state);
//   • KPIs are real counts over a selectable time window, or honestly labelled;
//   • the time-window selector + CSV export operate on that same order data.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WireTopology } from "./WireTopology";
import type { WireBuyer, WireSupplier, Wire } from "./WireTopology";
import { FileChip } from "./FileChip";
import { LaneDrawer } from "./LaneDrawer";
import type { Lane } from "./LaneDrawer";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { OnboardingWizard } from "./OnboardingWizard";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { OrderSummary, Supplier } from "@/types/procurement";
import { Inbox, CheckCircle2, Zap, AlertTriangle, ArrowRight } from "lucide-react";

// ─── Status sets ──────────────────────────────────────────────────────────

/** Statuses that represent orders actively moving through the bridge pipeline. */
const ACTIVE_STATUSES = new Set([
  "parsing",
  "pending_parse",
  "pending_review",
  "transforming",
  "delivering",
  "delivery_failed",
]);

/** Hard failures — drag down lane/dock health. */
const FAILED_STATUSES = new Set([
  "failed",
  "transform_failed",
  "delivery_failed",
  "delivery_dead_letter",
]);

/** Anything that needs a human now (open exceptions). */
const EXCEPTION_STATUSES = new Set([
  "pending_review",
  "failed",
  "transform_failed",
  "delivery_failed",
  "delivery_dead_letter",
]);

/** Orders that have reached a "processed" milestone, used for the auto-rate. */
const ELIGIBLE_STATUSES = new Set(["ready", "ready_to_deliver", "delivered"]);

/** Maps a raw API status to a short human label for the in-transit stage badge. */
function stageLabel(status: string): string {
  switch (status) {
    case "parsing":         return "Parse";
    case "pending_parse":   return "Parse";
    case "pending_review":  return "Validate";
    case "transforming":    return "Extract";
    case "delivering":      return "Ready";
    case "delivery_failed": return "Failed";
    default:                return status;
  }
}

const STAGE_COLOR: Record<string, string> = {
  // Human labels (mock fallback rows)
  Parse: "#1E66C9", Extract: "#6F4FCE", Validate: "#C97A14", Ready: "#2E8E3A", Failed: "#C53A3A",
  // Raw API status values (live rows)
  parsing: "#1E66C9", pending_parse: "#1E66C9", pending_review: "#C97A14",
  transforming: "#6F4FCE", delivering: "#2E8E3A", delivery_failed: "#C53A3A",
};

// Dev-only demo rows — gated to mock mode so prospects never see staged content.
const IN_TRANSIT_MOCK_FALLBACK = [
  { po: "PO-DEMO-001",   buyer: "Heinrich",  fmt: "PDF",   stage: "Validate" },
  { po: "PO-NRD-9981",   buyer: "Nordmark",  fmt: "cXML",  stage: "Parse"    },
  { po: "SH-PO-44120",   buyer: "Steel.",    fmt: "XLSX",  stage: "Extract"  },
  { po: "850-99201",     buyer: "Centralis", fmt: "EDI",   stage: "Failed"   },
  { po: "WMT-2026-0341", buyer: "Westmark",  fmt: "EMAIL", stage: "Ready"    },
];

// ─── Time windows ───────────────────────────────────────────────────────────

const WINDOWS = [
  { key: "today", label: "Today", sub: "Today (UTC)" },
  { key: "7d",    label: "7d",    sub: "Last 7 days"  },
  { key: "30d",   label: "30d",   sub: "Last 30 days" },
  { key: "all",   label: "All",   sub: "All time"     },
] as const;
type WindowKey = (typeof WINDOWS)[number]["key"];
const DAY_MS = 86_400_000;

/** Epoch-ms lower bound for a window; orders with createdAt >= this are in-window. */
function windowStart(key: WindowKey): number {
  const now = Date.now();
  if (key === "today") { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); }
  if (key === "7d") return now - 7 * DAY_MS;
  if (key === "30d") return now - 30 * DAY_MS;
  return 0; // "all"
}

// ─── Topology derivation (from real orders + suppliers) ───────────────────────

const normName = (s: string) => s.trim().toLowerCase();

/** Short uppercase code (≤3 chars) from a dock name, e.g. "Acme Components" → "ACM". */
function codeFor(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  const initials = words.map((w) => w[0]).join("").toUpperCase();
  const code = initials.length >= 3 ? initials : words.join("").toUpperCase();
  return code.slice(0, 3);
}

/** Order count → stroke-weight bucket (1–6). */
function weightFor(count: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 3;
  if (count <= 8) return 4;
  if (count <= 16) return 5;
  return 6;
}

interface DerivedTopology {
  buyers: WireBuyer[];
  suppliers: WireSupplier[];
  wires: Wire[];
}

/**
 * Build the wire topology from the org's real data. Suppliers come from the
 * configured supplier list (docks exist even before their first order) plus any
 * supplier seen on an order; buyers and wires come from orders that carry both a
 * buyer and supplier name. Health/alerts reflect actual order statuses.
 */
function deriveTopology(orders: OrderSummary[], suppliers: Supplier[]): DerivedTopology {
  interface SAcc { id: string; name: string; total: number; failed: number; exceptions: number; }
  interface BAcc { id: string; name: string; total: number; }
  interface WAcc { buyerKey: string; supplierKey: string; total: number; failed: number; exceptions: number; }

  const supMap = new Map<string, SAcc>();
  const buyMap = new Map<string, BAcc>();
  const wireMap = new Map<string, WAcc>();

  // Real supplier ids keyed by name, so derived docks line up with configured
  // suppliers. Docks themselves come from orders (actual crossings) — a
  // configured-but-idle supplier isn't plotted as a phantom lane.
  const configuredIdByName = new Map<string, string>();
  for (const s of suppliers) {
    if (s?.name) configuredIdByName.set(normName(s.name), s.id || `sup-${normName(s.name)}`);
  }

  for (const o of orders) {
    const hasException = EXCEPTION_STATUSES.has(o.status) || (o.unresolvedCount ?? 0) > 0;
    const isFailed = FAILED_STATUSES.has(o.status);

    const sName = o.supplierName?.trim();
    if (sName) {
      const sk = normName(sName);
      let acc = supMap.get(sk);
      if (!acc) { acc = { id: configuredIdByName.get(sk) ?? `sup-${sk}`, name: sName, total: 0, failed: 0, exceptions: 0 }; supMap.set(sk, acc); }
      acc.total++; if (isFailed) acc.failed++; if (hasException) acc.exceptions++;
    }

    const bName = o.buyerName?.trim();
    if (bName) {
      const bk = normName(bName);
      let acc = buyMap.get(bk);
      if (!acc) { acc = { id: `buy-${bk}`, name: bName, total: 0 }; buyMap.set(bk, acc); }
      acc.total++;
    }

    if (sName && bName) {
      const wk = `${normName(bName)}|||${normName(sName)}`;
      let acc = wireMap.get(wk);
      if (!acc) { acc = { buyerKey: normName(bName), supplierKey: normName(sName), total: 0, failed: 0, exceptions: 0 }; wireMap.set(wk, acc); }
      acc.total++; if (isFailed) acc.failed++; if (hasException) acc.exceptions++;
    }
  }

  const buyers: WireBuyer[] = [...buyMap.values()]
    .sort((a, b) => b.total - a.total)
    .map((b) => ({ id: b.id, name: b.name, code: codeFor(b.name), volume: `${b.total} ord` }));

  const supplierList: WireSupplier[] = [...supMap.values()]
    .sort((a, b) => b.total - a.total)
    .map((s) => ({
      id: s.id,
      name: s.name,
      code: codeFor(s.name),
      volume: `${s.total} ord`,
      health: s.total === 0 ? 100 : Math.round((100 * (s.total - s.failed)) / s.total),
    }));

  const buyerIdByKey = new Map([...buyMap.values()].map((b) => [normName(b.name), b.id] as const));
  const supplierIdByKey = new Map([...supMap.values()].map((s) => [normName(s.name), s.id] as const));

  const wires: Wire[] = [];
  for (const w of wireMap.values()) {
    const buyerId = buyerIdByKey.get(w.buyerKey);
    const supplierId = supplierIdByKey.get(w.supplierKey);
    if (!buyerId || !supplierId) continue;
    const health: Wire["health"] = w.failed > 0 ? "down" : w.exceptions > 0 ? "risk" : "ok";
    const wire: Wire = { buyerId, supplierId, weight: weightFor(w.total), health };
    if (w.exceptions > 0) wire.alert = w.exceptions;
    wires.push(wire);
  }

  return { buyers, suppliers: supplierList, wires };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BridgeDashboard() {
  const [activeLane, setActiveLane] = useState<Lane | null>(null);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");

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
  const { data: ordersPage, isLoading: ordersLoading, isError: ordersError } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    staleTime: 60_000,
  });
  const { data: topology, isLoading: topologyLoading } = useQuery({
    queryKey: ["dashboard-topology"],
    queryFn: () => apiClient.getDashboardTopology(),
    staleTime: 60_000,
  });
  const { data: ordersSummary } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    staleTime: 30_000,
  });

  // ISO start of current window — undefined when window is "all" (no date filter).
  const windowCutoffISO = useMemo(() => {
    const cutoff = windowStart(windowKey);
    return cutoff > 0 ? new Date(cutoff).toISOString() : undefined;
  }, [windowKey]);

  // Accurate windowed count queries (pageSize:1 — only totalCount matters).
  const { data: windowedReceivedPage } = useQuery({
    queryKey: ["orders-count-received", windowKey],
    queryFn: () => apiClient.getOrders({
      pageSize: 1,
      ...(windowCutoffISO ? { dateFrom: windowCutoffISO } : {}),
    }),
    staleTime: 60_000,
    enabled: !isApiMockMode,
  });

  const { data: windowedDeliveredPage } = useQuery({
    queryKey: ["orders-count-delivered", windowKey],
    queryFn: () => apiClient.getOrders({
      status: "delivered",
      pageSize: 1,
      ...(windowCutoffISO ? { dateFrom: windowCutoffISO } : {}),
    }),
    staleTime: 60_000,
    enabled: !isApiMockMode,
  });

  const allOrders = useMemo(() => ordersPage?.items ?? [], [ordersPage]);

  // Orders inside the selected time window — drives windowed KPIs + export.
  const windowedOrders = useMemo(() => {
    const cutoff = windowStart(windowKey);
    if (cutoff <= 0) return allOrders;
    return allOrders.filter((o) => {
      const t = new Date(o.createdAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }, [allOrders, windowKey]);

  // Topology: prefer the org's real data; fall back to the endpoint only when we
  // have nothing to derive (e.g. a future server-side aggregation). This is the
  // fix for "No supplier wires yet" showing even when suppliers + orders exist.
  const derived = useMemo(() => deriveTopology(allOrders, suppliers ?? []), [allOrders, suppliers]);
  const endpoint = useMemo<DerivedTopology>(
    () => ({
      buyers: (topology?.buyers ?? []) as WireBuyer[],
      suppliers: (topology?.suppliers ?? []) as WireSupplier[],
      wires: (topology?.wires ?? []) as Wire[],
    }),
    [topology],
  );
  const derivedHasData = derived.buyers.length > 0 || derived.suppliers.length > 0;
  const endpointHasData = endpoint.buyers.length > 0 || endpoint.suppliers.length > 0;
  // Prefer server-side topology (all orders) over client-derived (capped at working set).
  const effective: DerivedTopology = endpointHasData ? endpoint : derivedHasData ? derived : { buyers: [], suppliers: [], wires: [] };

  const topologyLoadingState = ordersLoading || topologyLoading;
  const topologyIsEmpty =
    !topologyLoadingState && effective.buyers.length === 0 && effective.suppliers.length === 0;

  // Adaptive height — tall enough to be the hero, compact when few ports.
  const maxPorts = Math.max(effective.buyers.length, effective.suppliers.length);
  const topoHeight = Math.min(520, Math.max(320, 150 + maxPorts * 74));

  const wireCount = effective.wires.length;
  const openExceptionsAll = !isApiMockMode
    ? ((ordersSummary?.byStatus?.["pending_review"] ?? 0) +
       (ordersSummary?.byStatus?.["failed"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_failed"] ?? 0) +
       (ordersSummary?.byStatus?.["transform_failed"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_dead_letter"] ?? 0))
    : allOrders.filter((o) => EXCEPTION_STATUSES.has(o.status)).length;

  // ── KPIs — real counts, windowed where it makes sense, honestly labelled ──
  const windowSub = WINDOWS.find((w) => w.key === windowKey)!.sub;
  const fmt = (n: number) => (ordersLoading ? "…" : ordersError ? "—" : n.toLocaleString());

  const deliveredInWindow = windowedOrders.filter((o) => o.status === "delivered").length;
  const eligibleInWindow = windowedOrders.filter((o) => ELIGIBLE_STATUSES.has(o.status));
  const autoCount = eligibleInWindow.filter((o) => (o.unresolvedCount ?? 0) === 0).length;
  const autoPct = eligibleInWindow.length > 0 ? Math.round((100 * autoCount) / eligibleInWindow.length) : 0;

  const kpis = [
    {
      value: !isApiMockMode
        ? (ordersLoading ? "…" : ordersError ? "—" : (windowedReceivedPage?.totalCount ?? windowedOrders.length).toLocaleString())
        : fmt(windowedOrders.length),
      label: "Orders received",
      sub: windowSub,
      subColor: "#56627A",
      edge: "#1E66C9",
      icon: Inbox,
      iconBg: "#E3EDFB",
      iconColor: "#1E66C9",
      loading: ordersLoading,
    },
    {
      value: !isApiMockMode
        ? (ordersLoading ? "…" : ordersError ? "—" : (windowedDeliveredPage?.totalCount ?? deliveredInWindow).toLocaleString())
        : fmt(deliveredInWindow),
      label: "Orders delivered",
      sub: windowSub,
      subColor: "#1E6D29",
      edge: "#2E8E3A",
      icon: CheckCircle2,
      iconBg: "#E2F1E2",
      iconColor: "#1E6D29",
      loading: ordersLoading,
    },
    {
      value: ordersLoading ? "…" : ordersError ? "—" : eligibleInWindow.length >= 3 ? `${autoPct}%` : "—",
      label: "Auto-processed",
      sub: ordersError
        ? "Live data unavailable"
        : eligibleInWindow.length >= 3
        ? "No manual mapping needed"
        : "Needs 3+ completed orders",
      subColor: "#56627A",
      edge: "linear-gradient(90deg, #1E66C9, #2E8E3A)",
      icon: Zap,
      iconBg: "#EEE7FB",
      iconColor: "#6F4FCE",
      loading: ordersLoading,
    },
    {
      value: fmt(openExceptionsAll),
      label: "Urgent exceptions",
      sub: ordersError ? "Live data unavailable" : openExceptionsAll > 0 ? "Needs review now" : "All clear",
      subColor: openExceptionsAll > 0 ? "#C97A14" : "#1E6D29",
      edge: openExceptionsAll > 0 ? "#C97A14" : "#2E8E3A",
      icon: AlertTriangle,
      iconBg: openExceptionsAll > 0 ? "#FAEFD6" : "#E2F1E2",
      iconColor: openExceptionsAll > 0 ? "#C97A14" : "#1E6D29",
      loading: ordersLoading,
    },
  ];

  // ── In-transit rows (current pipeline activity; not windowed) ─────────────
  const inTransitRows = (() => {
    const liveRows = allOrders
      .filter((o) => ACTIVE_STATUSES.has(o.status))
      .map((o) => ({
        id: o.id as string | undefined,
        po: o.poNumber,
        buyer: o.buyerName ?? "Unknown",
        fmt: o.sourceFormat ?? "csv",
        stage: stageLabel(o.status),
      }));
    if (isApiMockMode && liveRows.length === 0) {
      return IN_TRANSIT_MOCK_FALLBACK.map((r) => ({ ...r, id: undefined as string | undefined }));
    }
    return liveRows;
  })();

  // ── Onboarding state ──────────────────────────────────────────────────────
  const supplierCount = suppliers?.length ?? 0;
  const orderCount = allOrders.length;
  const deliveredCount = allOrders.filter((o) => o.status === "delivered").length;
  const hasOrders = orderCount > 0;

  const onboardingComplete =
    onboardingStatus != null &&
    onboardingStatus.hasSupplier &&
    onboardingStatus.hasUpload &&
    onboardingStatus.hasResolvedMapping &&
    (deliveredCount > 0 || onboardingStatus.hasDelivery);
  const showChecklist = onboardingStatus != null && !onboardingComplete;

  // No crossings to plot yet (no orders + nothing from the endpoint) → the
  // onboarding card takes the hero slot instead of an empty topology.
  const noTopologyData = !topologyLoadingState && orderCount === 0 && !endpointHasData;
  const showOnboardingHero = noTopologyData && showChecklist;

  // Full-screen guided wizard for users without a supplier (unless dismissed).
  const showWizard = !wizardDismissed && onboardingStatus != null && !onboardingStatus.hasSupplier;

  // Show window selector + export only when there is order data to act on.
  const showWindowControls = hasOrders || ordersLoading;

  function handleWireClick(wire: Wire, buyer: WireBuyer, supplier: WireSupplier) {
    setActiveLane({
      buyerName: buyer.name,
      buyerCode: buyer.code,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      health: wire.health,
      volume: buyer.volume,
      alert: wire.alert,
    });
  }

  /** Export the current window's orders as a CSV (client-side — no backend call). */
  function handleExport() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "PO number", "Buyer", "Supplier", "Format", "Status",
      "Lines", "Unresolved", "Total value", "Currency", "Created",
    ];
    const body = windowedOrders.map((o) =>
      [
        o.poNumber,
        o.buyerName ?? "",
        o.supplierName,
        (o.sourceFormat ?? "").toUpperCase(),
        o.status,
        o.lineCount,
        o.unresolvedCount,
        o.totalValue != null ? o.totalValue.toFixed(2) : "",
        o.currency ?? "",
        o.createdAt,
      ].map(esc).join(","),
    );
    const csv = [header.map(esc).join(","), ...body].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `order-report-${windowKey}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Topology hero area: skeleton while loading, true empty-state only when there
   *  genuinely are no docks, otherwise the live WireTopology canvas. */
  function renderTopologyArea(height: number) {
    if (topologyLoadingState) {
      return (
        <div
          className="animate-pulse rounded-card"
          style={{ height, background: "#EFF2F7", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
        />
      );
    }
    if (topologyIsEmpty) {
      return (
        <div
          className="flex flex-col items-center justify-center rounded-card text-center"
          style={{ height, background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)", padding: 24 }}
        >
          <div className="text-[16px] font-semibold" style={{ color: "#0B1A2F" }}>No deliveries yet</div>
          <div className="mt-1 max-w-[420px] text-[13px]" style={{ color: "#56627A" }}>
            Add a supplier and upload your first PO — your buyer → supplier lanes appear here.
          </div>
          <Link
            href="/library/suppliers"
            className="mt-4 inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#F6F7FA]"
            style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            Add a supplier →
          </Link>
        </div>
      );
    }
    return (
      <WireTopology
        buyers={effective.buyers}
        suppliers={effective.suppliers}
        wires={effective.wires}
        height={height}
        onWireClick={handleWireClick}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto" style={{ background: "#F6F7FA" }}>
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
          <p className="mt-0.5 text-[13px]" style={{ color: "#56627A" }}>
            Live buyer → supplier lanes
          </p>
        </div>

        {showWindowControls && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Time-window selector — filters the data window the KPIs + export use. */}
            <div
              className="flex min-w-0 items-center overflow-hidden rounded-[6px] text-[12.5px]"
              style={{ border: "1px solid #E2E6EE" }}
              role="group"
              aria-label="Time window"
            >
              {WINDOWS.map((w, i) => {
                const active = w.key === windowKey;
                return (
                  <button
                    key={w.key}
                    type="button"
                    aria-pressed={active}
                    title={w.sub}
                    onClick={() => setWindowKey(w.key)}
                    className="min-w-0 px-3 py-1.5 font-medium transition-colors"
                    style={{
                      background: active ? "#0B1A2F" : "#FFFFFF",
                      color: active ? "#FFFFFF" : "#56627A",
                      borderRight: i < WINDOWS.length - 1 ? "1px solid #E2E6EE" : undefined,
                    }}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={handleExport}
              disabled={windowedOrders.length === 0}
              title={
                !isApiMockMode && (windowedReceivedPage?.totalCount ?? 0) > 100
                  ? `Export contains the most recent 100 of ${(windowedReceivedPage!.totalCount).toLocaleString()} orders in this window`
                  : windowedOrders.length === 0
                    ? "No orders in this window to export"
                    : "Download this window's orders as CSV"
              }
              className="flex items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors"
              style={{
                border: "1px solid #E2E6EE",
                background: "#FFFFFF",
                color: windowedOrders.length === 0 ? "#8A93A5" : "#0B1A2F",
                cursor: windowedOrders.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              ↓ Export report
            </button>
          </div>
        )}
      </div>

      {/* Guided wizard overlay — new users without a supplier */}
      {showWizard && <OnboardingWizard onDismiss={() => setWizardDismissed(true)} />}

      {showOnboardingHero ? (
        // ── Onboarding hero: the card is the primary next step (no topology yet) ──
        <div className="flex flex-1 justify-center p-4 sm:p-6">
          <div className="w-full max-w-[760px]">
            <p className="mb-3 text-[13px]" style={{ color: "#56627A" }}>
              Your pipeline is ready. Connect its first lane to start routing orders to suppliers.
            </p>
            <OnboardingChecklist
              status={onboardingStatus!}
              supplierCount={supplierCount}
              orderCount={orderCount}
              deliveredCount={deliveredCount}
              onResumeSetup={() => setWizardDismissed(false)}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 p-3 sm:gap-5 sm:p-5">
          {/* ── Wire Topology — the hero ─────────────────────────────────── */}
          <section aria-label="Order topology">
            {/* Hero framing: buyers ←→ suppliers summary + exception count */}
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[12px]">
              <span className="flex items-center gap-1.5 font-medium" style={{ color: "#0B1A2F" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1E66C9", display: "inline-block" }} />
                {effective.buyers.length} buyer{effective.buyers.length === 1 ? "" : "s"}
              </span>
              <span style={{ color: "#C6CDDA" }}>·</span>
              <span className="flex items-center gap-1.5 font-medium" style={{ color: "#0B1A2F" }}>
                {wireCount} active lane{wireCount === 1 ? "" : "s"}
              </span>
              <span style={{ color: "#C6CDDA" }}>·</span>
              <span className="flex items-center gap-1.5 font-medium" style={{ color: "#0B1A2F" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2E8E3A", display: "inline-block" }} />
                {effective.suppliers.length} supplier{effective.suppliers.length === 1 ? "" : "s"}
              </span>
              {openExceptionsAll > 0 && (
                <span
                  className="ml-auto inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[11.5px] font-semibold"
                  style={{ background: "#FAEFD6", color: "#C97A14" }}
                >
                  ⚠ {openExceptionsAll} open exception{openExceptionsAll === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {renderTopologyArea(topoHeight)}
          </section>

          {/* ── Finish-setup band (recedes as steps complete, hidden when done) ── */}
          {showChecklist && (
            <OnboardingChecklist
              status={onboardingStatus!}
              supplierCount={supplierCount}
              orderCount={orderCount}
              deliveredCount={deliveredCount}
              onResumeSetup={() => setWizardDismissed(false)}
            />
          )}

          {activeLane && <LaneDrawer lane={activeLane} onClose={() => setActiveLane(null)} />}

          {/* ── KPI strip ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {kpis.map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <div
                  key={i}
                  className="relative overflow-hidden rounded-card p-4"
                  style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
                >
                  <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: kpi.edge }} />
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`monument${kpi.loading ? " animate-pulse text-[#C6CDDA]" : ""}`}
                      style={{ fontSize: "clamp(28px, 4vw, 36px)", color: "#0B1A2F" }}
                    >
                      {kpi.value}
                    </div>
                    <div className="flex flex-shrink-0 items-center justify-center rounded-[7px]" style={{ width: 28, height: 28, background: kpi.iconBg }}>
                      <Icon size={15} style={{ color: kpi.iconColor }} />
                    </div>
                  </div>
                  <div className="mt-1 text-[12px] font-medium" style={{ color: "#56627A" }}>{kpi.label}</div>
                  <div className="mt-0.5 text-[11.5px] font-medium" style={{ color: kpi.subColor }}>{kpi.sub}</div>
                </div>
              );
            })}
          </div>

          {/* ── Bottom row: In transit + Dock health ─────────────────────── */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* In transit */}
            <div className="overflow-hidden rounded-card" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
              <div className="flex items-center px-4 py-3" style={{ borderBottom: "1px solid #E2E6EE" }}>
                <span className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>In transit</span>
                <span className="ml-2 text-[11.5px]" style={{ color: "#8A93A5" }}>· moving through the pipeline now</span>
              </div>
              <div className="divide-y" style={{ borderColor: "#E2E6EE" }}>
                {ordersLoading ? (
                  [0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="h-3 flex-1 animate-pulse rounded" style={{ background: "#E2E6EE" }} />
                      <div className="h-3 w-16 animate-pulse rounded" style={{ background: "#E2E6EE" }} />
                      <div className="h-5 w-12 animate-pulse rounded" style={{ background: "#E2E6EE" }} />
                    </div>
                  ))
                ) : inTransitRows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12.5px]" style={{ color: "#8A93A5" }}>
                    No orders in flight right now.
                  </div>
                ) : (
                  inTransitRows.map((row, i) => {
                    const inner = (
                      <>
                        <span className="min-w-[150px] flex-1 truncate font-mono text-[11.5px] font-medium" style={{ color: "#0F4FA8" }}>
                          {row.po}
                        </span>
                        <span className="max-w-[90px] truncate text-[12px] text-[#56627A]">{row.buyer}</span>
                        <FileChip type={row.fmt} />
                        <span
                          className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{ color: STAGE_COLOR[row.stage] ?? "#56627A", background: `${STAGE_COLOR[row.stage] ?? "#56627A"}18` }}
                        >
                          {row.stage}
                        </span>
                      </>
                    );
                    return row.id ? (
                      <Link
                        key={i}
                        href={`/inbox/${row.id}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-[#F6F7FA]"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                        {inner}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Supplier dock health */}
            <div className="overflow-hidden rounded-card" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #E2E6EE" }}>
                <span className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Supplier health</span>
                <Link href="/library/suppliers" className="inline-flex items-center gap-1 text-[11.5px] font-medium transition-colors hover:opacity-80" style={{ color: "#0F4FA8" }}>
                  All suppliers <ArrowRight size={12} />
                </Link>
              </div>
              <div className="divide-y" style={{ borderColor: "#E2E6EE" }}>
                {effective.suppliers.length === 0 ? (
                  <div className="text-center" style={{ color: "#8A93A5", padding: 16, fontSize: 12.5 }}>
                    No suppliers yet.
                  </div>
                ) : (
                  effective.suppliers.map((s) => {
                    const color = s.health >= 95 ? "#2E8E3A" : s.health >= 85 ? "#C97A14" : "#C53A3A";
                    const barBg = s.health >= 95 ? "#E2F1E2" : s.health >= 85 ? "#FAEFD6" : "#FBE3E3";
                    return (
                      <Link key={s.id} href={`/library/suppliers/${s.id}`} className="block px-4 py-3 transition-colors hover:bg-[#F6F7FA]">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="min-w-0 truncate pr-3 text-[12.5px] font-medium" style={{ color: "#0B1A2F" }}>
                            {s.name}
                          </span>
                          <span className="text-[12px] font-bold" style={{ color, fontFamily: "'JetBrains Mono', monospace" }}>
                            {s.health}%
                          </span>
                        </div>
                        <div className="overflow-hidden rounded-full" style={{ height: 5, background: barBg }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${s.health}%`, background: color }} />
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
