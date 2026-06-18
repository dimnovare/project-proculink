"use client";

// Bridge Dashboard — the signature Wire Topology screen ("Order topology").
//
// The Wire Topology is the hero: a live buyer → supplier lane map derived from
// real orders + suppliers. The dashboard never fabricates data —
//   • topology is built from the org's actual orders/suppliers — the server-side
//     GET /api/dashboard/topology aggregation is preferred; client-derived topology
//     (from the GET /api/orders working set) is the fallback when the endpoint
//     returns empty;
//   • KPIs are real counts over a selectable time window, or honestly labelled;
//     the "Urgent exceptions" count comes from live GET /api/orders/summary;
//   • the time-window selector + CSV export operate on that same order data.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { WireTopology } from "./WireTopology";
import type { WireBuyer, WireSupplier, Wire } from "./WireTopology";
import { FileChip } from "./FileChip";
import { StatusJourney } from "./StatusJourney";
import type { OrderStage } from "./StatusJourney";
import { LaneDrawer } from "./LaneDrawer";
import type { Lane } from "./LaneDrawer";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { OnboardingWizard } from "./OnboardingWizard";
import { buildChecklistSteps } from "./buildChecklistSteps";
import { PageHeader } from "./layout/PageHeader";
import { PageShell } from "./layout/PageShell";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import type { OrderSummary, Supplier } from "@/types/procurement";
import { ArrowRight, ArrowUpRight, Clock, AlertTriangle, CheckCircle2, Send, Activity, Download, Inbox, PackageCheck, XCircle, BarChart3, Network } from "lucide-react";

// ─── Brand accent (supplier green) ────────────────────────────────────────
// The supplier accent is the calm forest green from the design tokens
// (--brand-green #2E8E3A). These constants are for inline-styled
// SVG/border/background values where the CSS var doesn't cascade.
const GREEN = "#2E8E3A";        // --brand-green   (supplier dot, live dot)
const GREEN_DEEP = "#1E6D29";   // --brand-green-deep (success text / % labels)
// Same forest green for health bars + their % labels (design bar fill #2E8E3A).
const GREEN_BAR = "#2E8E3A";
// Buyer-blue — opens the headline KPI top-edge gradient (buyer side → supplier
// green) and drives buyer-side accents. Sampled --brand-blue #1E66C9.
const BLUE = "#1E66C9";
const BLUE_DEEP = "#0F4FA8";    // --brand-blue-deep (PO mono text in transit)

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
  "rejected_by_supplier",
]);

/** Orders that have reached a "processed" milestone, used for the auto-rate. */
const ELIGIBLE_STATUSES = new Set(["ready", "ready_to_deliver", "delivered"]);

/** Maps a raw API status to a short human label for the in-transit stage badge.
 *  Per-order labels match the inbox status badge (UnifiedStatusBadge is the source
 *  of truth) so the SAME order never reads differently across screens — e.g.
 *  pending_review is "Needs review" everywhere, not "Validate" here and
 *  "Needs review" in the inbox. (The Parse→…→Deliver rail track names are separate.) */
function stageLabel(status: string): string {
  switch (status) {
    case "parsing":         return "Parse";
    case "pending_parse":   return "Parse";
    case "pending_review":  return "Needs review";
    // Canonical pipeline vocabulary: "Transform" (not "Extract") and "Delivering"
    // (not "Ready") — a green "Ready" badge on an actively-delivering order
    // contradicted the per-row stepper.
    case "transforming":    return "Transform";
    case "delivering":      return "Delivering";
    case "delivery_failed": return "Failed";
    default:                return status;
  }
}

const STAGE_COLOR: Record<string, string> = {
  // Canonical human labels (live rows via stageLabel)
  Parse: "#1E66C9", "Needs review": "#C97A14", Validate: "#C97A14", Transform: "#6F4FCE", Delivering: "#2E8E3A", Failed: "#C53A3A",
  // Legacy human labels still emitted by the mock fallback rows
  Extract: "#6F4FCE", Ready: "#2E8E3A",
  // Raw API status values (defensive — if an unmapped status is shown verbatim)
  parsing: "#1E66C9", pending_parse: "#1E66C9", pending_review: "#C97A14",
  transforming: "#6F4FCE", delivering: "#2E8E3A", delivery_failed: "#C53A3A",
};

/**
 * Maps an in-transit row to a {@link StatusJourney} stage on the
 * Parse → Normalize → Validate → Transform → Deliver track (0–4 | "failed").
 * Accepts both raw API statuses (live rows) and the short stage labels used by
 * the mock-fallback rows, mirroring the design's per-row mini-stepper.
 */
function journeyStageFor(stage: string): OrderStage {
  switch (stage) {
    case "parsing":
    case "pending_parse":
    case "Parse":          return 0;
    case "Normalize":      return 1;
    case "pending_review":
    case "Needs review":
    case "Validate":       return 2;
    case "transforming":
    case "Extract":
    case "Transform":      return 3;
    case "delivering":
    case "Delivering":
    case "Ready":
    case "Deliver":        return 4;
    case "delivery_failed":
    case "Failed":         return "failed";
    default:               return 0;
  }
}

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

/**
 * Single source of truth for supplier/dock health → color, so every call site
 * uses identical thresholds (previously two divergent sets lived in this screen).
 * Design thresholds (screen-bridge.jsx): healthy ≥90 = forest green #2E8E3A,
 * at-risk ≥80 = amber #C97A14, poor = red #C53A3A.
 */
function healthColor(pct: number): string {
  if (pct >= 90) return GREEN_BAR;   // #2E8E3A
  if (pct >= 80) return "#C97A14";   // amber
  return "#C53A3A";                  // red
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

// Wizard dismissal persists per BROWSER SESSION (sessionStorage), so the guided
// wizard doesn't re-pop on every pre-supplier /bridge visit within a session,
// while a fresh session still offers it again. Not localStorage on purpose —
// this is a "not right now", not a permanent preference.
const WIZARD_DISMISSED_KEY = "plk-onboarding-wizard-dismissed";

export function BridgeDashboard() {
  const [activeLane, setActiveLane] = useState<Lane | null>(null);
  const [wizardDismissed, setWizardDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.sessionStorage.getItem(WIZARD_DISMISSED_KEY) === "1"; } catch { return false; }
  });
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  // Hero view: the operational funnel is primary; the system map (WireTopology)
  // is a secondary, power-user view kept one click away.
  const [heroTab, setHeroTab] = useState<"funnel" | "map">("funnel");

  const dismissWizard = useCallback(() => {
    setWizardDismissed(true);
    try { window.sessionStorage.setItem(WIZARD_DISMISSED_KEY, "1"); } catch { /* storage unavailable — in-memory state still applies */ }
  }, []);
  const resumeWizard = useCallback(() => {
    setWizardDismissed(false);
    try { window.sessionStorage.removeItem(WIZARD_DISMISSED_KEY); } catch { /* storage unavailable */ }
  }, []);

  // ?onboard=skip — the welcome page's "Skip the wizard for now" link lands here.
  // Previously this param was never read, so the wizard re-popped anyway.
  const searchParams = useSearchParams();
  const onboardSkip = searchParams.get("onboard") === "skip";
  useEffect(() => {
    if (onboardSkip) dismissWizard();
  }, [onboardSkip, dismissWizard]);
  // Direction-aware copy: "Supplier" → "Customer" in inbound mode (display only).
  const { direction, labels } = useOrderDirection();
  const noun = labels.counterpartyNoun;        // "Supplier" | "Customer"
  const nounLower = noun.toLowerCase();          // "supplier" | "customer"
  const pluralLower = labels.counterpartyPlural.toLowerCase(); // "suppliers" | "customers"

  // Shared onboarding-status query (same cache the checklist + wizard read).
  const { data: onboardingStatus } = useOnboardingStatus();
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    staleTime: 60_000,
  });
  const { data: ordersPage, isLoading: ordersLoading, isError: ordersError, refetch: refetchOrders } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    staleTime: 60_000,
  });
  const { data: topology, isLoading: topologyLoading } = useQuery({
    queryKey: ["dashboard-topology"],
    queryFn: () => apiClient.getDashboardTopology(),
    staleTime: 60_000,
  });
  const { data: ordersSummary, isLoading: summaryLoading, isError: summaryError } = useQuery({
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
       (ordersSummary?.byStatus?.["delivery_dead_letter"] ?? 0) +
       (ordersSummary?.byStatus?.["rejected_by_supplier"] ?? 0))
    : allOrders.filter((o) => EXCEPTION_STATUSES.has(o.status)).length;

  // ── Operational funnel (the hero) ─────────────────────────────────────────
  // Received → Blocked (needs review) → Ready → Delivered → Failed.
  //
  // Source: the SAME live GET /api/orders/summary aggregation already fetched
  // for the exception count (ordersSummary.byStatus). This is the org's true,
  // all-time, full-population status histogram — NOT capped at the 100-order
  // working set — so the funnel never under-reports for a busy org. In mock
  // mode the summary is derived from the same mockOrders, so the fallback
  // counts the loaded working set instead. We never fabricate numbers.
  const byStatus = ordersSummary?.byStatus ?? {};
  const sumStatuses = (...keys: string[]) =>
    keys.reduce((acc, k) => acc + ((byStatus as Record<string, number>)[k] ?? 0), 0);

  // The funnel reads from the same source as the exception count: the live
  // summary when authed, the loaded working set in mock mode. Keeping ONE base
  // means the funnel stages reconcile with the "Needs attention" KPI.
  const funnelLoading = !isApiMockMode ? summaryLoading : ordersLoading;
  const funnelError = !isApiMockMode ? summaryError : ordersError;
  const countBlocked = !isApiMockMode
    ? sumStatuses("pending_review")
    : allOrders.filter((o) => o.status === "pending_review").length;
  const countReady = !isApiMockMode
    ? sumStatuses("ready", "ready_to_deliver")
    : allOrders.filter((o) => o.status === "ready" || o.status === "ready_to_deliver").length;
  const countDelivered = !isApiMockMode
    ? sumStatuses("delivered")
    : allOrders.filter((o) => o.status === "delivered").length;
  const countFailed = !isApiMockMode
    ? sumStatuses("failed", "transform_failed", "delivery_failed", "delivery_dead_letter", "rejected_by_supplier")
    : allOrders.filter((o) => FAILED_STATUSES.has(o.status) || o.status === "rejected_by_supplier").length;
  const countReceived = !isApiMockMode
    ? (ordersSummary?.total ?? 0)
    : allOrders.length;

  // Funnel stages share ONE temporal base (all time) so the counts are directly
  // comparable. Colours: buyer-blue (received) → amber (blocked) → neutral
  // (ready) → supplier-green (delivered) → red (failed).
  const funnelStages: Array<{ key: string; label: string; value: number; color: string; tint: string; href?: string }> = [
    { key: "received",  label: "Received",     value: countReceived,  color: BLUE,       tint: "#EAF1FC" },
    { key: "blocked",   label: "Needs review", value: countBlocked,   color: "#C97A14",  tint: "#FFF6E6", href: "/operations/exceptions" },
    { key: "ready",     label: "Ready",        value: countReady,     color: "#56627A",  tint: "#F1F3F7" },
    { key: "delivered", label: "Delivered",    value: countDelivered, color: GREEN,      tint: "#E9F4EB" },
    { key: "failed",    label: "Failed",       value: countFailed,    color: "#C53A3A",  tint: "#FCEDED", href: "/operations/exceptions" },
  ];
  const funnelMax = Math.max(countReceived, 1);

  // ── KPIs — real counts, windowed where it makes sense, honestly labelled ──
  const windowSub = WINDOWS.find((w) => w.key === windowKey)!.sub;
  const fmt = (n: number) => (ordersLoading ? "…" : ordersError ? "—" : n.toLocaleString());

  const deliveredInWindow = windowedOrders.filter((o) => o.status === "delivered").length;
  const eligibleInWindow = windowedOrders.filter((o) => ELIGIBLE_STATUSES.has(o.status));
  const autoCount = eligibleInWindow.filter((o) => (o.unresolvedCount ?? 0) === 0).length;
  const autoPct = eligibleInWindow.length > 0 ? Math.round((100 * autoCount) / eligibleInWindow.length) : 0;

  // Auto-processed % is sampled over the loaded working set (capped at the
  // 100-order page), whereas "Orders received" shows the true windowed total
  // (windowedReceivedPage.totalCount). When the true total exceeds the loaded
  // sample, the two headline numbers compute on different bases — say so, so they
  // don't look contradictory.
  const autoSampled =
    !isApiMockMode && (windowedReceivedPage?.totalCount ?? 0) > allOrders.length;

  const exceptionsBad = openExceptionsAll > 0;
  // The exception count is only trustworthy once its source query has settled —
  // never flash an amber strip off a loading/error state (honest zero-state =
  // no banner at all).
  const exceptionsCountReliable = !isApiMockMode
    ? !summaryLoading && !summaryError
    : !ordersLoading && !ordersError;
  const showExceptionStrip = exceptionsCountReliable && openExceptionsAll > 0;
  const kpis: Array<{
    value: string;
    label: string;
    sub: string;
    subColor: string;
    subIcon: typeof ArrowUpRight | undefined;
    edge: string;
    loading: boolean;
    /** When set, the whole KPI card is a link (e.g. exceptions → triage view). */
    href?: string;
  }> = [
    {
      value: !isApiMockMode
        ? (ordersLoading ? "…" : ordersError ? "—" : (windowedReceivedPage?.totalCount ?? windowedOrders.length).toLocaleString())
        : fmt(windowedOrders.length),
      label: "Orders received",
      sub: windowSub,
      subColor: "#56627A",
      subIcon: ArrowUpRight,
      // Headline throughput metric: buyer-blue flows to supplier-green, mirroring
      // the topology cross-section. Sampled #1E66C9 → #2E8E3A.
      edge: `linear-gradient(90deg, ${BLUE} 0%, ${GREEN_BAR} 100%)`,
      loading: ordersLoading,
    },
    {
      value: !isApiMockMode
        ? (ordersLoading ? "…" : ordersError ? "—" : (windowedDeliveredPage?.totalCount ?? deliveredInWindow).toLocaleString())
        : fmt(deliveredInWindow),
      label: "Orders delivered",
      sub: windowSub,
      subColor: GREEN_DEEP,
      subIcon: CheckCircle2,
      edge: GREEN_BAR,
      loading: ordersLoading,
    },
    {
      value: !isApiMockMode
        ? (summaryLoading ? "…" : summaryError ? "—" : openExceptionsAll.toLocaleString())
        : fmt(openExceptionsAll),
      label: "Needs attention",
      // TEMPORAL SCOPE: this count comes from GET /api/orders/summary — the live
      // open backlog across ALL time — and is NOT filtered by the time-window
      // selector (unlike "Orders received/delivered/Auto-processed", which are
      // windowed). To keep every headline KPI on a comparable, explicitly-labelled
      // base, this card's sub LEADS WITH ITS SCOPE ("All time") so it can never be
      // misread as a windowed figure next to the windowed cards.
      sub: !isApiMockMode
        ? (summaryLoading ? "…" : summaryError ? "Live data unavailable" : exceptionsBad ? "All time · review needed" : "All time · all clear")
        : (ordersError ? "Live data unavailable" : exceptionsBad ? "All time · review needed" : "All time · all clear"),
      subColor: (!isApiMockMode ? (summaryLoading || summaryError) : (ordersLoading || ordersError))
        ? "#56627A"
        : exceptionsBad ? "#C97A14" : GREEN_DEEP,
      subIcon: (!isApiMockMode ? (summaryLoading || summaryError) : (ordersLoading || ordersError))
        ? undefined
        : exceptionsBad ? AlertTriangle : CheckCircle2,
      edge: exceptionsBad ? "#C97A14" : GREEN_BAR,
      loading: !isApiMockMode ? summaryLoading : ordersLoading,
      // The KPI is also the entry point to triage — the card links to the
      // exceptions view instead of being a dead number.
      href: "/operations/exceptions",
    },
    {
      value: ordersLoading ? "…" : ordersError ? "—" : eligibleInWindow.length >= 3 ? `${autoPct}%` : "—",
      label: "Auto-processed",
      // TEMPORAL SCOPE: windowed (same selector as Received/Delivered). Lead the
      // sub with the window so all four headline KPIs declare their base — three
      // windowed ("Last 30 days"), one all-time ("Needs attention") — and no two
      // numbers silently compute on different bases without saying so.
      sub: ordersError
        ? "Live data unavailable"
        : eligibleInWindow.length >= 3
        // Make the denominator explicit so "100%" can't read as "everything is fine" while orders
        // still need review — this is the % of COMPLETED orders that needed no manual mapping.
        ? `${windowSub} · ${autoCount} of ${eligibleInWindow.length} completed${autoSampled ? " (latest 100)" : ""}`
        : `${windowSub} · needs 3+ completed orders`,
      subColor: ordersError ? "#56627A" : eligibleInWindow.length >= 3 ? GREEN_DEEP : "#56627A",
      subIcon: ordersError ? undefined : eligibleInWindow.length >= 3 ? CheckCircle2 : Clock,
      edge: GREEN_BAR,
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
        // Uppercase so the format chip matches FileChip's canonical keys
        // (XLSX/cXML/EDI…) and the design's uppercase tags.
        fmt: (o.sourceFormat ?? "csv").toUpperCase(),
        stage: stageLabel(o.status),
      }));
    if (isApiMockMode && liveRows.length === 0) {
      return IN_TRANSIT_MOCK_FALLBACK.map((r) => ({ ...r, id: undefined as string | undefined }));
    }
    return liveRows;
  })();

  // ── Onboarding state ──────────────────────────────────────────────────────
  // The checklist self-fetches its own data (no prop threading); the dashboard
  // only needs the derived completion state for layout (hero vs band slot).
  const orderCount = allOrders.length;
  const hasOrders = orderCount > 0;

  const onboardingComplete =
    onboardingStatus != null && buildChecklistSteps(onboardingStatus, nounLower).complete;
  const showChecklist = onboardingStatus != null && !onboardingComplete;

  // No crossings to plot yet (no orders + nothing from the endpoint) → the
  // onboarding card takes the hero slot instead of an empty topology.
  // Guarded against ordersError: a failed orders fetch also yields orderCount===0,
  // and we must NOT hijack the screen with the onboarding hero on a load error —
  // the topology area's explicit error/Retry branch handles that case instead.
  const noTopologyData = !topologyLoadingState && !ordersError && orderCount === 0 && !endpointHasData;
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
    // Make the 100-row working-set cap visible inside the file itself, not just
    // on the button's hover title: a truncated export must say so.
    const windowTotal = windowedReceivedPage?.totalCount ?? 0;
    const truncated = windowTotal > allOrders.length;
    const rows = [header.map(esc).join(","), ...body];
    if (truncated) {
      rows.unshift(`# Most recent ${allOrders.length} of ${windowTotal} orders in this window`);
    }
    const csv = rows.join("\r\n");
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
    // Explicit error state: a backend hiccup must NOT masquerade as the
    // onboarding empty state ("Add a supplier"), which alarms an established org.
    // The onboarding empty state below is reserved for a genuine success + 0 rows.
    if (ordersError) {
      return (
        <div
          className="flex flex-col items-center justify-center rounded-card text-center"
          style={{ height, background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)", padding: 24 }}
          role="alert"
        >
          <div className="text-[16px] font-semibold" style={{ color: "#0B1A2F" }}>Couldn&apos;t load your topology</div>
          <div className="mt-1 max-w-[420px] text-[13px]" style={{ color: "#56627A" }}>
            We hit a problem fetching your live order view. Your connections are safe — this is a temporary loading error.
          </div>
          <button
            type="button"
            onClick={() => refetchOrders()}
            className="mt-4 inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#F6F7FA]"
            style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            Retry
          </button>
        </div>
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
            Add a {nounLower} and upload your first PO — your {labels.railHeader.toLowerCase()} connections appear here.
          </div>
          <Link
            href="/library/suppliers"
            className="mt-4 inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#F6F7FA]"
            style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            Add a {nounLower} →
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

  /** Operational funnel hero — the org's order pipeline as ordered, comparable
   *  counts on ONE temporal base (all time). Reuses the live summary aggregation;
   *  fabricates nothing. */
  function renderFunnel() {
    if (funnelLoading) {
      return (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse rounded-[10px]" style={{ height: 104, background: "#EFF2F7", border: "1px solid #E2E6EE" }} />
          ))}
        </div>
      );
    }
    if (funnelError) {
      return (
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center" role="alert">
          <div className="text-[15px] font-semibold" style={{ color: "#0B1A2F" }}>Couldn&apos;t load your pipeline</div>
          <div className="mt-1 max-w-[420px] text-[13px]" style={{ color: "#56627A" }}>
            We hit a problem fetching your live order counts. This is a temporary loading error.
          </div>
          <button
            type="button"
            onClick={() => refetchOrders()}
            className="mt-4 inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#F6F7FA]"
            style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <div className="p-4">
        {/* Five stage tiles — Received → Needs review → Ready → Delivered → Failed.
            Each shows a real count and a proportional bar (share of total received),
            so the relative scale of each stage is visible at a glance. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {funnelStages.map((s, idx) => {
            const pct = Math.min(100, Math.round((100 * s.value) / funnelMax));
            const tile = (
              <>
                <div className="flex items-center gap-1.5">
                  {(() => {
                    const Icon = [Inbox, AlertTriangle, Clock, PackageCheck, XCircle][idx];
                    return <Icon size={13} strokeWidth={2.25} style={{ color: s.color, flexShrink: 0 }} aria-hidden />;
                  })()}
                  <span className="text-[10.5px] font-semibold uppercase" style={{ color: "#56627A", letterSpacing: "0.05em" }}>
                    {s.label}
                  </span>
                </div>
                <div
                  className="monument mt-1 tabular-nums"
                  style={{ fontSize: "clamp(24px, 3.4vw, 32px)", lineHeight: 1.05, color: "#0B1A2F" }}
                >
                  {s.value.toLocaleString()}
                </div>
                <div className="mt-2.5 overflow-hidden rounded-full" style={{ height: 5, background: "#EFF2F7" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                </div>
              </>
            );
            const tileClass = "relative rounded-[10px] p-3.5";
            const tileStyle = { background: s.tint, border: `1px solid ${s.color}22` } as const;
            return s.href && s.value > 0 ? (
              <Link
                key={s.key}
                href={s.href}
                className={`${tileClass} no-underline transition-shadow hover:shadow-md`}
                style={tileStyle}
                title={`Open ${s.label.toLowerCase()}`}
              >
                {tile}
              </Link>
            ) : (
              <div key={s.key} className={tileClass} style={tileStyle}>
                {tile}
              </div>
            );
          })}
        </div>
        {/* Flow connector caption — names the pipeline order in plain language. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
          <span>Order pipeline</span>
          <span style={{ color: "#C6CDDA" }}>·</span>
          <span>Received</span>
          <ArrowRight size={11} aria-hidden />
          <span>Needs review</span>
          <ArrowRight size={11} aria-hidden />
          <span>Ready</span>
          <ArrowRight size={11} aria-hidden />
          <span>Delivered</span>
          <span style={{ color: "#C6CDDA" }}>·</span>
          <span>All time</span>
        </div>
      </div>
    );
  }

  return (
    <PageShell variant="wide" className="flex flex-col">
      {/* Page header — canonical PageHeader, sits directly on the grey canvas
          (no white bar), floating title + muted meta line. */}
      <PageHeader
          title="Dashboard"
          sub={
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span
                aria-hidden
                style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block" }}
              />
              Live order view
              <span style={{ color: "#C6CDDA" }}>·</span>
              {wireCount} connection{wireCount === 1 ? "" : "s"}
              <span style={{ color: "#C6CDDA" }}>·</span>
              {/* "active {plural}" — this counts only docks currently carrying orders
                  (derived topology), NOT the full roster on the Suppliers page, so it
                  must not be labelled a bare "{N} suppliers" count. */}
              {effective.suppliers.length} active {pluralLower}
            </span>
          }
          actions={
            showWindowControls ? (
              <>
                {/* Time-window selector — inset-pill segmented control (white bordered
                    track holding rounded pills; active pill = navy), matching design.
                    Filters the data window the KPIs + export use. */}
                <div
                  className="flex min-w-0 items-center gap-0.5 rounded-[8px] p-[3px] text-[12.5px]"
                  style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}
                  role="group"
                  aria-label="Time window"
                >
                  {WINDOWS.map((w) => {
                    const active = w.key === windowKey;
                    return (
                      <button
                        key={w.key}
                        type="button"
                        aria-pressed={active}
                        title={w.sub}
                        onClick={() => setWindowKey(w.key)}
                        className="min-h-[28px] min-w-0 rounded-[6px] px-3 py-1 font-medium transition-colors"
                        style={{
                          background: active ? "#0B1A2F" : "transparent",
                          color: active ? "#FFFFFF" : "#56627A",
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
                  className="flex min-h-[36px] items-center gap-2 rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#FCFCFD]"
                  style={{
                    border: "1px solid #E2E6EE",
                    background: "#FFFFFF",
                    color: windowedOrders.length === 0 ? "var(--ink-faint)" : "#0B1A2F",
                    cursor: windowedOrders.length === 0 ? "not-allowed" : "pointer",
                    boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
                  }}
                >
                  <Download size={14} strokeWidth={2} aria-hidden />
                  Export report
                </button>
              </>
            ) : undefined
          }
        />

      {/* Guided wizard overlay — new users without a supplier */}
      {showWizard && <OnboardingWizard onDismiss={dismissWizard} />}

      {showOnboardingHero ? (
        // ── Onboarding hero: the card is the primary next step (no topology yet) ──
        <div className="flex flex-1 justify-center">
          <div className="w-full max-w-[980px]">
            <p className="mb-4 text-[13px]" style={{ color: "#56627A" }}>
              Your pipeline is ready. Create its first connection to start {direction === "inbound" ? "confirming orders from customers" : "routing orders to suppliers"}.
            </p>
            <OnboardingChecklist onResumeSetup={resumeWizard} />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 sm:gap-5">
          {/* ── Exception strip — founder-approved triage entry (batch 4B) ──
              Shown only when open exceptions exist AND the count's source query
              has settled; zero exceptions = no banner (honest zero-state). */}
          {showExceptionStrip && (
            <Link
              href="/operations/exceptions"
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-[10px] px-4 py-3 no-underline transition-shadow hover:shadow-md"
              style={{ border: "1px solid #F0D39A", borderLeft: "3px solid #C97A14", background: "#FFF8EA" }}
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold" style={{ color: "#7A4D0B" }}>
                <AlertTriangle size={15} strokeWidth={2.25} style={{ color: "#C97A14", flexShrink: 0 }} aria-hidden />
                {openExceptionsAll} order{openExceptionsAll === 1 ? "" : "s"} need{openExceptionsAll === 1 ? "s" : ""} your attention
              </span>
              <span className="whitespace-nowrap text-[12.5px] font-semibold" style={{ color: "#9A5F0A" }}>
                Review exceptions →
              </span>
            </Link>
          )}

          {/* ── Hero — operational funnel (primary) + system map (secondary) ── */}
          {/* The order pipeline funnel is the headline content; the wire topology
              ("System map") is demoted to a secondary tab so power users keep it
              one click away without it dominating the screen. */}
          <section aria-label="Order pipeline">
            {/* Tab strip — Pipeline (default) | System map */}
            <div className="mb-3 flex items-center gap-1.5">
              <div
                className="flex items-center gap-0.5 rounded-[8px] p-[3px] text-[12.5px]"
                style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}
                role="tablist"
                aria-label="Dashboard view"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={heroTab === "funnel"}
                  onClick={() => setHeroTab("funnel")}
                  className="flex min-h-[28px] items-center gap-1.5 rounded-[6px] px-3 py-1 font-medium transition-colors"
                  style={{ background: heroTab === "funnel" ? "#0B1A2F" : "transparent", color: heroTab === "funnel" ? "#FFFFFF" : "#56627A" }}
                >
                  <BarChart3 size={13} strokeWidth={2.25} aria-hidden />
                  Pipeline
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={heroTab === "map"}
                  onClick={() => setHeroTab("map")}
                  className="flex min-h-[28px] items-center gap-1.5 rounded-[6px] px-3 py-1 font-medium transition-colors"
                  style={{ background: heroTab === "map" ? "#0B1A2F" : "transparent", color: heroTab === "map" ? "#FFFFFF" : "#56627A" }}
                >
                  <Network size={13} strokeWidth={2.25} aria-hidden />
                  System map
                </button>
              </div>
            </div>

            {heroTab === "funnel" ? (
              <div
                className="relative overflow-hidden rounded-card"
                style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
              >
                {/* Cross-section accent — received (blue) flows to delivered (green). */}
                <div
                  aria-hidden
                  style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${BLUE} 0%, ${GREEN} 100%)` }}
                />
                {renderFunnel()}
              </div>
            ) : (
              <div
                className="relative overflow-hidden rounded-card"
                style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
              >
                {/* Cross-section accent — buyer side (blue) flows to supplier side (green). */}
                <div
                  aria-hidden
                  style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, #1E66C9 0%, ${GREEN} 70%)` }}
                />
                {/* Legend header — right-aligned key; connection counts live in the page title. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3.5 pb-2 text-[11.5px]" style={{ color: "#56627A" }}>
                  <span className="flex items-center gap-1.5">
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1E66C9", display: "inline-block" }} />
                    Buyer
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block" }} />
                    {noun}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span style={{ width: 12, height: 2.5, borderRadius: 2, background: "#C97A14", display: "inline-block" }} />
                    At-risk connection
                  </span>

                  {openExceptionsAll > 0 && (
                    <Link
                      href="/operations/exceptions"
                      className="ml-auto inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[11.5px] font-semibold no-underline transition-opacity hover:opacity-80"
                      style={{ background: "#FAEFD6", color: "#C97A14" }}
                      title="Review exceptions"
                    >
                      ⚠ {openExceptionsAll} open exception{openExceptionsAll === 1 ? "" : "s"}
                    </Link>
                  )}
                </div>
                {/* Canvas sits flush inside the frame — strip the inner card chrome so
                    the surrounding wrapper is the single visible card (no double border). */}
                <div className="[&_.rounded-card]:!rounded-none [&_.rounded-card]:!border-0 [&_.rounded-card]:!shadow-none">
                  {renderTopologyArea(topoHeight)}
                </div>
              </div>
            )}
          </section>

          {/* ── Finish-setup band (recedes as steps complete; self-nulls when
              loading/errored, and shows the one-time completion card at 6/6) ── */}
          <OnboardingChecklist onResumeSetup={resumeWizard} />

          {activeLane && <LaneDrawer lane={activeLane} onClose={() => setActiveLane(null)} />}

          {/* ── KPI strip ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {kpis.map((kpi, i) => {
              const SubIcon = kpi.subIcon;
              const cardClass = "relative overflow-hidden rounded-card p-4 pt-[18px]";
              const cardStyle = { background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" } as const;
              const inner = (
                <>
                  <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: kpi.edge }} />
                  <div
                    className="text-[10.5px] font-semibold uppercase"
                    style={{ color: "#56627A", letterSpacing: "0.06em" }}
                  >
                    {kpi.label}
                  </div>
                  <div
                    className={`monument mt-1.5${kpi.loading ? " animate-pulse text-[#C6CDDA]" : ""}`}
                    style={{ fontSize: "clamp(28px, 4vw, 36px)", lineHeight: 1.05, color: "#0B1A2F" }}
                  >
                    {kpi.value}
                  </div>
                  <div
                    className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium"
                    style={{ color: kpi.subColor }}
                  >
                    {SubIcon && <SubIcon size={13} strokeWidth={2.25} style={{ flexShrink: 0 }} />}
                    <span className="truncate">{kpi.sub}</span>
                  </div>
                </>
              );
              // KPI cards with an href are real links (e.g. Urgent exceptions →
              // the triage view) — same chrome, plus a hover affordance.
              return kpi.href ? (
                <Link
                  key={i}
                  href={kpi.href}
                  className={`${cardClass} no-underline transition-shadow hover:shadow-md`}
                  style={cardStyle}
                  title={`Open ${kpi.label.toLowerCase()}`}
                >
                  {inner}
                </Link>
              ) : (
                <div key={i} className={cardClass} style={cardStyle}>
                  {inner}
                </div>
              );
            })}
          </div>

          {/* ── Bottom row: In transit + Dock health ─────────────────────── */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* In transit */}
            <div className="overflow-hidden rounded-card" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
              <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid #E2E6EE" }}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <Send size={15} strokeWidth={2} style={{ color: "#56627A", flexShrink: 0 }} aria-hidden />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>In transit</div>
                    <div className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>moving through the pipeline now</div>
                  </div>
                </div>
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
                ) : ordersError ? (
                  // Honest error state — never imply "nothing in flight" on a load failure.
                  <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[12.5px]" style={{ color: "var(--ink-faint)" }} role="alert">
                    <span style={{ color: "#56627A" }}>Couldn&apos;t load in-transit orders.</span>
                    <button
                      type="button"
                      onClick={() => refetchOrders()}
                      className="inline-flex items-center gap-1 rounded-[6px] px-3 py-1 text-[12px] font-medium transition-colors hover:bg-[#F6F7FA]"
                      style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
                    >
                      Retry
                    </button>
                  </div>
                ) : inTransitRows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12.5px]" style={{ color: "var(--ink-faint)" }}>
                    No orders in flight right now.
                  </div>
                ) : (
                  inTransitRows.map((row, i) => {
                    // Per-row layout mirrors the design: a top line (PO · buyer ·
                    // format · stage) above a compact Parse→Deliver mini-stepper.
                    const inner = (
                      <>
                        {/* Mobile-safe: PO · buyer · format · stage can crowd at 375px,
                            so the line wraps and the stage badge drops below when
                            there's no room (sm+ keeps it on one justify-between row). */}
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="whitespace-nowrap font-mono text-[12px] font-semibold" style={{ color: BLUE_DEEP }}>
                              {row.po}
                            </span>
                            <span className="max-w-full truncate text-[12px]" style={{ color: "#56627A" }}>{row.buyer}</span>
                            <FileChip type={row.fmt} />
                          </div>
                          <span
                            className="flex-shrink-0 whitespace-nowrap text-[11px] font-semibold"
                            style={{ color: STAGE_COLOR[row.stage] ?? "#56627A" }}
                          >
                            {stageLabel(row.stage)}
                          </span>
                        </div>
                        <StatusJourney stage={journeyStageFor(row.stage)} compact />
                      </>
                    );
                    return row.id ? (
                      <Link
                        key={i}
                        href={`/inbox/${row.id}`}
                        className="flex flex-col gap-2 px-4 py-[11px] transition-colors hover:bg-[#F6F7FA]"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div key={i} className="flex flex-col gap-2 px-4 py-[11px]">
                        {inner}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Supplier health */}
            <div className="overflow-hidden rounded-card" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
              <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid #E2E6EE" }}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <Activity size={15} strokeWidth={2} style={{ color: "#56627A", flexShrink: 0 }} aria-hidden />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>{noun} health</div>
                    {/* "Delivery success rate" (not "Acceptance rate"): this figure
                        measures successful pipeline delivery, not supplier acceptance.
                        The "last 30 days" qualifier is only honest on the server
                        topology path (endpointHasData — backend 30-day window). On the
                        client-derived fallback (and transiently before the topology
                        query resolves) the figure is all-time, so drop the window. */}
                    <div className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>Delivery success rate{endpointHasData ? ", last 30 days" : ""}</div>
                  </div>
                </div>
                <Link
                  href="/library/suppliers"
                  className="inline-flex flex-shrink-0 items-center gap-1 text-[11.5px] font-medium transition-colors hover:text-[#1E6D29]"
                  style={{ color: "#56627A" }}
                >
                  All {pluralLower} <ArrowRight size={12} />
                </Link>
              </div>
              <div className="divide-y" style={{ borderColor: "#EEF0F4" }}>
                {effective.suppliers.length === 0 ? (
                  <div className="text-center" style={{ color: "var(--ink-faint)", padding: 16, fontSize: 12.5 }}>
                    No {pluralLower} yet.
                  </div>
                ) : (
                  effective.suppliers.map((s) => {
                    // Health → color via the single in-file healthColor() helper
                    // (one threshold set, no per-call-site drift).
                    const color = healthColor(s.health);
                    return (
                      <Link
                        key={s.id}
                        href={`/library/suppliers/${s.id}`}
                        className="flex min-h-[44px] items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[#F6F7FA] sm:gap-3 sm:px-4 sm:py-2.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" style={{ color: "#0B1A2F" }}>
                          {s.name}
                        </span>
                        <div
                          className="hidden overflow-hidden rounded-full sm:block"
                          style={{ width: 160, height: 6, background: "#EFF2F7" }}
                        >
                          <div className="h-full rounded-full transition-all" style={{ width: `${s.health}%`, background: color }} />
                        </div>
                        <span
                          className="w-[40px] flex-shrink-0 text-right text-[12px] font-bold tabular-nums"
                          style={{ color, fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {s.health}%
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
