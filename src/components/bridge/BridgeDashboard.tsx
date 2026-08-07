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
import { statusLabel } from "./UnifiedStatusBadge";
import { StatusJourney, failedStageFor, isFailureStatus } from "./StatusJourney";
import type { OrderStage } from "./StatusJourney";
import { LaneDrawer } from "./LaneDrawer";
import type { Lane } from "./LaneDrawer";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { OnboardingWizard } from "./OnboardingWizard";
import { buildChecklistSteps } from "./buildChecklistSteps";
import { DashboardContextLine } from "./DashboardContextLine";
import { PageHeader } from "./layout/PageHeader";
import { PageShell } from "./layout/PageShell";
import { countFor, pagePopulation, practiceOrderNote, statusesForLabel, summaryPopulation } from "./orderCountContract";
import { PracticeChip } from "./PracticeChip";
// The one registry of what to do about a stuck order. The dashboard reads the
// same `rowAction` the inbox row renders, so the two can't disagree.
import { problemFor } from "./problem/problemCopy";
// The one mirror of the backend's status machine. The dashboard's health and
// exception groupings are DERIVED from its buckets rather than hand-listed — see
// FAILED_STATUSES below for the defect that costs.
import { FAILURE_STATUSES, PARKED_STATUSES } from "@/lib/orderStatusManifest";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import type { OrderStatus, OrderSummary, Supplier } from "@/types/procurement";
import { ArrowRight, ArrowUpRight, Clock, AlertTriangle, CheckCircle2, Send, Activity, Download, BarChart3, Network, ChevronRight } from "lucide-react";

// ─── Brand accent (supplier green) ────────────────────────────────────────
// The supplier accent is the calm forest green from the design tokens
// (--brand-green #2E8E3A). These constants are for inline-styled
// SVG/border/background values where the CSS var doesn't cascade.
const GREEN = "#2E8E3A";        // --brand-green   (supplier dot, live dot)
const GREEN_BTN = "#297F34";    // solid fill under white text — ≈4.6:1 AA (2E8E3A was 4.16:1)
const GREEN_DEEP = "#1E6D29";   // --brand-green-deep (success text / % labels)
// Same forest green for health bars + their % labels (design bar fill #2E8E3A).
const GREEN_BAR = "#2E8E3A";
// Buyer-blue — opens the headline KPI top-edge gradient (buyer side → supplier
// green) and drives buyer-side accents. Sampled --brand-blue #1E66C9.
const BLUE = "#1E66C9";
const BLUE_DEEP = "#0F4FA8";    // --brand-blue-deep (PO mono text in transit)
const BLUE_SOFT = "#EAF0F8";    // --brand-blue-soft (buyer avatar bg)
const GREEN_SOFT = "#E9F1EA";   // --brand-green-soft (supplier avatar bg)
const AMBER = "#B36D14";        // --amber (uncertain / needs-review)
const AMBER_SOFT = "#FAF1DD";   // --amber-soft

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

/**
 * Hard failures — drag down supplier and flow health.
 *
 * DERIVED from the manifest's `FAILURE_STATUSES`, which is computed from that file's
 * bucket column and mirrors OrderStatusConstants.FailureBucket.
 *
 * IT USED TO BE A HAND-TYPED DENY-LIST, and it omitted `rejected_by_supplier`. The
 * consequence was live on the product's signature screen: a supplier that had REFUSED
 * every order it was ever sent scored `(total - 0) / total` = 100, and WireTopology
 * paints `health >= 90` forest green — a green "100% del" pill for a flow where nothing
 * had ever been accepted. The same file's EXCEPTION_STATUSES *did* contain
 * `rejected_by_supplier`, so the wire between the two ports degraded to amber at the
 * same time, and the canvas contradicted itself end to end.
 *
 * The omission is the symptom; the deny-list is the defect. A list written out by hand
 * fails OPEN — a failure status the backend adds tomorrow is in neither this set nor
 * EXCEPTION_STATUSES, the wire's ternary chain falls through to `: "ok"`, and the
 * screen reports perfect health for a state it has never heard of. Reading the manifest
 * means a status added there is covered the moment it is added.
 */
export const FAILED_STATUSES: ReadonlySet<string> = new Set<string>(FAILURE_STATUSES);

/** Anything that needs a human now — the dashboard's in-app grouping, used by the
 *  supplier-health exception counts and the "Needs you" rows. Both render from the
 *  loaded working set, so this set answers "does this order want attention?" and is
 *  free to be broader than what the backend files an exception row for.
 *  NOT for the amber strip's count — that links out to /operations/exceptions and must
 *  use EXCEPTION_ROW_STATUSES (see there; delivery_held is the difference).
 *
 *  DERIVED, for the same reason FAILED_STATUSES is: every status the manifest does not
 *  bucket as `healthy`, plus `pending_review` — which IS healthy (a review is the
 *  product working as designed, not a fault) but still wants a person today.
 *
 *  That derivation is what keeps the distinction this comment used to have to argue for.
 *  The manifest buckets `delivery_held` (billing paused the send) and
 *  `delivery_unconfirmed` (a crash lost the outcome) as `parked`, not `failure`: they
 *  need a human, but nothing broke, so counting them as hard failures would drag supplier
 *  health down for an order whose output is intact — and in the unconfirmed case we do
 *  not know that it failed, only that we cannot confirm what happened. Both are likewise
 *  absent from ACTIVE_STATUSES: a parked order is not moving.
 *
 *  Deriving also picks up `unrouted`, which the hand-typed set missed. An order that
 *  parsed but resolved no supplier is parked on an operator decision exactly like the
 *  other two, `problemFor` has carried a case for it for as long as the registry has
 *  existed, and it was absent here only because this list was written before the app
 *  modelled the status. */
export const EXCEPTION_STATUSES = new Set<string>([
  "pending_review",
  ...FAILURE_STATUSES,
  ...PARKED_STATUSES,
]);

/** Statuses the BACKEND writes an OrderException row for — the count behind the amber
 *  "N orders need your attention" strip.
 *
 *  THE CONSTRAINT: this set must track `OrderExceptionService.ProblemFor`
 *  (ProcuLink.Infrastructure/Services/OrderExceptionService.cs). The strip is a link to
 *  /operations/exceptions, and that page renders `getExceptions(...)` — OrderException
 *  rows, nothing else. So a status counted here that ProblemFor has no case for sends
 *  the operator to an EMPTY page: billing lapses → 3 orders go delivery_held → "3 orders
 *  need your attention" → click → nothing there.
 *
 *  That is why this is NOT EXCEPTION_STATUSES, despite the overlap. That set is the
 *  dashboard's broader "needs a human" grouping and includes `delivery_held`, which has
 *  no ProblemFor case (a billing pause is released by settling billing, and no exception
 *  row is ever written for it). `delivery_unconfirmed` IS here: ProblemFor gives it a
 *  real case (severity `warning`), so the row exists and the page will show it.
 *
 *  Known and deliberate: ProblemFor also opens rows this status histogram does not count,
 *  so the strip can UNDER-report. That direction is safe — a missed nudge, not a promise
 *  with a dead end behind it. Two cases, and the first sentence here used to be wrong
 *  about the second:
 *    • unresolved lines in a status other than pending_review — a per-line condition no
 *      status histogram can see.
 *    • `unrouted`. This read "which this app's OrderStatus doesn't model", and that is no
 *      longer true — `unrouted` has been in the union since the content-routing ingest
 *      paths shipped, and ProblemFor's FIRST case writes an `unrouted_order` row for it
 *      (ProcuLink.Infrastructure/Services/OrderExceptionService.cs:36-37). So this set
 *      could include it and the exceptions page would have the rows to show. It is left
 *      out here only because that is a change to what this set MIRRORS, pinned by its own
 *      assertion in openExceptionsAll.test.ts, and not part of the health-derivation fix
 *      this file's FAILED_STATUSES comment describes. Tracked, not forgotten. */
export const EXCEPTION_ROW_STATUSES = new Set<OrderStatus>([
  "pending_review",
  "failed",
  "transform_failed",
  "delivery_failed",
  "delivery_dead_letter",
  "rejected_by_supplier",
  "delivery_unconfirmed",
]);

/** Sums `byStatus` counts across a status set. This is the ONE place either
 *  branch of `openExceptionsAll` may read status membership from — so the live and
 *  mock branches can never drift apart on which statuses count. (Exported and
 *  unit-tested directly in openExceptionsAll.test.ts — BridgeDashboard itself pulls
 *  in too much — Clerk, TanStack Query, the topology canvas — to render in a unit test.) */
export function sumByStatuses(
  byStatus: Partial<Record<OrderStatus, number>> | null | undefined,
  statuses: Set<OrderStatus>,
): number {
  let total = 0;
  for (const status of statuses) total += byStatus?.[status] ?? 0;
  return total;
}

/** Orders that have reached a "processed" milestone, used for the auto-rate. */
const ELIGIBLE_STATUSES = new Set(["ready", "ready_to_deliver", "delivered"]);

/**
 * The "Needs you" row's second line: what happened, then what to do about it.
 *
 * "<what happened> — <what to do>": the first half is ALWAYS the status registry's
 * label, the second half is ALWAYS the problem registry's `rowAction`. Neither half
 * is written here any more, and the history is why.
 *
 * ROUND 1 — the WORDS drifted. This was four hand-written labels ("Delivery failed
 * — retry" for both delivery_failed AND delivery_dead_letter, "Transform failed —
 * check mapping", "Failed — needs attention"), which put the retired engine-stage
 * vocabulary on the dashboard while the badge one row over used the plain one. The
 * fix was to take the first half from `statusLabel`.
 *
 * ROUND 2 — the FACTS drifted, because that fix left a second hand-written map of
 * what-to-do sitting next to the one the rest of the product reads. It told the
 * operator "Couldn't send — try sending again" while the order screen for the very
 * same status said the opposite: `delivery_failed`'s `automatic` is "We're trying
 * again automatically", its tier is `wait`, and it prints "You don't have to do
 * anything." One state, two surfaces, opposite instructions — and the dashboard is
 * where the operator decides whether to open the order at all.
 *
 * It also covered only FIVE statuses while `EXCEPTION_STATUSES` admits eight
 * (`delivery_held`, `delivery_unconfirmed`) plus `unrouted` via the unresolvedCount
 * branch, so three states rendered as a bare status name in a section titled "Needs
 * you" — naming the state instead of the next step, which is the one job this line
 * has.
 *
 * So the line derives from `problemFor`, the single record that already owns every
 * one of those states. `rowAction` is documented as "the one line that says what to
 * do" and the inbox row already renders it; reading the same field is what keeps the
 * two screens saying the same thing about the same order tomorrow. Lowercasing the
 * first character keeps the clause shape after the em-dash ("Couldn't send —
 * retrying automatically") — `rowAction` is sentence-cased for the inbox, where it
 * stands alone.
 *
 * Module scope and exported so `src/test/failureRecoveryCoverage.test.ts` can walk
 * every status the backend machine knows and assert this line never degrades to a
 * bare status name for one that needs a person. Nested inside the component it was
 * pure but unreachable, which is exactly how ROUND 2 survived review.
 */
export function neededForOrder(o: Pick<OrderSummary, "status" | "unresolvedCount">): string {
  const unresolved = o.unresolvedCount ?? 0;
  if (o.status === "pending_review") {
    return unresolved > 0
      ? `${unresolved} item code${unresolved === 1 ? "" : "s"} to confirm`
      : "Review before sending";
  }
  const problem = problemFor(o.status);
  if (!problem) return statusLabel(o.status);
  const next = problem.rowAction.charAt(0).toLowerCase() + problem.rowAction.slice(1);
  return `${statusLabel(o.status)} — ${next}`;
}

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
  Parse: "#1E66C9", "Needs review": "#B36D14", Validate: "#B36D14", Transform: "#6F4FCE", Delivering: "#2E8E3A", Failed: "#B43838",
  // Legacy human labels still emitted by the mock fallback rows
  Extract: "#6F4FCE", Ready: "#2E8E3A",
  // Raw API status values (defensive — if an unmapped status is shown verbatim)
  parsing: "#1E66C9", pending_parse: "#1E66C9", pending_review: "#B36D14",
  transforming: "#6F4FCE", delivering: "#2E8E3A", delivery_failed: "#B43838",
};

/**
 * Maps an in-transit row to a {@link StatusJourney} stage on the
 * Parse → Normalize → Validate → Transform → Deliver track (0–4 | failed-at-node).
 * Accepts both raw API statuses (live rows) and the short stage labels used by
 * the mock-fallback rows, mirroring the design's per-row mini-stepper.
 * Exported for statusJourneyFailedStage.test.tsx only.
 */
/**
 * The mock-mode twin of `countFor`: the same contract label, counted over the loaded
 * working set instead of the live summary histogram. Derived from ORDER_COUNT_CONTRACT
 * so the two branches cannot drift — the previous code wrote each status set twice
 * (once per branch) and one of the pairs disagreed.
 */
function countInWorkingSet(label: string, orders: OrderSummary[]): number {
  const statuses = statusesForLabel(label);
  if (statuses === undefined) {
    throw new Error(`BridgeDashboard: "${label}" is not in ORDER_COUNT_CONTRACT.`);
  }
  if (statuses === null) return orders.length;
  const set = new Set<string>(statuses);
  return orders.filter((o) => set.has(o.status)).length;
}

export function journeyStageFor(stage: string): OrderStage {
  // Any raw failure status gets its node from the shared map — today only
  // delivery_failed is in ACTIVE_STATUSES, but an expansion of that set must
  // not fall through to the `default: 0` (X at Parse) below.
  if (isFailureStatus(stage)) return failedStageFor(stage);
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
    // The "Failed" label reaches here only from delivery_failed — stageLabel's
    // single "Failed" case — so the label pins to the Deliver node too.
    case "Failed":         return failedStageFor("delivery_failed");
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

/**
 * The window a stat card's numbers actually cover — the card's own claim, not the page's.
 *
 * The health rail prints three delivery figures side by side and they do NOT share a window:
 * throughput follows the selector above, the success rate comes from `/api/orders/summary`
 * which takes no date filter at all, and supplier health is a 30-day rate on the server path
 * and an all-time one on the client fallback.
 *
 * On 2026-08-06 that produced "3 orders received · last 30 days", "0 delivered · last 30 days",
 * and an unlabelled "60% success rate" between them. Each number was right. The unlabelled one
 * simply inherited its neighbours' window and contradicted both.
 *
 * So a card declares its window as data AND prints it from the same table — one source, so the
 * label cannot drift from the claim. `dashboardStatWindows.test.tsx` walks every tagged card.
 */
export type StatWindow = WindowKey;
export const STAT_WINDOW_TEXT = Object.fromEntries(
  WINDOWS.map((w) => [w.key, w.sub.toLowerCase()]),
) as Record<StatWindow, string>;

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

/** Two-letter monogram for an avatar tile, e.g. "Nordic Electronics" → "NE". */
function initialsFor(name: string): string {
  const words = (name ?? "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Compact relative age from an ISO timestamp, e.g. "32 min", "2 h", "3 d". */
function ageFrom(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/** Square monogram tile — buyer (blue) or supplier (green), per the semantic law. */
function Avatar({ name, tone = "buyer", size = 28 }: { name: string; tone?: "buyer" | "supplier"; size?: number }) {
  const fg = tone === "buyer" ? BLUE : GREEN;
  const bg = tone === "buyer" ? BLUE_SOFT : GREEN_SOFT;
  return (
    <span
      aria-hidden
      className="inline-flex flex-shrink-0 items-center justify-center font-bold"
      style={{ width: size, height: size, borderRadius: 8, background: bg, color: fg, fontSize: Math.round(size * 0.34) }}
    >
      {initialsFor(name)}
    </span>
  );
}

/** Section header — display title + optional count pill + note + right-aligned action link. */
function SectionHead({
  title,
  count,
  note,
  actionHref,
  actionLabel,
}: {
  title: string;
  count?: number;
  note?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <h3
        className="m-0 whitespace-nowrap"
        style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontWeight: 700, fontSize: 15.5, letterSpacing: "-0.01em", color: "#0B1A2F" }}
      >
        {title}
      </h3>
      {count != null && (
        <span
          className="tabular-nums"
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, fontWeight: 700, color: "#5E6779", background: "#F1F3F7", border: "1px solid #E5E8EE", borderRadius: 999, padding: "1px 8px" }}
        >
          {count}
        </span>
      )}
      {note && <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>{note}</span>}
      {actionHref && actionLabel && (
        <Link href={actionHref} className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold no-underline" style={{ color: BLUE }}>
          {actionLabel}
          <ArrowRight size={12} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/**
 * Single source of truth for supplier/dock health → color, so every call site
 * uses identical thresholds (previously two divergent sets lived in this screen).
 * Design thresholds (screen-bridge.jsx): healthy ≥90 = forest green #2E8E3A,
 * at-risk ≥80 = amber #B36D14, poor = red #B43838.
 */
function healthColor(pct: number | null): string {
  if (pct === null) return "#5E6779"; // no orders yet — grey, because there is no verdict
  if (pct >= 90) return GREEN_BAR;   // #2E8E3A
  if (pct >= 80) return "#B36D14";   // amber
  return "#B43838";                  // red
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

export interface DerivedTopology {
  buyers: WireBuyer[];
  suppliers: WireSupplier[];
  wires: Wire[];
}

/**
 * Delivery health as a percentage, or `null` when there is no order to judge it by.
 *
 * This used to be `total === 0 ? 100 : …` inline. Zero orders is not perfect health, it
 * is no evidence, and 100 is the one answer that cannot be true — it renders the same
 * confident forest green as a supplier that has accepted a thousand orders. Returning
 * null makes the callers say "no orders yet" instead of inventing a number, which is the
 * same rule the rest of this screen already follows for counts it does not have.
 */
export function supplierHealthPct(total: number, failed: number): number | null {
  if (total <= 0) return null;
  return Math.round((100 * (total - failed)) / total);
}

/**
 * Build the wire topology from the org's real data. Suppliers come from the
 * configured supplier list (docks exist even before their first order) plus any
 * supplier seen on an order; buyers and wires come from orders that carry both a
 * buyer and supplier name. Health/alerts reflect actual order statuses.
 *
 * Exported for topologyHealth.test.ts. Like `sumByStatuses` above, it is pure and the
 * component around it is not renderable in a unit test — and unlike the component, it is
 * where the screen decides what colour a supplier is.
 */
export function deriveTopology(orders: OrderSummary[], suppliers: Supplier[]): DerivedTopology {
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
      health: supplierHealthPct(s.total, s.failed),
    }));

  const buyerIdByKey = new Map([...buyMap.values()].map((b) => [normName(b.name), b.id] as const));
  const supplierIdByKey = new Map([...supMap.values()].map((s) => [normName(s.name), s.id] as const));

  const wires: Wire[] = [];
  for (const w of wireMap.values()) {
    const buyerId = buyerIdByKey.get(w.buyerKey);
    const supplierId = supplierIdByKey.get(w.supplierKey);
    if (!buyerId || !supplierId) continue;
    // The `: "ok"` at the end of this chain is a DEFAULT, and a default is only as safe
    // as the sets above it are complete. While FAILED_STATUSES and EXCEPTION_STATUSES
    // were hand-typed, any status neither list happened to name landed here and painted
    // the wire blue→green. Both derive from the manifest now, so falling through means
    // "the manifest buckets every one of these orders as healthy" rather than "nobody
    // remembered to add it".
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

  // Gate all data queries on auth readiness to prevent the cold-mount 401 race:
  // on a hard refresh, queries fire before the Clerk token is ready → 401 →
  // TanStack Query parks them (fetchStatus 'paused'), leaving the dashboard empty.
  // useQueriesEnabled() resolves true for mock mode, QA-bypass, AND signed-in Clerk.
  const queryEnabled = useQueriesEnabled();

  // Shared onboarding-status query (same cache the checklist + wizard read).
  const { data: onboardingStatus } = useOnboardingStatus();
  const { data: suppliers, isLoading: suppliersLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    staleTime: 60_000,
    enabled: queryEnabled,
  });
  const { data: ordersPage, isLoading: ordersLoading, isError: ordersError, refetch: refetchOrders } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    staleTime: 60_000,
    enabled: queryEnabled,
  });
  // `isError` + `refetch` are read below. They were previously dropped, which is
  // how this query became the one hero input that could fail in total silence:
  // its `data` is spread through `?? []` into an empty topology, and an empty
  // topology is indistinguishable from a quiet, healthy morning.
  const { data: topology, isLoading: topologyLoading, isError: topologyError, refetch: refetchTopology } = useQuery({
    queryKey: ["dashboard-topology"],
    queryFn: () => apiClient.getDashboardTopology(),
    staleTime: 60_000,
    enabled: queryEnabled,
  });
  const { data: ordersSummary, isLoading: summaryLoading, isError: summaryError } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    staleTime: 30_000,
    enabled: queryEnabled,
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

  // Throughput sparkline — real orders-received count per day over the last 7
  // days (index 6 = today). Derived from the loaded working set; a busy org's
  // true windowed total still shows as the big number below (windowedReceivedPage).
  const weeklyBars = useMemo(() => {
    const bins = [0, 0, 0, 0, 0, 0, 0];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = startOfToday.getTime();
    for (const o of allOrders) {
      const t = new Date(o.createdAt).getTime();
      if (!Number.isFinite(t)) continue;
      const dayIdx = 6 - Math.floor((todayStart - t) / DAY_MS);
      if (dayIdx >= 0 && dayIdx <= 6) bins[dayIdx]++;
    }
    return bins;
  }, [allOrders]);

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
  // Which window the "{noun} health" percentages really cover. The server aggregation applies a
  // 30-day cutoff to its supplier rows; the client fallback has none. One value, read by both
  // the card's data attribute and the sentence under its title.
  const supplierHealthWindow: StatWindow = endpointHasData ? "30d" : "all";

  const topologyLoadingState = ordersLoading || topologyLoading;
  const topologyIsEmpty =
    !topologyLoadingState && effective.buyers.length === 0 && effective.suppliers.length === 0;

  // Cold-mount gate: on a hard refresh the queries are still in-flight while
  // `effective` is transiently empty. Without this, the page-header summary and
  // the "{noun} health" card flash "0 connections", "0 active {plural}", and
  // "No {plural} yet" before the data arrives. Only treat as loading when the
  // queries are actually enabled (mock/QA/signed-out resolve instantly), so
  // those modes still render their genuine (often empty) state immediately.
  const isInitialLoading =
    queryEnabled && (suppliersLoading || ordersLoading || summaryLoading || topologyLoading);
  // The "{noun} health" card reads `effective.suppliers`, which is built from the
  // suppliers + orders + topology queries — gate its empty state on all three.
  const supplierHealthLoading = queryEnabled && (suppliersLoading || topologyLoadingState);

  // Adaptive height — tall enough to be the hero, compact when few ports.
  const maxPorts = Math.max(effective.buyers.length, effective.suppliers.length);
  const topoHeight = Math.min(520, Math.max(320, 150 + maxPorts * 74));

  const wireCount = effective.wires.length;
  // Both branches read EXCEPTION_ROW_STATUSES through sumByStatuses / .has, so live and
  // mock can't drift — and the ONE set they read mirrors the backend's ProblemFor, which
  // is what decides whether /operations/exceptions has anything to show when the strip
  // is clicked. Do not point this at EXCEPTION_STATUSES: that set is the broader
  // "needs a human" grouping and counting its delivery_held orders here promises rows
  // the exceptions page will not have.
  const openExceptionsAll = !isApiMockMode
    ? sumByStatuses(ordersSummary?.byStatus, EXCEPTION_ROW_STATUSES)
    : allOrders.filter((o) => EXCEPTION_ROW_STATUSES.has(o.status)).length;

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

  // The funnel reads from the same source as the exception count: the live
  // summary when authed, the loaded working set in mock mode. Keeping ONE base
  // means the funnel stages reconcile with the "Needs attention" KPI.
  const funnelLoading = !isApiMockMode ? summaryLoading : ordersLoading;
  const funnelError = !isApiMockMode ? summaryError : ordersError;
  // ── The counts, resolved BY LABEL through ORDER_COUNT_CONTRACT ─────────────
  // Every number below is `countFor("<the words the user reads>")`, the same call the
  // inbox chips make. It replaces four hand-written status sums, one of which — "Ready
  // to send" over `ready + ready_to_deliver` — meant something different from the same
  // three words in the inbox, so an operator read 12 here and could not find 12 there.
  // orderCountParity.test.tsx renders both screens against one fixture to keep it fixed.
  const contractCount = (label: string) =>
    !isApiMockMode
      ? countFor(label, byStatus as Partial<Record<OrderStatus, number>>, ordersSummary?.total)
      : countInWorkingSet(label, allOrders);
  const countBlocked = contractCount("Needs review");
  // `ready` ONLY. It used to include ready_to_deliver, which is the next line's number.
  const countReady = contractCount("Ready to send");
  // The status that used to be summed into the line above, now printed under its own
  // (already shipped) name — the same words the inbox chip and the row badge use.
  const countQueued = contractCount("Queued to send");
  const countDelivered = contractCount("Delivered");
  const countFailed = contractCount("Failed");
  const countReceived = contractCount("Received");

  // ── The two populations, resolved ONCE ────────────────────────────────────
  //
  // `countReceived` comes from GET /api/orders/summary, which excludes practice orders,
  // while the windowed cards below read GET /api/orders, which includes them. Printing
  // both raw is the v2 audit's P0-5: "Received 0" beside a card reading "1 orders
  // received", with the order listed under both. The cards now print `.metered` — the
  // same population as the tile — and `practiceOrderNote` states what that leaves out.
  // `.rows` stays for anything that is genuinely about ROWS (the export's contents, the
  // 100-order working-set cap), which is a different question with a different answer.
  const receivedPopulation = pagePopulation(windowedReceivedPage);
  const deliveredPopulation = pagePopulation(windowedDeliveredPage);
  const allTimePopulation = summaryPopulation(ordersSummary);

  // ── Windowed rail metrics — real counts, honestly labelled. Feed the health
  // rail (throughput + auto-processed) and the export/window controls. ──────
  const windowSub = WINDOWS.find((w) => w.key === windowKey)!.sub;

  const eligibleInWindow = windowedOrders.filter((o) => ELIGIBLE_STATUSES.has(o.status));
  const autoCount = eligibleInWindow.filter((o) => (o.unresolvedCount ?? 0) === 0).length;
  const autoPct = eligibleInWindow.length > 0 ? Math.round((100 * autoCount) / eligibleInWindow.length) : 0;

  // Auto-processed % is sampled over the loaded working set (capped at the
  // 100-order page), whereas "orders received" shows the true windowed total.
  // When the true total exceeds the loaded sample, the two numbers compute on
  // different bases — say so (autoSampled).
  //
  // `.rows` and not `.metered`: this asks whether the page HELD BACK rows, and a
  // practice order takes a slot like any other. Comparing a metered count against a
  // row count would under-report truncation by exactly the practice population.
  const autoSampled = !isApiMockMode && receivedPopulation.rows > allOrders.length;

  // The exception count is only trustworthy once its source query has settled —
  // never flash an amber strip off a loading/error state (honest zero-state =
  // no banner at all).
  const exceptionsCountReliable = !isApiMockMode
    ? !summaryLoading && !summaryError
    : !ordersLoading && !ordersError;
  const showExceptionStrip = exceptionsCountReliable && openExceptionsAll > 0;

  // ── In-transit rows (current pipeline activity) ───────────────────────────
  // Capped to keep the card compact — each row is a two-line entry with a
  // mini-stepper, so an unbounded list made the dashboard very tall. We show
  // the first IN_TRANSIT_MAX and link the rest to the Inbox (honest — nothing
  // is hidden, just paged).
  const IN_TRANSIT_MAX = 6;
  const inTransitAll = (() => {
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
        isSample: o.isSample === true,
      }));
    if (isApiMockMode && liveRows.length === 0) {
      return IN_TRANSIT_MOCK_FALLBACK.map((r) => ({ ...r, id: undefined as string | undefined, isSample: false }));
    }
    return liveRows;
  })();
  const inTransitRows = inTransitAll.slice(0, IN_TRANSIT_MAX);

  // ── "Needs you" rows — the actionable hero (real orders in an open state) ──
  // Built from the same live working set as the KPIs. An order needs a human when it's
  // awaiting review, failed, was rejected, or is paused/parked — EXCEPTION_STATUSES, the
  // broader grouping. These rows render right here from orders we already hold, so
  // (unlike the amber strip's count) they don't depend on a backend exception row
  // existing, and a delivery_held order genuinely belongs in the list. We surface a plain
  // "what's needed" line derived from the actual status + unresolved count, never
  // a fabricated reason. Blocked (needs-review) rows sort first, then oldest-first.
  const neededFor = neededForOrder;
  const needsYouAll = allOrders
    .filter((o) => EXCEPTION_STATUSES.has(o.status) || (o.unresolvedCount ?? 0) > 0)
    .sort((a, b) => {
      // Needs-review first (the primary blocker), then oldest (createdAt asc).
      const ap = a.status === "pending_review" ? 0 : 1;
      const bp = b.status === "pending_review" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const needsYouRows = needsYouAll.slice(0, 6);
  // ONE blockers number feeds both the context line and the "Needs you" section
  // head, so the two can never drift. null until the source query has actually
  // SETTLED WITH DATA — the context line hides the segment rather than flashing
  // "All clear" or a 0. "!isLoading" alone is NOT settlement: a Clerk cold-mount
  // disabled query reports isLoading=false with no data in TanStack v5
  // (enabled:false never enters loading), so it must also require queryEnabled
  // and a real ordersPage before trusting needsYouAll.length.
  const blockersCount =
    queryEnabled && ordersPage !== undefined && !ordersLoading && !ordersError
      ? needsYouAll.length
      : null;

  // ── "Ready to send" rows — validated orders with nothing blocking ─────────
  //
  // The NUMBER is countReady — `countFor("Ready to send")`, the same call the stat
  // tile and the inbox chip make. It used to be `allOrders.filter(...).length` over
  // `ready || ready_to_deliver`, which put the removed sum back under the removed
  // label two inches below the tile that had been fixed: one screen, one label, two
  // numbers. ORDER_COUNT_CONTRACT:85 settles which one is right — "Ready to send" is
  // `ready` alone, because `ready` is the HUMAN's turn (validated, nothing built
  // yet) and this section's whole job is to ask a human to send. `ready_to_deliver`
  // is ours, and it is already printed beside this one as "Queued to send".
  //
  // The rows below are a SAMPLE for the preview chips, not the count: they come from
  // the loaded working set (capped at one page) while countReady comes from the
  // account-wide summary. Deriving the count from the sample was a second, quieter
  // divergence of the same label — an account with more ready orders than fit on a
  // page printed a smaller number here than in the tile above.
  const readySampleRows = allOrders.filter((o) => o.status === "ready");
  const readyChips = readySampleRows.slice(0, 3);
  // Loading state follows countReady's SOURCE (summary when authed, working set in
  // mock mode), not the orders query, or the section flashes a number from one base
  // while the tiles are still resolving another.
  const readyCountLoading = funnelLoading;

  // Money formatting for the ready-to-send preview chips (locale-aware, honest —
  // omitted when the order carries no total).
  const fmtMoney = (o: OrderSummary): string | null => {
    if (o.totalValue == null) return null;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: o.currency || "EUR",
        maximumFractionDigits: 2,
      }).format(o.totalValue);
    } catch {
      return `${o.totalValue.toFixed(2)} ${o.currency ?? ""}`.trim();
    }
  };

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
    // ROWS, not metered: the note describes how much of the FILE is missing, and the
    // export writes practice orders out like any other row.
    const windowTotal = receivedPopulation.rows;
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

  /** Topology hero area, in branch order: skeleton while loading, then one
   *  explicit failure card per failed source (orders, then topology), then the
   *  true empty-state — which is reachable ONLY on a success with zero rows —
   *  otherwise the live WireTopology canvas. Every failure before the empty
   *  state, always: the operator has to be able to tell "nothing is in flight"
   *  from "we could not load this", and an empty diagram reads as the first. */
  function renderTopologyArea(height: number) {
    if (topologyLoadingState) {
      return (
        <div
          className="animate-pulse rounded-card"
          style={{ height, background: "#F1F3F7", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
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
          style={{ height, background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)", padding: 24 }}
          role="alert"
        >
          <div className="text-[16px] font-semibold" style={{ color: "#0B1A2F" }}>Couldn&apos;t load your topology</div>
          <div className="mt-1 max-w-[420px] text-[13px]" style={{ color: "#5E6779" }}>
            We hit a problem fetching your live order view. Your connections are safe — this is a temporary loading error.
          </div>
          <button
            type="button"
            onClick={() => refetchOrders()}
            className="mt-4 inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#F6F7FA]"
            style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            Retry
          </button>
        </div>
      );
    }
    // The SAME rule as the branch above, applied to the other query that feeds
    // this canvas. `endpoint` is built from `topology?.buyers ?? []` (and the two
    // beside it), so a failed GET /api/dashboard/topology arrives here as an
    // empty collection — identical, byte for byte, to a successful fetch that
    // found nothing. `endpointHasData` then reads false and the empty state below
    // invites an established org to "upload your first PO". That is the dashboard
    // saying "all quiet" when what happened is "we could not ask".
    //
    // The guard is deliberately NOT a bare `if (topologyError)`. When the orders
    // query succeeded we still have `derived` — the client-side topology built
    // from the working set — and that is the designed fallback for exactly this
    // situation (see the `effective` ladder above). Replacing a canvas full of
    // real, honestly-sourced wires with an error card because a preferred source
    // was unavailable would lose the operator more information than it gains.
    //
    // So the failure is announced only where it would otherwise be swallowed:
    // the endpoint failed AND there is nothing to draw in its place. Retry is
    // bound to this query's own refetch, not refetchOrders — the branch above
    // owns the orders query, and a Retry that re-runs a request that never failed
    // is the button that does nothing.
    if (topologyError && !derivedHasData) {
      return (
        <div
          className="flex flex-col items-center justify-center rounded-card text-center"
          style={{ height, background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)", padding: 24 }}
          role="alert"
        >
          <div className="text-[16px] font-semibold" style={{ color: "#0B1A2F" }}>Couldn&apos;t load your connections</div>
          <div className="mt-1 max-w-[420px] text-[13px]" style={{ color: "#5E6779" }}>
            We couldn&apos;t reach the service that draws your buyer-to-{nounLower} map. Your orders and {pluralLower} are safe — nothing here has changed.
          </div>
          <button
            type="button"
            onClick={() => refetchTopology()}
            className="mt-4 inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#F6F7FA]"
            style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            Retry
          </button>
        </div>
      );
    }
    // Reached only on a SUCCESSFUL fetch that found nothing (both sources agree
    // there is nothing to draw). Unchanged — this is the genuine first-run state.
    if (topologyIsEmpty) {
      return (
        <div
          className="flex flex-col items-center justify-center rounded-card text-center"
          style={{ height, background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)", padding: 24 }}
        >
          <div className="text-[16px] font-semibold" style={{ color: "#0B1A2F" }}>No deliveries yet</div>
          <div className="mt-1 max-w-[420px] text-[13px]" style={{ color: "#5E6779" }}>
            Add a {nounLower} and upload your first PO — your {labels.railHeader.toLowerCase()} connections appear here.
          </div>
          <Link
            href="/library/suppliers"
            className="mt-4 inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#F6F7FA]"
            style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
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
            <div key={i} className="animate-pulse rounded-[10px]" style={{ height: 104, background: "#F1F3F7", border: "1px solid #E5E8EE" }} />
          ))}
        </div>
      );
    }
    if (funnelError) {
      return (
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center" role="alert">
          <div className="text-[15px] font-semibold" style={{ color: "#0B1A2F" }}>Couldn&apos;t load your pipeline</div>
          <div className="mt-1 max-w-[420px] text-[13px]" style={{ color: "#5E6779" }}>
            We hit a problem fetching your live order counts. This is a temporary loading error.
          </div>
          <button
            type="button"
            onClick={() => refetchOrders()}
            className="mt-4 inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#F6F7FA]"
            style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            Retry
          </button>
        </div>
      );
    }
    // v2 pipeline: a quiet stat row (dot + label + big number, hairline dividers)
    // over ONE honest proportion bar. Each stat opens the inbox; the bar shows the
    // relative share of Needs review / Ready / Delivered / Failed within the
    // post-intake population — the "of N received" caption keeps it truthful.
    // Every `label` here is an ORDER_COUNT_CONTRACT label, and `href` points at the
    // inbox chip that prints THE SAME NUMBER. Both matter: the tiles used to link to a
    // bare /inbox, so clicking "Ready to send · 12" landed on an unfiltered queue where
    // no 12 existed. Now the number you click is the number you land on.
    const statRow = [
      { key: "received",  label: "Received",       value: countReceived,  color: BLUE,       href: "/inbox" },
      { key: "review",    label: "Needs review",   value: countBlocked,   color: AMBER,      href: "/inbox?status=pending_review" },
      { key: "ready",     label: "Ready to send",  value: countReady,     color: GREEN_DEEP, href: "/inbox?status=ready" },
      { key: "queued",    label: "Queued to send", value: countQueued,    color: BLUE_DEEP,  href: "/inbox?status=ready_to_deliver" },
      { key: "delivered", label: "Delivered",      value: countDelivered, color: GREEN,      href: "/inbox?status=delivered" },
    ];
    // "Ready" was a THIRD name for the ready+ready_to_deliver sum. Split under the two
    // labels the rest of the product already uses, so the bar and the stat row above it
    // cannot disagree either.
    const segs = [
      { label: "Needs review",   value: countBlocked,   color: AMBER },
      { label: "Ready to send",  value: countReady,     color: GREEN_DEEP },
      { label: "Queued to send", value: countQueued,    color: BLUE },
      { label: "Delivered",      value: countDelivered, color: GREEN },
      { label: "Failed",         value: countFailed,    color: "#B43838" },
    ];
    const segTotal = Math.max(1, segs.reduce((a, s) => a + s.value, 0));
    return (
      <div>
        {/* Stat row — 5 cells since "Ready to send" and "Queued to send" are two
            numbers, not one ambiguous sum.

            The dividers are grid GAPS showing the container's colour through, not a
            per-cell `border-l`. Five cells in a 2/3/5 grid wrap at two of the three
            breakpoints, and a left border — with or without `first:border-l-0`, which only
            ever exempts cell 1 — draws a stray hairline at the start of every wrapped row.
            The previous `i % 4 !== 0` had the same defect one column count out. A gap has
            no index to get wrong: it appears between cells and never at a track edge, in
            both axes, at every breakpoint. */}
        <div className="grid grid-cols-2 gap-px bg-[#EEF0F4] sm:grid-cols-3 lg:grid-cols-5">
          {statRow.map((s) => (
            <Link
              key={s.key}
              href={s.href}
              className="flex flex-col gap-1.5 bg-white px-[18px] py-3.5 no-underline transition-colors hover:bg-[#F6F7FA]"
            >
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: "#5E6779" }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "inline-block" }} />
                {s.label}
              </span>
              <span
                data-count-label={s.label}
                data-count-value={s.value}
                className="tabular-nums"
                style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontWeight: 800, fontSize: 30, lineHeight: 1, color: s.value === 0 ? "var(--ink-faint)" : "#0B1A2F" }}
              >
                {s.value.toLocaleString()}
              </span>
            </Link>
          ))}
        </div>
        {/* One honest proportion bar */}
        <div className="px-[18px] pb-4 pt-1">
          <div className="flex overflow-hidden rounded-md" style={{ height: 10, background: "#F1F3F7" }}>
            {segs
              .filter((s) => s.value > 0)
              .map((s) => (
                <div key={s.label} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / segTotal) * 100}%`, background: s.color }} />
              ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            {segs.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: s.value === 0 ? "var(--ink-faint)" : "#5E6779" }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: s.value === 0 ? "#CBD0DA" : s.color, display: "inline-block" }} />
                {s.label}{" "}
                <b
                  data-count-label={s.label}
                  data-count-value={s.value}
                  className="tabular-nums"
                  style={{ color: s.value === 0 ? "var(--ink-faint)" : "#0B1A2F" }}
                >
                  {s.value}
                </b>
              </span>
            ))}
            {/* The caption that qualifies the whole funnel, and therefore the right place
                to say what the funnel's "Received" excludes. Without it the tile's 0 sits
                directly above a "Needs you" list holding the practice order. */}
            <span className="ml-auto text-[11px]" style={{ color: "var(--ink-faint)" }}>
              of {countReceived.toLocaleString()} received · all time
              {practiceOrderNote(allTimePopulation.practice) && ` · ${practiceOrderNote(allTimePopulation.practice)}`}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 36px context line (founder-approved mock): the "Dashboard" topbar tab
          is the page name; this row says what the tab cannot — greeting, date,
          and the blockers count with a jump link. Pinned above the scroll area. */}
      <DashboardContextLine
        blockers={blockersCount}
        onJumpToBlockers={() =>
          document.getElementById("needs-you")?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      />
      <div className="min-h-0 flex-1">
    <PageShell variant="wide" className="flex flex-col">
      {/* Page header — titleHidden: the topbar tab already says "Dashboard"
          (sr-only h1 kept); the live meta line + window/export/new-order
          actions stay as a compact row at the top of the content. */}
      <PageHeader
          titleHidden
          title="Overview"
          sub={
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span
                aria-hidden
                style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block" }}
              />
              Live order view
              {/* On cold mount the counts are transiently 0 while the queries load —
                  show a muted placeholder instead of flashing "0 connections · 0 active". */}
              {isInitialLoading ? (
                <>
                  <span style={{ color: "#CBD0DA" }}>·</span>
                  <span style={{ color: "var(--ink-faint)" }}>Loading…</span>
                </>
              ) : (
                <>
                  <span style={{ color: "#CBD0DA" }}>·</span>
                  {wireCount} connection{wireCount === 1 ? "" : "s"}
                  <span style={{ color: "#CBD0DA" }}>·</span>
                  {/* "active {plural}" — this counts only docks currently carrying orders
                      (derived topology), NOT the full roster on the Suppliers page, so it
                      must not be labelled a bare "{N} suppliers" count.
                      The noun agrees with the count, as "connections" already did: a
                      one-supplier org read "1 active suppliers" in production. */}
                  {effective.suppliers.length} active{" "}
                  {effective.suppliers.length === 1 ? nounLower : pluralLower}
                </>
              )}
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
                  style={{ border: "1px solid #E5E8EE", background: "#FFFFFF" }}
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
                          color: active ? "#FFFFFF" : "#5E6779",
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
                    !isApiMockMode && receivedPopulation.rows > 100
                      ? `Export contains the most recent 100 of ${receivedPopulation.rows.toLocaleString()} orders in this window`
                      : windowedOrders.length === 0
                        ? "No orders in this window to export"
                        : "Download this window's orders as CSV"
                  }
                  className="flex min-h-[36px] items-center gap-2 rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[#FCFCFD]"
                  style={{
                    border: "1px solid #E5E8EE",
                    background: "#FFFFFF",
                    color: windowedOrders.length === 0 ? "var(--ink-faint)" : "#0B1A2F",
                    cursor: windowedOrders.length === 0 ? "not-allowed" : "pointer",
                    boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
                  }}
                >
                  <Download size={14} strokeWidth={2} aria-hidden />
                  Export report
                </button>
                {/* Single dominant primary CTA — the dashboard's one primary action
                    is starting a new order (the core Parse→Deliver entry). Filled
                    navy #0B1A2F (the app-wide primary-button convention), so the
                    secondary white "Export report" button and the neutral window
                    selector recede below it. */}
                <Link
                  href="/upload"
                  className="flex min-h-[36px] items-center gap-2 rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-semibold no-underline transition-opacity hover:opacity-90"
                  style={{ background: "#0B1A2F", color: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.12)" }}
                >
                  <ArrowUpRight size={14} strokeWidth={2.25} aria-hidden />
                  New order
                </Link>
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
            <p className="mb-4 text-[13px]" style={{ color: "#5E6779" }}>
              Your pipeline is ready. Create its first connection to start {direction === "inbound" ? "confirming orders from customers" : "routing orders to suppliers"}.
            </p>
            <OnboardingChecklist onResumeSetup={resumeWizard} />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 sm:gap-5">
          {/* ── Setup / onboarding strip (top) — the slim, receding finish-setup
              band. Self-nulls when loading/errored or once all 6 steps are done
              (shows a one-time completion card at 6/6, then graduates away). */}
          <OnboardingChecklist onResumeSetup={resumeWizard} />

          {/* ── Exception strip — founder-approved triage entry (batch 4B) ──
              Shown only when open exceptions exist AND the count's source query
              has settled; zero exceptions = no banner (honest zero-state). */}
          {showExceptionStrip && (
            <Link
              href="/operations/exceptions"
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-[10px] px-4 py-3 no-underline transition-shadow hover:shadow-md"
              style={{ border: "1px solid #F0D39A", borderLeft: "3px solid #B36D14", background: "#FFF8EA" }}
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold" style={{ color: "#7A4D0B" }}>
                <AlertTriangle size={15} strokeWidth={2.25} style={{ color: "#8A5310", flexShrink: 0 }} aria-hidden />
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
                style={{ border: "1px solid #E5E8EE", background: "#FFFFFF" }}
                role="tablist"
                aria-label="Dashboard view"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={heroTab === "funnel"}
                  onClick={() => setHeroTab("funnel")}
                  className="flex min-h-[28px] items-center gap-1.5 rounded-[6px] px-3 py-1 font-medium transition-colors"
                  style={{ background: heroTab === "funnel" ? "#0B1A2F" : "transparent", color: heroTab === "funnel" ? "#FFFFFF" : "#5E6779" }}
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
                  style={{ background: heroTab === "map" ? "#0B1A2F" : "transparent", color: heroTab === "map" ? "#FFFFFF" : "#5E6779" }}
                >
                  <Network size={13} strokeWidth={2.25} aria-hidden />
                  System map
                </button>
              </div>
            </div>

            {heroTab === "funnel" ? (
              <div
                className="relative overflow-hidden rounded-card"
                style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
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
                style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
              >
                {/* Cross-section accent — buyer side (blue) flows to supplier side (green). */}
                <div
                  aria-hidden
                  style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, #1E66C9 0%, ${GREEN} 70%)` }}
                />
                {/* Legend header — right-aligned key; connection counts live in the page title. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3.5 pb-2 text-[11.5px]" style={{ color: "#5E6779" }}>
                  <span className="flex items-center gap-1.5">
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1E66C9", display: "inline-block" }} />
                    Buyer
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block" }} />
                    {noun}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span style={{ width: 12, height: 2.5, borderRadius: 2, background: "#B36D14", display: "inline-block" }} />
                    At-risk connection
                  </span>

                  {openExceptionsAll > 0 && (
                    <Link
                      href="/operations/exceptions"
                      className="ml-auto inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[11.5px] font-semibold no-underline transition-opacity hover:opacity-80"
                      style={{ background: "#FAF1DD", color: "#8A5310" }}
                      title="Review issues"
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

          {activeLane && <LaneDrawer lane={activeLane} onClose={() => setActiveLane(null)} />}

          {/* ── Action-first split — left: what needs you + what's ready to
              send + what's moving; right: the health rail. On narrow screens
              the rail stacks below the action column. ─────────────────────── */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(300px,1fr)] xl:items-start xl:gap-5">
            {/* LEFT — action column */}
            <div className="flex flex-col gap-5">
              {/* ── Needs you — the actionable hero table ───────────────────
                  id="needs-you" is the context line's jump target. The count is
                  needsYouAll.length (not the 6-row render cap) so it always
                  equals the context line's blockers number. */}
              <section id="needs-you" aria-label="Orders that need you">
                <SectionHead
                  title="Needs you"
                  count={needsYouAll.length}
                  note="blocking — clear these to send"
                  actionHref="/operations/exceptions"
                  actionLabel="Open inbox"
                />
                <div className="overflow-hidden rounded-card" style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
                  {ordersLoading ? (
                    [0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3" style={i ? { borderTop: "1px solid #EEF0F4" } : undefined}>
                        <div className="h-7 w-7 flex-shrink-0 animate-pulse rounded-lg" style={{ background: "#E5E8EE" }} />
                        <div className="h-3 flex-1 animate-pulse rounded" style={{ background: "#E5E8EE" }} />
                        <div className="hidden h-3 w-40 animate-pulse rounded sm:block" style={{ background: "#E5E8EE" }} />
                        <div className="h-3 w-12 animate-pulse rounded" style={{ background: "#E5E8EE" }} />
                      </div>
                    ))
                  ) : ordersError ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-[12.5px]" style={{ color: "var(--ink-faint)" }} role="alert">
                      <span style={{ color: "#5E6779" }}>Couldn&apos;t load orders that need you.</span>
                      <button
                        type="button"
                        onClick={() => refetchOrders()}
                        className="inline-flex items-center gap-1 rounded-[6px] px-3 py-1 text-[12px] font-medium transition-colors hover:bg-[#F6F7FA]"
                        style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : needsYouRows.length === 0 ? (
                    <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
                      <CheckCircle2 size={22} strokeWidth={2} style={{ color: GREEN }} aria-hidden />
                      <div className="text-[13.5px] font-semibold" style={{ color: "#0B1A2F" }}>Nothing needs you right now</div>
                      <div className="max-w-[360px] text-[12.5px]" style={{ color: "var(--ink-faint)" }}>
                        Orders that need review or fixing will appear here.
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Column header */}
                      <div
                        className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_84px] gap-3.5 px-4 py-2.5 sm:grid"
                        style={{ background: "#F1F3F7", borderBottom: "1px solid #E5E8EE" }}
                      >
                        {["Order", "Route", "What's needed", ""].map((h, i) => (
                          <span key={i} className="text-[9.5px] font-bold uppercase" style={{ letterSpacing: "0.07em", color: "#5E6779" }}>{h}</span>
                        ))}
                      </div>
                      {needsYouRows.map((o, i) => (
                        <Link
                          key={o.id}
                          href={`/inbox/${o.id}`}
                          className="grid grid-cols-1 items-center gap-x-3.5 gap-y-1.5 px-4 py-3 no-underline transition-colors hover:bg-[#F6F7FA] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_84px] sm:py-2.5"
                          style={i ? { borderTop: "1px solid #EEF0F4" } : undefined}
                        >
                          {/* Order — amber dot + buyer avatar + PO */}
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: AMBER, flexShrink: 0 }} />
                            <Avatar name={o.buyerName ?? o.poNumber} tone="buyer" size={26} />
                            <span className="truncate font-mono text-[12.5px] font-semibold" style={{ color: "#0B1A2F" }}>{o.poNumber}</span>
                            {/* This list counts its own rows, so it is internally honest —
                                but it sits beside a "Received" tile that counts a smaller
                                population, and the badge is what stops the two reading as
                                a contradiction. */}
                            {o.isSample && <PracticeChip size="sm" />}
                          </div>
                          {/* Route — buyer → supplier */}
                          <div className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
                            <span className="truncate font-semibold" style={{ color: BLUE }}>{o.buyerName ?? "Unknown buyer"}</span>
                            <ArrowRight size={11} style={{ color: "var(--ink-faint)", flexShrink: 0 }} aria-hidden />
                            <span className="truncate font-semibold" style={{ color: GREEN_DEEP }}>{o.supplierName}</span>
                          </div>
                          {/* What's needed */}
                          <div className="flex min-w-0 items-center gap-1.5">
                            <AlertTriangle size={12} strokeWidth={2.25} style={{ color: AMBER, flexShrink: 0 }} aria-hidden />
                            <span className="truncate text-[12px]" style={{ color: "#0B1A2F" }}>{neededFor(o)}</span>
                          </div>
                          {/* Age + chevron */}
                          <div className="flex items-center gap-1.5 sm:justify-end">
                            <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>{ageFrom(o.createdAt)}</span>
                            <ChevronRight size={13} style={{ color: "var(--ink-faint)", flexShrink: 0 }} aria-hidden />
                          </div>
                        </Link>
                      ))}
                    </>
                  )}
                </div>
              </section>

              {/* ── Ready to send — compact, one CTA ──────────────────────── */}
              {(countReady > 0 || readyCountLoading) && (
                <section aria-label="Orders ready to send">
                  <SectionHead
                    title="Ready to send"
                    count={readyCountLoading ? undefined : countReady}
                    note="validated — nothing blocking"
                    // The FILTERED queue, not a bare /inbox. WP-29 pointed the stat
                    // tiles here so the number you click is the number you land on;
                    // this section still sent you to the unfiltered queue, where the
                    // figure above the link appears nowhere.
                    actionHref="/inbox?status=ready"
                    actionLabel="See all"
                  />
                  <div
                    className="flex flex-col gap-3 rounded-card px-4 py-4 sm:flex-row sm:items-center sm:gap-4"
                    style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
                  >
                    <span
                      className="inline-flex flex-shrink-0 items-center justify-center"
                      style={{ width: 38, height: 38, borderRadius: 10, background: GREEN_SOFT }}
                      aria-hidden
                    >
                      <CheckCircle2 size={20} strokeWidth={2} style={{ color: GREEN_DEEP }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold" style={{ color: "#0B1A2F" }}>
                        <span className="tabular-nums">{countReady}</span> order{countReady === 1 ? "" : "s"} validated and ready
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {readyChips.map((o) => (
                          <span
                            key={o.id}
                            className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2 text-[11px]"
                            style={{ background: "#F1F3F7", border: "1px solid #E5E8EE", color: "#5E6779" }}
                          >
                            <Avatar name={o.buyerName ?? o.poNumber} tone="buyer" size={16} />
                            <span className="font-mono">{o.poNumber}</span>
                            {fmtMoney(o) && <span className="tabular-nums" style={{ color: "var(--ink-faint)" }}>· {fmtMoney(o)}</span>}
                          </span>
                        ))}
                        {countReady > readyChips.length && (
                          <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>+{countReady - readyChips.length} more</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <Link
                        href="/inbox?status=ready"
                        className="inline-flex h-[36px] items-center justify-center rounded-[8px] px-3.5 text-[12.5px] font-semibold no-underline transition-colors hover:bg-[#F6F7FA]"
                        style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
                      >
                        Review
                      </Link>
                      <Link
                        href="/inbox?status=ready"
                        className="inline-flex h-[36px] items-center justify-center gap-1.5 rounded-[8px] px-3.5 text-[12.5px] font-semibold text-white no-underline transition-colors"
                        style={{ background: GREEN_BTN, boxShadow: "0 1px 2px rgba(11,26,47,0.12)" }}
                      >
                        <Send size={13} strokeWidth={2.25} aria-hidden />
                        Review &amp; send
                      </Link>
                    </div>
                  </div>
                </section>
              )}

              {/* ── In transit — current pipeline activity ────────────────── */}
              <div className="overflow-hidden rounded-card" style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
              <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid #E5E8EE" }}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <Send size={15} strokeWidth={2} style={{ color: "#5E6779", flexShrink: 0 }} aria-hidden />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>In transit</div>
                    <div className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>moving through the pipeline now</div>
                  </div>
                </div>
              </div>
              <div className="divide-y" style={{ borderColor: "#E5E8EE" }}>
                {ordersLoading ? (
                  [0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="h-3 flex-1 animate-pulse rounded" style={{ background: "#E5E8EE" }} />
                      <div className="h-3 w-16 animate-pulse rounded" style={{ background: "#E5E8EE" }} />
                      <div className="h-5 w-12 animate-pulse rounded" style={{ background: "#E5E8EE" }} />
                    </div>
                  ))
                ) : ordersError ? (
                  // Honest error state — never imply "nothing in flight" on a load failure.
                  <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[12.5px]" style={{ color: "var(--ink-faint)" }} role="alert">
                    <span style={{ color: "#5E6779" }}>Couldn&apos;t load in-transit orders.</span>
                    <button
                      type="button"
                      onClick={() => refetchOrders()}
                      className="inline-flex items-center gap-1 rounded-[6px] px-3 py-1 text-[12px] font-medium transition-colors hover:bg-[#F6F7FA]"
                      style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
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
                            {row.isSample && <PracticeChip size="sm" />}
                            <span className="max-w-full truncate text-[12px]" style={{ color: "#5E6779" }}>{row.buyer}</span>
                            <FileChip type={row.fmt} />
                          </div>
                          <span
                            className="flex-shrink-0 whitespace-nowrap text-[11px] font-semibold"
                            style={{ color: STAGE_COLOR[row.stage] ?? "#5E6779" }}
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
                {inTransitAll.length > IN_TRANSIT_MAX && (
                  <Link
                    href="/inbox"
                    className="flex items-center justify-center px-4 py-2.5 text-[12px] font-medium transition-colors hover:bg-[#F6F7FA]"
                    style={{ color: "#1E66C9" }}
                  >
                    See all {inTransitAll.length} in transit →
                  </Link>
                )}
              </div>
              </div>
            </div>

            {/* RIGHT — health rail (throughput · delivery · {plural} health) */}
            <div className="flex flex-col gap-4">
              {/* Throughput — windowed received count + last-7-days bars */}
              <div
                data-stat-card="throughput"
                data-stat-window={windowKey}
                className="rounded-card px-4 py-4"
                style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
              >
                <div className="mb-3.5 flex items-center gap-2">
                  <BarChart3 size={15} strokeWidth={2} style={{ color: "#5E6779", flexShrink: 0 }} aria-hidden />
                  <span className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Throughput</span>
                  <span className="ml-auto text-[11px]" style={{ color: "var(--ink-faint)" }}>{windowSub}</span>
                </div>
                {(() => {
                  const barMax = Math.max(1, ...weeklyBars);
                  return (
                    <div className="mb-3 flex items-end gap-1.5" style={{ height: 52 }}>
                      {weeklyBars.map((v, i) => (
                        <div key={i} className="flex flex-1 flex-col items-center">
                          <div
                            className="w-full rounded-[3px]"
                            style={{ height: `${(v / barMax) * 44 + 4}px`, background: i === weeklyBars.length - 1 ? BLUE : BLUE_SOFT }}
                            title={`${v} received`}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div className="flex items-baseline gap-2">
                  <span
                    className="tabular-nums"
                    style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontWeight: 800, fontSize: 22, color: "#0B1A2F" }}
                  >
                    {/* THE NUMBER FROM THE AUDIT. It read `windowedReceivedPage.totalCount`
                        — every row, practice included — while the "Received" tile two cards
                        up read the metered total, so a first-run org saw 1 here and 0 there
                        with one order on the screen. Both are the metered population now,
                        and the practice line below says what that leaves out. */}
                    {ordersLoading ? "…" : ordersError ? "—" : (windowedReceivedPage ? receivedPopulation.metered : windowedOrders.length).toLocaleString()}
                  </span>
                  <span className="text-[12px]" style={{ color: "#5E6779" }}>orders received · {windowSub.toLowerCase()}</span>
                </div>
                {/* Shown only when there is something to explain, so a workspace with no
                    practice orders renders exactly what it always did. */}
                {!ordersLoading && !ordersError && practiceOrderNote(receivedPopulation.practice) && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "#2E8E3A", flexShrink: 0 }} />
                    <span>{practiceOrderNote(receivedPopulation.practice)}</span>
                  </div>
                )}
                {/* Delivered in the same window (from the dedicated windowed count query). */}
                <div className="mt-1 flex items-center gap-1.5 text-[11.5px]" style={{ color: "#5E6779" }}>
                  <CheckCircle2 size={12} strokeWidth={2.25} style={{ color: GREEN_DEEP, flexShrink: 0 }} aria-hidden />
                  <span className="tabular-nums font-semibold" style={{ color: GREEN_DEEP }}>
                    {/* Metered for the same reason as the line above: a delivered practice
                        order is a rehearsal, not throughput, and the "Delivered" tile does
                        not count it either. */}
                    {ordersLoading ? "…" : ordersError ? "—" : (windowedDeliveredPage ? deliveredPopulation.metered : windowedOrders.filter((o) => o.status === "delivered").length).toLocaleString()}
                  </span>
                  <span>delivered · {windowSub.toLowerCase()}</span>
                </div>
                {/* Auto-processed line — sampled over completed orders, honestly qualified. */}
                <div className="mt-2.5 flex items-center gap-1.5 border-t pt-2.5 text-[11.5px]" style={{ borderColor: "#EEF0F4", color: "#5E6779" }}>
                  {eligibleInWindow.length >= 3 ? (
                    <>
                      <CheckCircle2 size={13} strokeWidth={2.25} style={{ color: GREEN_DEEP, flexShrink: 0 }} aria-hidden />
                      <span className="tabular-nums font-semibold" style={{ color: GREEN_DEEP }}>{autoPct}%</span>
                      <span>auto-processed · {autoCount} of {eligibleInWindow.length} completed{autoSampled ? " (latest 100)" : ""}</span>
                    </>
                  ) : (
                    <>
                      <Clock size={13} strokeWidth={2.25} style={{ color: "var(--ink-faint)", flexShrink: 0 }} aria-hidden />
                      <span>Auto-processed rate needs 3+ completed orders</span>
                    </>
                  )}
                </div>
              </div>

              {/* Delivery — delivered vs failed, success rate.
                  ALL-TIME, and it says so. `getOrdersSummary()` sends no date parameter, so these
                  two numbers ignore the window selector above them — which is exactly why the
                  card has to name its own window rather than borrow its neighbours'. */}
              <div
                data-stat-card="delivery"
                data-stat-window="all"
                className="rounded-card px-4 py-4"
                style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
              >
                <div className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Delivery</div>
                <div className="mb-3 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                  Delivered vs failed, {STAT_WINDOW_TEXT.all}
                </div>
                {(() => {
                  const attempted = countDelivered + countFailed;
                  const ratePct = attempted > 0 ? Math.round((100 * countDelivered) / attempted) : null;
                  const rateStr = funnelLoading ? "…" : funnelError ? "—" : ratePct == null ? "—" : `${ratePct}%`;
                  const rateColor = ratePct == null ? "var(--ink-faint)" : ratePct >= 90 ? GREEN_DEEP : ratePct >= 80 ? AMBER : "#B43838";
                  const failedStr = funnelLoading ? "…" : funnelError ? "—" : countFailed.toLocaleString();
                  return (
                    <>
                      <div className="flex items-center gap-3.5">
                        <div className="flex-1">
                          <div
                            className="tabular-nums"
                            style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontWeight: 800, fontSize: 26, lineHeight: 1, color: rateColor }}
                          >
                            {rateStr}
                          </div>
                          <div className="mt-1 text-[11.5px]" style={{ color: "#5E6779" }}>success rate</div>
                        </div>
                        <div style={{ width: 1, height: 38, background: "#EEF0F4" }} />
                        <div className="flex-1">
                          <div
                            className="tabular-nums"
                            style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontWeight: 800, fontSize: 26, lineHeight: 1, color: countFailed > 0 ? "#B43838" : "#0B1A2F" }}
                          >
                            {failedStr}
                          </div>
                          <div className="mt-1 text-[11.5px]" style={{ color: "#5E6779" }}>failed</div>
                        </div>
                      </div>
                      {ratePct == null && !funnelLoading && !funnelError && (
                        <div className="mt-3 rounded-[9px] px-3 py-2 text-[11.5px]" style={{ background: BLUE_SOFT, color: BLUE_DEEP, lineHeight: 1.45 }}>
                          No deliveries yet — send your first order to start tracking delivery health.
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* {plural} health */}
              <div
                data-stat-card="supplier-health"
                data-stat-window={supplierHealthWindow}
                className="overflow-hidden rounded-card"
                style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
              >
              <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid #E5E8EE" }}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <Activity size={15} strokeWidth={2} style={{ color: "#5E6779", flexShrink: 0 }} aria-hidden />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>{noun} health</div>
                    {/* "Delivery success rate" (not "Acceptance rate"): this figure measures
                        successful pipeline delivery, not supplier acceptance. The window is
                        genuinely two different windows — DashboardController.GetTopology filters
                        supplier rows on `CreatedAt >= UtcNow.AddDays(-30)`, while the client
                        fallback derives from the working set with no cutoff — so it is printed
                        from `supplierHealthWindow`, the same value the card declares as data.
                        It used to print nothing at all on the fallback path, which left an
                        unlabelled percentage next to two labelled ones. */}
                    <div className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                      Delivery success rate, {STAT_WINDOW_TEXT[supplierHealthWindow]}
                    </div>
                  </div>
                </div>
                <Link
                  href="/library/suppliers"
                  className="inline-flex flex-shrink-0 items-center gap-1 text-[11.5px] font-medium transition-colors hover:text-[#1E6D29]"
                  style={{ color: "#5E6779" }}
                >
                  All {pluralLower} <ArrowRight size={12} />
                </Link>
              </div>
              <div className="divide-y" style={{ borderColor: "#EEF0F4" }}>
                {supplierHealthLoading && effective.suppliers.length === 0 ? (
                  // Cold-mount skeleton — never flash "No {plural} yet" while the
                  // suppliers/topology queries are still resolving on first load.
                  [0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2.5 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
                      <div className="h-3 flex-1 animate-pulse rounded" style={{ background: "#E5E8EE" }} />
                      <div className="hidden h-1.5 w-[160px] animate-pulse rounded-full sm:block" style={{ background: "#E5E8EE" }} />
                      <div className="h-3 w-[40px] animate-pulse rounded" style={{ background: "#E5E8EE" }} />
                    </div>
                  ))
                ) : effective.suppliers.length === 0 ? (
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
                          style={{ width: 160, height: 6, background: "#F1F3F7" }}
                        >
                          {/* No orders → no bar. An empty track reads as "nothing measured";
                              a full green one would read as a perfect record. */}
                          <div className="h-full rounded-full transition-all" style={{ width: `${s.health ?? 0}%`, background: color }} />
                        </div>
                        <span
                          className="w-[40px] flex-shrink-0 text-right text-[12px] font-bold tabular-nums"
                          style={{ color, fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {s.health === null ? "—" : `${s.health}%`}
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
      </div>
    </div>
  );
}
