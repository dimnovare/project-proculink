"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, HelpCircle, Lock, Menu, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiClient, checkAdminAccess, getBillingStatus, isApiMockMode } from "@/lib/api-client";
import { guideSeenKey, matchGuide } from "@/lib/section-guides";
import { planDisplayName } from "@/lib/plans";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrganization } from "@clerk/nextjs";
import type { Order, OrderSummary, Supplier } from "@/types/procurement";
import { buildCrumbTrail, formatCrumbLabel, isLonePageCrumb, truncateLabel, type Crumb, type CrumbContext } from "./breadcrumb";
import { CommandPalette } from "./CommandPalette";
import { ProcuLinkMark } from "./DSPrimitives";
import { HelpSlideover } from "./HelpSlideover";
import { HubTabs, hubForPath, hubShowsTabs, visibleHubTabs, type HubKey } from "./layout/HubTabs";
import { OrgSwitcher } from "./OrgSwitcher";
import { SetupProgressChip } from "./SetupProgressChip";
import { statusLabel } from "./UnifiedStatusBadge";
import { UserChipMenu } from "./UserChipMenu";
import {
  buildVisibleNav,
  hubTooltip,
  isItemActive,
  NAV_BADGE_UNKNOWN_LABEL,
  PINNED_ACTION_HREF,
  type NavBadge,
  type SidebarNavItem,
} from "./BridgeSidebar";

interface BridgeTopbarProps {
  crumb?: ReactNode;
  onMenuClick?: () => void;
}

/**
 * Resolve human names for dynamic path segments from the EXISTING query cache —
 * no new fetch. The detail pages already load these via useQuery, so we read
 * the cached entries by their stable keys:
 *   • order  → ["order", orderId]              (Order.poNumber)
 *   • supplier → ["suppliers"] list            (find by id → Supplier.name)
 *   • connection → ["connection", connectionId] (ConnectionDetail.name)
 */
function useCrumbContext(segments: string[]): CrumbContext {
  const qc = useQueryClient();
  const ctx: CrumbContext = {};

  // /inbox/[orderId]
  const orderId = (segments[0] === "inbox" && segments[1]) || null;
  if (orderId) {
    const order = qc.getQueryData<Order>(["order", orderId]);
    ctx.orderPoNumber = order?.poNumber ?? null;
  }

  // /connections/[connectionId]
  if (segments[0] === "connections" && segments[1]) {
    const connection = qc.getQueryData<{ name?: string }>(["connection", segments[1]]);
    ctx.connectionName = connection?.name ?? null;
  }

  // /library/suppliers/[id]
  if (segments[0] === "library" && segments[1] === "suppliers" && segments[2]) {
    const suppliers = qc.getQueryData<Supplier[]>(["suppliers"]);
    ctx.supplierName = suppliers?.find((s) => s.id === segments[2])?.name ?? null;
  }

  return ctx;
}

/**
 * Derive the full breadcrumb trail from the current pathname. Every crumb except
 * the current page links to its cumulative path; dynamic detail segments resolve
 * to a readable label (PO number / supplier / connection name) from the query
 * cache, falling back to a noun + short id — never a bare full UUID.
 */
function useAutoCrumb(): ReactNode {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const ctx = useCrumbContext(segments);

  if (segments.length === 0) return null;

  const trail = buildCrumbTrail(pathname, ctx);

  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
      {trail.map((crumb, i) => {
        const isLast = i === trail.length - 1;
        const display = truncateLabel(crumb.label);
        return (
          <span key={`${crumb.href ?? "current"}-${i}`} style={{ display: "inline-flex", alignItems: "center", minWidth: 0 }}>
            {i > 0 && <span aria-hidden style={{ color: "#3A547A", margin: "0 3px", flexShrink: 0 }}>/</span>}
            {crumb.href ? (
              <Link
                href={crumb.href}
                title={crumb.label}
                className="truncate transition-colors hover:underline"
                style={{ color: "#7C8DA6", maxWidth: 220 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#C8D1E0"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#7C8DA6"; }}
              >
                {display}
              </Link>
            ) : (
              // Unlinked crumb: the CURRENT page (last) — or an unrouted group
              // head like "Workbench", which is context, not the current page.
              <span
                aria-current={isLast ? "page" : undefined}
                title={crumb.label}
                className="truncate"
                style={{ color: isLast ? "#C8D1E0" : "#7C8DA6", fontWeight: isLast ? 500 : 400, maxWidth: 260 }}
              >
                {display}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ─── Hub navigation in the context row ──────────────────────────────────────
// Founder direction: the hub section tabs (Suppliers | Item codes | Rules …)
// live in the TOPBAR, not under each page's header. On any route that belongs
// to a hub (hubForPath), row 2 swaps the breadcrumb TAIL for the hub's tab bar:
//   /library/suppliers      → [Suppliers* | Item codes | Rules | Output layouts]
//   /library/suppliers/[id] → [tabs] / Acme GmbH
//   /operations/health      → [Overview | Deliveries | Issues] / System status
// Non-hub routes keep the plain breadcrumb untouched.
//
// WP-26: the row no longer leads with the hub's own name. The hub word is now a
// top-level nav item that is visibly active in the row directly above (Orders /
// Suppliers / Activity), so printing it again — and then printing it a third
// time as the active tab, which "Orders / [Orders*]" did — is the double-navbar
// the founder reported, not navigation.

interface HubRow {
  hub: HubKey;
  /** Linked crumbs ABOVE the active tab. Usually empty; kept for deeper trees. */
  prefix: Crumb[];
  /** Crumbs BELOW the active tab (detail pages) — rendered after the tabs. */
  tail: Crumb[];
}

function useHubRow(): HubRow | null {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const ctx = useCrumbContext(segments);
  const hub = hubForPath(pathname);
  // A hub with a single VISIBLE tab gets no strip (hubShowsTabs) — and therefore
  // no hub row at all; the route falls back to the plain breadcrumb below.
  if (!hub || !hubShowsTabs(hub)) return null;

  // The LONGEST VISIBLE tab route (href or match alias) that owns the current
  // path — its depth marks where the prefix ends and the detail tail begins.
  // HIDDEN entries are deliberately excluded: their page is not on the strip, so
  // no tab can be current, and the page reads as a detail page OF the hub —
  // "[Overview | Deliveries | Issues] / System status" rather than a strip with
  // nothing active and the page unnamed.
  let owner = "";
  for (const t of visibleHubTabs(hub)) {
    for (const route of [t.href, ...(t.match ?? [])]) {
      if ((pathname === route || pathname.startsWith(route + "/")) && route.length > owner.length) {
        owner = route;
      }
    }
  }
  const trail = buildCrumbTrail(pathname, ctx);
  // buildCrumbTrail may prepend an unrouted group-head crumb ("Workbench") that
  // has no path segment — offset keeps crumb indexes aligned with segments.
  const offset = trail.length - segments.length;
  if (!owner) {
    // Off-strip route: the whole trail is the tail, minus any leading unlinked
    // group-root crumb ("Library" / "Operations" / "Workbench"), which links to a
    // 404 and is exactly the container word this restructure retired.
    let tail = trail;
    while (tail.length > 1 && tail[0].href === null) tail = tail.slice(1);
    return { hub, prefix: [], tail };
  }
  const ownerDepth = owner.split("/").filter(Boolean).length;
  const rawPrefix = trail.slice(0, offset + ownerDepth - 1);
  // Drop a leading unlinked group-root crumb for the same reason: it names a
  // route group, not a place, and it points at nothing.
  const prefix = rawPrefix.length > 0 && rawPrefix[0].href === null ? rawPrefix.slice(1) : rawPrefix;
  return { hub, prefix, tail: trail.slice(offset + ownerDepth) };
}

/** One breadcrumb piece in the hub row — same visual language as useAutoCrumb. */
function HubRowCrumb({ crumb, isCurrent }: { crumb: Crumb; isCurrent: boolean }) {
  const display = truncateLabel(crumb.label);
  if (crumb.href) {
    return (
      <Link
        href={crumb.href}
        title={crumb.label}
        className="truncate transition-colors hover:underline"
        style={{ color: "#7C8DA6", maxWidth: 220 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#C8D1E0"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#7C8DA6"; }}
      >
        {display}
      </Link>
    );
  }
  // Unlinked crumb — the current detail page, or an unrouted group head.
  // aria-current stays on the active hub TAB (one per row), so none here.
  return (
    <span
      title={crumb.label}
      className="truncate"
      style={{ color: isCurrent ? "#C8D1E0" : "#7C8DA6", fontWeight: isCurrent ? 500 : 400, maxWidth: 260 }}
    >
      {display}
    </span>
  );
}

function HubRowSeparator() {
  return <span aria-hidden style={{ color: "#3A547A", margin: "0 7px", flexShrink: 0 }}>/</span>;
}

/**
 * Compact page label for the mobile topbar — the LAST crumb segment as a plain
 * string, resolved through the SAME formatCrumbLabel rules as the desktop trail
 * (so a detail page shows its PO number / supplier / connection name, and never
 * a raw id). Truncated for the narrow mobile bar.
 */
function useMobilePageLabel(): string | null {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const ctx = useCrumbContext(segments);

  if (segments.length === 0) return null;

  const lastIdx = segments.length - 1;
  return truncateLabel(formatCrumbLabel(segments[lastIdx], lastIdx, segments, ctx), 32);
}

// ─── Notifications popover ──────────────────────────────────────────────────
// Live, honest notifications derived from the order queue: needs-review and
// failed orders are actionable (drive the unread count); delivered are activity.
// No fake unread dot — the badge only appears when something genuinely needs action.

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Status dot colors use the canonical semantic tokens (danger/amber/brand-green)
// rather than literal hex, so they stay in sync with UnifiedStatusBadge.
type NotifKind = "review" | "failed" | "delivered" | "held" | "unconfirmed" | "unrouted";

// The KIND decides the dot colour and the sort rank only. It deliberately no
// longer carries a label: `failed` folds five different statuses, so one label
// for the bucket meant a `transform_failed` order and a `rejected_by_supplier`
// order both announced themselves as "Delivery failed" — two notifications
// naming a delivery that never happened. Each row now reads statusLabel(status)
// from STATUS_META, so it says which of the five it actually is.
const NOTIF_META: Record<NotifKind, { dot: string }> = {
  failed:      { dot: "var(--danger)" },
  // Billing hold: amber (needs a human) rather than red — nothing failed.
  held:        { dot: "var(--amber)" },
  // Parked: a crash lost the outcome after we sent. Amber like `held` — needs a
  // human, but we can't confirm a failure, so it is never a red row.
  unconfirmed: { dot: "var(--amber)" },
  // The third parked state, finally joining the two above it: no supplier was
  // resolved, so the order stops and nothing automatic will ever restart it.
  // Amber like `held`/`unconfirmed` — a backlog waiting on a person, not a fault.
  unrouted:    { dot: "var(--amber)" },
  review:      { dot: "var(--amber)" },
  delivered:   { dot: "var(--brand-green)" },
};

/**
 * Which notification an order earns, or null for "does not notify".
 *
 * ORDER MATTERS, and every arm above `review` is there because of the same bug:
 * a stopped order that also carries unresolved lines gets relabelled "Needs
 * review", which describes the wrong problem and hides the real one. `held` and
 * `unconfirmed` were moved above it for that reason; `unrouted` is the third and
 * was left behind, with the reasoning for the other two written directly above
 * it. Until then it matched nothing, got no kind, and was dropped by the caller's
 * filter — so the one hold a user can clear entirely by themselves was the one
 * hold the bell never mentioned. For `unrouted` the masking is certain rather
 * than merely possible: an unrouted order always has lines.
 *
 * Module scope and exported so `src/test/failureRecoveryCoverage.test.ts` can walk
 * every status the backend machine knows and assert that a stopped order always
 * earns a notification. Inline in the render map it was untestable, which is why
 * one status could sit unclassified through two packets that touched this file.
 */
export function notifKindFor(status: string, unresolvedCount?: number | null): NotifKind | null {
  if (
    status === "failed" ||
    status === "delivery_failed" ||
    status === "transform_failed" ||
    status === "delivery_dead_letter" ||
    status === "rejected_by_supplier"
  ) return "failed";
  if (status === "delivery_held") return "held";
  if (status === "delivery_unconfirmed") return "unconfirmed";
  if (status === "unrouted") return "unrouted";
  if (status === "pending_review" || (unresolvedCount ?? 0) > 0) return "review";
  if (status === "delivered") return "delivered";
  return null;
}

/**
 * How many of the newest orders the panel scans, and how many rows it lists.
 *
 * These two numbers are why the empty state below is not a bare "No new activity."
 * The row list is built from `GET /api/orders?pageSize=100`, which the backend
 * returns newest-first (`OrderQueryService.ListWindowAsync`,
 * `OrderByDescending(o => o.CreatedAt)`), and then capped at seven. But `unread`
 * is summed from `GET /api/orders/summary`, which counts the WHOLE account. An
 * order that is failed, held or unrouted but older than the newest hundred
 * therefore raises the badge and the header while having no row to render — and
 * the panel used to answer that state with "No new activity.", i.e. it told the
 * operator nothing needed doing on the same 40 pixels where it had just said
 * twelve things did. The gap between the two numbers is structural and fine; the
 * claim of emptiness on top of it is not.
 */
const NOTIF_SCAN_PAGE_SIZE = 100;
const NOTIF_ROW_LIMIT = 7;

/**
 * The bell's corner chip, shared by the count badge and the "count unknown"
 * badge so the two can never diverge in size or position.
 *
 * #8A5310 not --amber: this badge carries a NUMERAL, so it is text at 9.5px/700.
 * White on --amber is 4.1061:1; on #8A5310 it is 6.3150:1. --amber stays correct
 * for the dot forms elsewhere, which are non-text and only need 3:1.
 */
const NOTIF_BADGE_STYLE: React.CSSProperties = {
  top: 4,
  right: 4,
  minWidth: 15,
  height: 15,
  padding: "0 3.5px",
  borderRadius: 8,
  background: "#8A5310",
  color: "#FFFFFF",
  fontSize: 9.5,
  fontWeight: 700,
  border: "1.5px solid #0B1A2F",
  lineHeight: 1,
};

/**
 * Copy for the notifications panel when it has no rows to show. Kept as one
 * function so the four cases are decided in one place and cannot drift apart:
 *
 *   failed     → the query did not answer. See the paragraph below.
 *   loading    → say so. Neither query has answered, so "nothing needs action"
 *                is a claim about data we have not received.
 *   unread = 0 → genuinely nothing. The original copy, unchanged.
 *   unread > 0 → the reach case. Orders need action; none is recent enough to
 *                list. Name that, and point at the inbox — which is also what
 *                the panel's own footer button does.
 *
 * `failed` is the fourth case and it was missing for the whole life of this
 * function. Neither query had an `isError` branch, so a failed
 * `GET /api/orders/summary` left `unread` at the `?? 0` default: the bell badge
 * vanished, both nav badges read zero, and this panel — the app's ONLY
 * always-visible "is anything wrong?" affordance — answered with the sentence
 * that means "we checked the whole account and it is clean". A check that did
 * not run is not a check that passed. `failed` is tested FIRST because an
 * errored query is not loading and its `unread` is not a number we received.
 *
 * The sibling surface already got this right: BridgeDashboard branches on its
 * own `summaryError` and prints "—" rather than a fabricated zero, so the
 * dashboard showed dashes while the chrome directly above it showed all-clear.
 */
export function notificationsEmptyMessage(unread: number, loading: boolean, failed: boolean): string {
  if (failed) return "We couldn't check for new activity.";
  if (loading) return "Checking for new activity…";
  if (unread <= 0) return "No new activity.";
  return unread === 1
    ? "1 order needs action, but it's older than the recent activity shown here — open the inbox to see it."
    : `${unread} orders need action, but they're older than the recent activity shown here — open the inbox to see them.`;
}

/**
 * Exported for `BridgeTopbar.notificationsReach.test.tsx`, which renders this
 * panel on its own rather than dragging the whole topbar (and Clerk, and the
 * breadcrumb cache) into a test about one empty state.
 */
export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: ordersPage, isLoading: ordersLoading, isError: ordersError } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: NOTIF_SCAN_PAGE_SIZE }),
    enabled: !isApiMockMode,
    staleTime: 30_000,
  });

  const { data: ordersSummary, isLoading: summaryLoading, isError: summaryError } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    staleTime: 30_000,
  });

  const items = (ordersPage?.items ?? [])
    .map((o) => {
      const kind = notifKindFor(o.status, o.unresolvedCount);
      return kind ? { o, kind } : null;
    })
    .filter((x): x is { o: OrderSummary; kind: NotifKind } => x !== null);

  // Held, unconfirmed and unrouted rank under failed but over review: all three need a
  // human before review even matters (held blocks every order in the workspace;
  // unconfirmed risks a duplicate send if mishandled; unrouted can't be reviewed at all
  // until it has a supplier to review it against).
  const rank = (k: string) => (k === "failed" ? 0 : k === "held" || k === "unconfirmed" || k === "unrouted" ? 1 : k === "review" ? 2 : 3);
  items.sort((a, b) => rank(a.kind) - rank(b.kind) || new Date(b.o.createdAt).getTime() - new Date(a.o.createdAt).getTime());
  const top = items.slice(0, NOTIF_ROW_LIMIT);
  // Did either query fail with nothing to fall back on? A failed fetch that still
  // has cached data is NOT unknown — the counts below are then a real, if older,
  // answer, which is why this tests `=== undefined` rather than `isError` alone.
  const activityUnknown =
    (summaryError && ordersSummary === undefined) ||
    (!isApiMockMode && ordersError && ordersPage === undefined);
  // `null` = we do not know, and it is deliberately NOT 0. Every reader below
  // branches on it, so the bell, the panel header and the panel body cannot
  // drift into three different opinions about a summary that never arrived.
  const unread: number | null = activityUnknown
    ? null
    : !isApiMockMode
    ? ((ordersSummary?.byStatus?.["pending_review"] ?? 0) +
       (ordersSummary?.byStatus?.["failed"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_failed"] ?? 0) +
       (ordersSummary?.byStatus?.["transform_failed"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_dead_letter"] ?? 0) +
       (ordersSummary?.byStatus?.["rejected_by_supplier"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_held"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_unconfirmed"] ?? 0) +
       (ordersSummary?.byStatus?.["unrouted"] ?? 0))
    : items.filter((i) => i.kind === "failed" || i.kind === "review" || i.kind === "held" || i.kind === "unconfirmed" || i.kind === "unrouted").length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={
          unread === null
            ? "Notifications, activity status unavailable"
            : unread > 0
            ? `Notifications, ${unread} need action`
            : "Notifications"
        }
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center relative"
        style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
      >
        {/* Visible 32x32 chip; the button itself is a 44x44 transparent hit area. */}
        <span
          className="flex items-center justify-center rounded-[6px] relative"
          style={{ width: 32, height: 32, background: open ? "#14253D" : "transparent", border: "1px solid transparent", color: open ? "#FFFFFF" : "#C8D1E0", transition: "background 150ms, color 150ms" }}
          onMouseEnter={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.background = "#14253D"; } }}
          onMouseLeave={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.background = "transparent"; } }}
        >
          <Bell size={17} strokeWidth={1.9} />
          {/* ONE style object for both badges below. They were written twice and
              the duplicate is how the two would have drifted — and the whole point
              of the unknown badge is that it occupies the same 15px the count
              occupies, so the eye reads "there is something here" identically. */}
          {unread === null && (
            /* The "we don't know" badge. Its absence was the defect: with the
               count unknown the chip simply disappeared, and a disappeared chip is
               the same pixels as a clean workspace. "?" is not a count and cannot
               be mistaken for one. */
            <span className="absolute flex items-center justify-center" aria-hidden style={NOTIF_BADGE_STYLE}>
              ?
            </span>
          )}
          {unread !== null && unread > 0 && (
            <span className="absolute flex items-center justify-center" style={NOTIF_BADGE_STYLE}>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-x-2 top-14 z-50 w-auto sm:absolute sm:inset-x-auto sm:right-0 sm:top-8 sm:w-80"
          style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", borderRadius: 10, boxShadow: "0 8px 24px rgba(11,26,47,.12)", overflow: "hidden" }}
        >
          <div className="flex items-center justify-between" style={{ padding: "10px 12px", borderBottom: "1px solid #E5E8EE" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0B1A2F" }}>Notifications</span>
            {unread === null && <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--amber-text)" }}>Status unavailable</span>}
            {unread !== null && unread > 0 && <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8A5310" }}>{unread} need action</span>}
          </div>
          <div className="max-h-[60vh] sm:max-h-[360px]" style={{ overflowY: "auto" }}>
            {top.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
                {notificationsEmptyMessage(unread ?? 0, ordersLoading || summaryLoading, unread === null)}
              </div>
            ) : (
              top.map(({ o, kind }) => {
                const meta = NOTIF_META[kind];
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { setOpen(false); router.push(`/inbox/${o.id}`); }}
                    className="w-full text-left flex items-start gap-2.5"
                    style={{ padding: "9px 12px", borderBottom: "1px solid #F0F2F6", background: "#FFFFFF", cursor: "pointer" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F6F7FA"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.dot, marginTop: 5, flexShrink: 0 }} />
                    <span className="min-w-0 flex-1">
                      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#0B1A2F" }}>{statusLabel(o.status)}</span>
                      <span style={{ display: "block", fontSize: 11, color: "#5E6779", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{o.poNumber}</span> · {o.supplierName}
                      </span>
                    </span>
                    <span style={{ fontSize: 10, color: "var(--ink-faint)", flexShrink: 0, marginTop: 1 }}>{timeAgo(o.createdAt)}</span>
                  </button>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); router.push("/inbox"); }}
            className="w-full text-center"
            style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, color: "#1E6D29", background: "#FFFFFF", cursor: "pointer", borderTop: "1px solid #E5E8EE" }}
          >
            View all in inbox →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Desktop primary navigation (top navbar, md+) ───────────────────────────
// The sidebar was removed on desktop; its primary nav now renders here as a
// horizontal link row. Structure, gating, direction relabel and active-state
// are REUSED wholesale from BridgeSidebar (buildVisibleNav / isItemActive /
// hubTooltip) so the two can never drift — this row is the sidebar's nav,
// re-laid-out horizontally. Hub items still light for ANY route in their hub;
// the Inbox "review" badge is preserved.

/** One horizontal nav link. Active = white + 2px blue underline; inactive =
 *  #C8D1E0 → white on hover. Mirrors the sidebar's semantics, not its chrome. */
function TopNavLink({
  item,
  active,
  badge,
  onNavigate,
}: {
  item: SidebarNavItem;
  active: boolean;
  badge?: NavBadge;
  onNavigate?: () => void;
}) {
  const title = hubTooltip(item);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      target={item.newTab ? "_blank" : undefined}
      rel={item.newTab ? "noopener noreferrer" : undefined}
      title={title}
      aria-current={active ? "page" : undefined}
      className="relative inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
      style={{
        height: "100%",
        padding: "0 10px",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? "#FFFFFF" : "#C8D1E0",
        borderBottom: active ? "2px solid #1E66C9" : "2px solid transparent",
        textDecoration: "none",
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "#C8D1E0"; }}
    >
      {item.label}
      {/* No count to print. A dash chip, not an absent chip: absence here reads
          as "nothing needs review", which is a claim the failed summary never
          supported. Muted so it cannot be mistaken for a real count. */}
      {badge === "unknown" && (
        <span
          className="flex items-center justify-center rounded-full"
          style={{ minWidth: 17, height: 17, padding: "0 5px", background: "transparent", color: "var(--navy-text)", border: "1px solid var(--navy-muted)", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, borderRadius: 999 }}
        >
          <span aria-hidden>—</span>
          <span className="sr-only">{NAV_BADGE_UNKNOWN_LABEL}</span>
        </span>
      )}
      {typeof badge === "number" && badge > 0 && (
        <span
          className="flex items-center justify-center rounded-full"
          style={{ minWidth: 17, height: 17, padding: "0 5px", background: "#1E66C9", color: "#FFFFFF", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, borderRadius: 999 }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

/**
 * The horizontal primary nav for md+. Reuses buildVisibleNav (admin gating and
 * the inbound "Suppliers → Customers" relabel; WP-26 removed the launch-flag
 * narrowing — with four items there is nothing to narrow, and INBOUND_ENABLED
 * now gates two TABS inside the Orders hub) and
 * isItemActive (hub-lights-for-any-hub-route). Groups are flattened to a single
 * horizontal row (group headers belong to the vertical rail, not a top bar).
 * Overflows scroll horizontally at the md→lg band so links never wrap or clip.
 * Returns the admin-gated `tail` items so the caller can place them in the
 * right cluster (Admin) / profile menu (Settings) without re-deriving the gate.
 */
function useTopNav() {
  const pathname = usePathname();
  const queryEnabled = useQueriesEnabled();
  const { labels } = useOrderDirection();

  const { data: adminAccess } = useQuery({
    queryKey: ["admin-access"],
    queryFn: checkAdminAccess,
    enabled: queryEnabled,
    staleTime: 300_000,
    retry: false,
  });
  const isAdmin = adminAccess === true;

  const { data: ordersSummary, isError: summaryError } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    enabled: queryEnabled,
    staleTime: 30_000,
  });
  // `undefined` = the summary failed and left nothing behind, so there is no
  // count to print. It is NOT 0: `?? 0` here rendered a nav item with no badge,
  // which is the exact pixels of a workspace with nothing to review. A cached
  // answer still counts, hence `=== undefined` rather than `isError` alone.
  const reviewCount: number | undefined =
    summaryError && ordersSummary === undefined
      ? undefined
      : ordersSummary?.byStatus?.["pending_review"] ?? 0;

  const { main, tail } = useMemo(
    () => buildVisibleNav(labels.counterpartyPlural, isAdmin),
    [labels.counterpartyPlural, isAdmin],
  );
  // Flatten grouped sections into a single ordered list for the horizontal row.
  const items = useMemo(() => main.flatMap((s) => s.items), [main]);

  return { items, tail, pathname, reviewCount };
}

// ─── Desktop brand + workspace switcher (top navbar left cluster) ────────────

/** Live workspace name + billing plan for the compact OrgSwitcher. */
function useWorkspaceCardData() {
  const queryEnabled = useQueriesEnabled();
  const { organization } = useOrganization();
  const { data: billing } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
    staleTime: 60_000,
  });
  // Derived from the ladder, not from the wire value. Capitalising the first letter of
  // `billing.plan` agrees with the ladder only by coincidence — it is a string operation on
  // an identifier, and it would render a future two-word tier as "Highvolume plan".
  const planLabel = billing ? planDisplayName(billing.plan) : "Loading…";
  const orgName = organization?.name ?? "Your workspace";
  return { orgName, planLabel, activePlan: billing ? planLabel : null };
}

export function BridgeTopbar({ crumb, onMenuClick }: BridgeTopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { items: navItems, tail: navTail, reviewCount } = useTopNav();
  // Direction-aware counterparty word for the hub strip's Suppliers tab —
  // inbound orgs are relabeled "Customers" everywhere else (buildVisibleNav,
  // the suppliers page's sr-only h1), and on mobile this strip is the ONLY
  // surface naming the page, so it must carry the same word.
  const { labels: directionLabels } = useOrderDirection();
  const { orgName, planLabel, activePlan } = useWorkspaceCardData();
  const adminItem = navTail.find((t) => t.href === "/admin");
  const autoCrumb = useAutoCrumb();
  const hubRow = useHubRow();
  const mobileLabel = useMobilePageLabel();
  // The Order Workshop (/inbox/[orderId]) compresses its chrome: EVERY state of
  // that page carries its own "← Inbox" back chip + the PO number as the visible
  // title — the healthy mapper via its Row 1 (OrderWorkshop.tsx) and the gate
  // states (parse/transform/delivery failures, holds, parking, loading) via the
  // shared WorkshopGateShell header (WorkshopGateChrome.tsx) — so this context
  // row would only duplicate the same 2-level path. Skip it there to give the
  // mapper the vertical space.
  const onOrderWorkshop = /^\/inbox\/[^/]+/.test(pathname);
  // Double-navbar guard (founder screenshot, 2026-07-24): on a top-level page
  // like Dashboard the context row's whole content was a lone unlinked crumb
  // repeating the nav item directly above it. It links nowhere, so it is pure
  // duplication wherever the primary nav row shows (md+, `hidden md:flex`) —
  // hide the row there. Below md that row is hidden and this is the ONLY label
  // naming the page (these pages render their h1 sr-only via PageHeader
  // `titleHidden`), so the row is kept.
  const loneCrumbRow = !crumb && !hubRow && isLonePageCrumb(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Focus management: the slideover moves focus to its search input on open;
  // closing must hand focus back to the "?" trigger.
  const helpBtnRef = useRef<HTMLButtonElement>(null);

  // Unseen-guide dot on the "?" button — discovery cue now that guide content
  // lives only in the help slideover. SSR-safe: state starts false (badge
  // renders nothing) and is computed after mount; opening the slideover is the
  // only "seen" trigger (sets guideSeenKey for the current route).
  const guideRoute = matchGuide(pathname)?.route ?? null;
  const [guideUnseen, setGuideUnseen] = useState(false);
  useEffect(() => {
    if (!guideRoute) {
      setGuideUnseen(false);
      return;
    }
    try {
      setGuideUnseen(window.localStorage.getItem(guideSeenKey(guideRoute)) === null);
    } catch {
      setGuideUnseen(false); // storage blocked — can't remember "seen", never badge
    }
  }, [guideRoute]);

  // Global cmd+K listener
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <header
      className="on-navy flex-shrink-0 relative flex flex-col"
      style={{ background: "#0B1A2F" }}
    >
      {/* ── Row 1 · Primary nav bar ──────────────────────────────────
          The desktop sidebar was removed; its primary navigation lives here.
          LEFT   = mobile hamburger · ProcuLink brand (→ /bridge) · compact
                   OrgSwitcher.
          CENTER = the primary nav as horizontal links (md+), built from the
                   SAME buildVisibleNav/isItemActive the sidebar used; scrolls
                   horizontally at the md→lg band so links never wrap or clip.
          RIGHT  = Upload order · demo/setup chips · ⌘K search · notifications ·
                   Admin (admin-gated) · Help · account chip.
          Mobile (< md) collapses to hamburger + brand + the compact control
          cluster; the full nav is reached through the drawer (onMenuClick). */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5" style={{ height: 52 }}>
        {/* Mobile menu — opens the BridgeSidebar drawer (full nav on < md). */}
        <button
          type="button"
          onClick={onMenuClick}
          className="flex h-11 w-11 items-center justify-center rounded-[7px] md:hidden flex-shrink-0"
          style={{
            background: "#14253D",
            border: "1px solid #1F3252",
            color: "#C8D1E0",
          }}
          aria-label="Open navigation"
        >
          <Menu size={18} strokeWidth={2.2} />
        </button>

        {/* Brand mark → dashboard. */}
        <Link
          href="/bridge"
          aria-label="ProcuLink — go to dashboard"
          className="flex items-center gap-2 flex-shrink-0"
          style={{ color: "#FFFFFF", textDecoration: "none" }}
        >
          <ProcuLinkMark size={24} mono />
          <span
            className="hidden sm:inline"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, system-ui, sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: "-0.015em" }}
          >
            ProcuLink
          </span>
        </Link>

        {/* Compact workspace switcher (opens a downward menu of real orgs). */}
        <div className="hidden md:block flex-shrink-0">
          <OrgSwitcher compact orgName={orgName} planLabel={planLabel} activePlan={activePlan} />
        </div>

        {/* Demo-mode badge — gated on the SAME isApiMockMode flag the data layer
            uses, so the badge and the actual mock-data mode can never diverge.
            Full pill from sm up; a compact dot-only pill on mobile. `ml-auto`
            starts the right control cluster (also nudges controls right on
            mobile where the nav is hidden). */}
        {isApiMockMode ? (
          <span
            className="ml-auto inline-flex items-center flex-shrink-0"
            style={{
              gap: 6,
              height: 22,
              padding: "0 10px",
              borderRadius: 99,
              background: "#FAF1DD",
              border: "1px solid #F0D39A",
              color: "#7A4D0B",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
            title="You are viewing mock data. Set NEXT_PUBLIC_USE_MOCK=false to see your organisation's real orders."
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#B36D14",
                display: "inline-block",
              }}
            />
            <span className="hidden sm:inline">Demo data</span>
            <span className="sm:hidden">Demo</span>
          </span>
        ) : (
          // Anchor the right cluster to the row's end even when the demo badge
          // is absent (keeps the nav left-of-center and controls flush right).
          <span className="ml-auto" aria-hidden />
        )}

        {/* Setup progress chip — visible only while onboarding is genuinely
            incomplete (server-verified); hides itself at completion/unknown. */}
        <SetupProgressChip />

        {/* Upload order — pinned primary create action (reuses the sidebar's
            PINNED_ACTION_HREF). Blue = buyer/source action per the semantic law.
            md+ shows the labelled button; mobile keeps it in the drawer. */}
        <Link
          href={PINNED_ACTION_HREF}
          className="hidden md:flex items-center justify-center gap-2 flex-shrink-0 text-white"
          style={{ height: 34, padding: "0 13px", borderRadius: 8, background: "#1E66C9", fontSize: 13, fontWeight: 600, boxShadow: "0 1px 2px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.14)", textDecoration: "none", transition: "background 140ms" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#0F4FA8"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#1E66C9"; }}
        >
          <Upload size={15} strokeWidth={2} />
          <span>Upload order</span>
        </Link>

        {/* Search — icon-only trigger for the ⌘K command palette (sm+). Icon-only
            in the top nav so the primary nav keeps the row's width; the palette is
            the real search. Kept a title with the ⌘K hint. */}
        <button
          type="button"
          aria-label="Search (⌘K)"
          title="Search — ⌘K"
          onClick={() => setPaletteOpen(true)}
          className="hidden sm:flex items-center justify-center flex-shrink-0"
          style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
          {/* Visible 32x32 chip inside a 44x44 hit area (WCAG 2.5.8). Same pattern as the bell. */}
          <span
            className="flex items-center justify-center rounded-[6px]"
            style={{ width: 32, height: 32, background: "transparent", border: "1px solid transparent", color: "#C8D1E0", transition: "background 150ms, color 150ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#14253D"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Search size={17} strokeWidth={1.9} />
          </span>
        </button>

        {/* Mobile search — icon-only trigger for the command palette. */}
        <button
          type="button"
          aria-label="Search"
          onClick={() => setPaletteOpen(true)}
          className="flex sm:hidden items-center justify-center flex-shrink-0"
          style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
          {/* 32x32 chip inside a 44x44 hit area (WCAG 2.5.8). */}
          <span
            className="flex items-center justify-center rounded-[6px]"
            style={{ width: 32, height: 32, background: "transparent", border: "1px solid transparent", color: "#C8D1E0" }}
          >
            <Search size={17} strokeWidth={1.9} />
          </span>
        </button>

        {/* Notifications — live popover (needs-review / failed / delivered). */}
        <div className="flex-shrink-0">
          <NotificationsBell />
        </div>

        {/* Admin — folded in from the sidebar TAIL. Admin-gated by
            buildVisibleNav's /api/admin/access probe (adminItem is undefined
            for non-admins); the page + every /api/admin endpoint re-gate
            server-side, so this link never leaks access. */}
        {adminItem && (
          <Link
            href={adminItem.href}
            aria-label="Admin"
            title="Admin"
            className="hidden md:flex items-center justify-center relative flex-shrink-0"
            style={{
              minWidth: "var(--tap-min)",
              minHeight: "var(--tap-min)",
              background: "transparent",
              border: "none",
              color: "#C8D1E0",
              textDecoration: "none",
            }}
          >
            {/* 32x32 chip inside a 44x44 hit area (WCAG 2.5.8). */}
            <span
              className="flex items-center justify-center rounded-[6px]"
              style={{ width: 32, height: 32, background: "transparent", border: "1px solid transparent", transition: "background 150ms, color 150ms" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#14253D"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <Lock size={16} strokeWidth={1.9} />
            </span>
          </Link>
        )}

        {/* Help — dot badge while the current route's guide is unseen. Opens the
            help slideover (which itself links to /help + articles), so the
            sidebar TAIL's "Help & support" destination stays reachable. */}
        <button
          ref={helpBtnRef}
          type="button"
          aria-label={guideUnseen ? "Help — guide available for this screen" : "Help"}
          onClick={() => {
            if (guideRoute) {
              try {
                window.localStorage.setItem(guideSeenKey(guideRoute), new Date().toISOString());
              } catch {
                // storage blocked — the slideover still opens
              }
            }
            setGuideUnseen(false);
            setHelpOpen(true);
          }}
          className="hidden sm:flex items-center justify-center flex-shrink-0"
          style={{
            minWidth: "var(--tap-min)",
            minHeight: "var(--tap-min)",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
          title="Help"
        >
          {/* 32x32 chip inside a 44x44 hit area (WCAG 2.5.8); the unseen-guide dot
              rides the visible chip, not the larger hit area. */}
          <span
            className="flex items-center justify-center rounded-[6px] relative"
            style={{ width: 32, height: 32, background: "transparent", border: "1px solid transparent", color: "#C8D1E0", transition: "background 150ms, color 150ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#14253D"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <HelpCircle size={17} strokeWidth={1.9} />
            {guideUnseen && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#B36D14",
                  border: "1.5px solid #0B1A2F",
                }}
              />
            )}
          </span>
        </button>

        {/* Account chip — real name/role, Profile · Settings · Sign out (Settings
            folded in from the sidebar TAIL). Compact avatar-only trigger; the
            menu opens downward from the top navbar. */}
        <div className="flex-shrink-0">
          <UserChipMenu collapsed placement="down" />
        </div>
      </div>

      {/* ── Row 2 · Primary nav ──────────────────────────────────────
          DO NOT re-inline this into the utility row above. That arrangement was
          tried and rejected: the top-level sections need their own row so they
          ALL stay visible at any desktop width, and the row above is already
          carrying the org switcher, Upload, and the account cluster. WP-26 cut
          the nav to four words, which shortens the row but does not free the
          ~540px the inline version wanted — the utility cluster is what fills
          it. md+ only; mobile uses the hamburger drawer. A right-edge fade cues
          horizontal scroll on the rare narrow-desktop overflow. */}
      <nav
        aria-label="Primary"
        className="hidden md:flex items-stretch px-3 sm:px-5"
        style={{
          height: 42,
          borderTop: "1px solid #14253D",
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
          WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
          maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
        }}
      >
        {navItems.map((item) => {
          const active = isItemActive(pathname, item);
          const badge: NavBadge =
            item.badgeKey !== "review"
              ? undefined
              : reviewCount === undefined
              ? "unknown"
              : reviewCount > 0
              ? reviewCount
              : undefined;
          return <TopNavLink key={item.href} item={item} active={active} badge={badge} />;
        })}
      </nav>

      {/* ── Row 3 · Context row ──────────────────────────────────────
          The breadcrumb trail (desktop) / compact page label (mobile). Split
          out below the utility row to give the v2 two-row rhythm. It shows the
          navigation context — NOT a duplicate of the page's own H1 (pages render
          their own heading), so the shell never double-titles. A faint top rule
          separates the two rows. Suppressed on the Order Workshop route, whose
          own header already shows "← Inbox · PO …" (see onOrderWorkshop). */}
      {!onOrderWorkshop && (
      <div
        className={`flex items-center px-3 sm:px-5${loneCrumbRow ? " md:hidden" : ""}`}
        style={{ height: 38, borderTop: "1px solid #14253D" }}
      >
        {/* Full breadcrumb from sm up. On hub routes (and unless the page passed
            an explicit crumb) the trail's TAIL is replaced by the hub section
            tabs — prefix crumbs, then [tabs], then any detail-page tail. The
            strip scrolls horizontally when tight (narrow viewports) and the
            active tab's 2px underline rides the row's bottom edge. */}
        {!crumb && hubRow ? (
          <div
            className="flex min-w-0 flex-1 items-stretch self-stretch text-[12.5px]"
            style={{ color: "#C8D1E0", overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none" }}
          >
            {hubRow.prefix.length > 0 && (
              <nav aria-label="Breadcrumb" className="flex items-center" style={{ flexShrink: 0 }}>
                {hubRow.prefix.map((c, i) => (
                  <span key={`${c.href ?? c.label}-${i}`} className="inline-flex items-center">
                    {i > 0 && <HubRowSeparator />}
                    <HubRowCrumb crumb={c} isCurrent={false} />
                  </span>
                ))}
                <HubRowSeparator />
              </nav>
            )}
            <HubTabs hub={hubRow.hub} variant="topbar" counterpartyPlural={directionLabels.counterpartyPlural} />
            {hubRow.tail.length > 0 && (
              <span className="flex min-w-0 items-center">
                {hubRow.tail.map((c, i) => (
                  <span key={`${c.href ?? c.label}-${i}`} className="inline-flex min-w-0 items-center">
                    <HubRowSeparator />
                    <HubRowCrumb crumb={c} isCurrent={i === hubRow.tail.length - 1} />
                  </span>
                ))}
              </span>
            )}
          </div>
        ) : (
          <div
            className="hidden sm:flex min-w-0 items-center gap-2 text-[12.5px]"
            style={{ color: "#C8D1E0" }}
          >
            {crumb ?? autoCrumb}
          </div>
        )}
        {/* Mobile: compact single-segment page title so the user always knows
            where they are (the desktop breadcrumb is hidden below sm). Suppressed
            on hub routes — the hub strip above now shows on mobile too, and it
            already names the section, so a page label here would double up. */}
        {mobileLabel && !(!crumb && hubRow) && (
          <span
            className="sm:hidden min-w-0 truncate text-[13px] font-semibold"
            style={{ color: "#FFFFFF" }}
          >
            {mobileLabel}
          </span>
        )}
      </div>
      )}

      {/* Command Palette */}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {/* Help slide-over */}
      <HelpSlideover
        open={helpOpen}
        onClose={() => {
          setHelpOpen(false);
          helpBtnRef.current?.focus();
        }}
      />

      {/* Bottom edge — 2px blue→green gradient (matches design --gradient-link-spine) */}
      <div
        className="link-spine"
        data-animated="true"
        key={pathname}
        aria-hidden
      />
    </header>
  );
}
