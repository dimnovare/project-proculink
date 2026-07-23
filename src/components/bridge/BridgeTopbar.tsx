"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, HelpCircle, Lock, Menu, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiClient, checkAdminAccess, getBillingStatus, isApiMockMode } from "@/lib/api-client";
import { guideSeenKey, matchGuide } from "@/lib/section-guides";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrganization } from "@clerk/nextjs";
import type { Order, OrderSummary, Supplier } from "@/types/procurement";
import { buildCrumbTrail, formatCrumbLabel, truncateLabel, type Crumb, type CrumbContext } from "./breadcrumb";
import { CommandPalette } from "./CommandPalette";
import { ProcuLinkMark } from "./DSPrimitives";
import { HelpSlideover } from "./HelpSlideover";
import { HUB_LABELS, HUB_TABS, HubTabs, hubForPath, type HubKey } from "./layout/HubTabs";
import { OrgSwitcher } from "./OrgSwitcher";
import { SetupProgressChip } from "./SetupProgressChip";
import { UserChipMenu } from "./UserChipMenu";
import {
  buildVisibleNav,
  hubTooltip,
  isItemActive,
  PINNED_ACTION_HREF,
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

  // /inbox/[orderId]  ·  /upload/preview/[orderId]
  const orderId =
    (segments[0] === "inbox" && segments[1]) ||
    (segments[0] === "upload" && segments[1] === "preview" && segments[2]) ||
    null;
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
// Founder direction: the hub section tabs (Suppliers | Buyers | Connections …)
// live in the TOPBAR, not under each page's header. On any route that belongs
// to a hub (hubForPath), row 2 swaps the breadcrumb TAIL for the hub's tab bar:
//   /library/suppliers      → Library / [Suppliers* | Buyers | Connections]
//   /library/suppliers/[id] → Library / [tabs] / Acme GmbH
//   /connections            → [Suppliers | Buyers | Connections*]
// Non-hub routes keep the plain breadcrumb untouched.

interface HubRow {
  hub: HubKey;
  /** Linked crumbs BEFORE the hub level (e.g. "Library", "Workbench / Inbound"). */
  prefix: Crumb[];
  /** Crumbs BELOW the active tab (detail pages) — rendered after the tabs. */
  tail: Crumb[];
}

function useHubRow(): HubRow | null {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const ctx = useCrumbContext(segments);
  const hub = hubForPath(pathname);
  if (!hub) return null;

  // The LONGEST tab route (href or match alias) that owns the current path —
  // its depth marks where the breadcrumb prefix ends and the detail tail begins.
  let owner = "";
  for (const t of HUB_TABS[hub]) {
    for (const route of [t.href, ...(t.match ?? [])]) {
      if ((pathname === route || pathname.startsWith(route + "/")) && route.length > owner.length) {
        owner = route;
      }
    }
  }
  const ownerDepth = owner.split("/").filter(Boolean).length;
  const trail = buildCrumbTrail(pathname, ctx);
  // buildCrumbTrail may prepend an unrouted group-head crumb ("Workbench") that
  // has no path segment — offset keeps crumb indexes aligned with segments.
  const offset = trail.length - segments.length;
  const rawPrefix = trail.slice(0, offset + ownerDepth - 1);
  // The prefix leads with the HUB'S name ("Partners", "Rules & formats") — the
  // exact word the sidebar teaches — not the group-root crumb ("Library") which
  // links to a 404. Drop a leading unlinked group-root crumb and lead with the
  // hub label (unlinked context) so the row reads "Partners / [tabs]".
  const hubCrumb: Crumb = { label: HUB_LABELS[hub], href: null };
  const deeperPrefix = rawPrefix.length > 0 && rawPrefix[0].href === null ? rawPrefix.slice(1) : rawPrefix;
  return {
    hub,
    prefix: [hubCrumb, ...deeperPrefix],
    tail: trail.slice(offset + ownerDepth),
  };
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
type NotifKind = "review" | "failed" | "delivered" | "held" | "unconfirmed";

const NOTIF_META: Record<NotifKind, { dot: string; label: string }> = {
  failed:      { dot: "var(--danger)", label: "Delivery failed" },
  // Billing hold: amber (needs a human) rather than red — nothing failed.
  held:        { dot: "var(--amber)", label: "Delivery paused" },
  // Parked: a crash lost the outcome after we sent. Amber like `held` — needs a
  // human, but we can't confirm a failure — never "Delivery failed".
  unconfirmed: { dot: "var(--amber)", label: "Delivery unknown" },
  review:      { dot: "var(--amber)", label: "Needs review" },
  delivered:   { dot: "var(--brand-green)", label: "Delivered" },
};

function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: ordersPage } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    enabled: !isApiMockMode,
    staleTime: 30_000,
  });

  const { data: ordersSummary } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    staleTime: 30_000,
  });

  const items = (ordersPage?.items ?? [])
    .map((o) => {
      let kind: NotifKind | null = null;
      if (o.status === "failed" || o.status === "delivery_failed" || o.status === "transform_failed" || o.status === "delivery_dead_letter" || o.status === "rejected_by_supplier") kind = "failed";
      // Billing hold: classified before `review` because a held order can also carry
      // unresolved lines, and the billing pause is the reason it isn't moving.
      // Without a kind it was dropped entirely and never notified.
      else if (o.status === "delivery_held") kind = "held";
      // Parked: same reasoning as held — classify before `review` so it can't be
      // masked by a leftover unresolvedCount from before it reached delivery.
      else if (o.status === "delivery_unconfirmed") kind = "unconfirmed";
      else if (o.status === "pending_review" || (o.unresolvedCount ?? 0) > 0) kind = "review";
      else if (o.status === "delivered") kind = "delivered";
      return kind ? { o, kind } : null;
    })
    .filter((x): x is { o: OrderSummary; kind: NotifKind } => x !== null);

  // Held and unconfirmed rank under failed but over review: both need a human before
  // review even matters (held blocks every order in the workspace; unconfirmed risks
  // a duplicate send if mishandled).
  const rank = (k: string) => (k === "failed" ? 0 : k === "held" || k === "unconfirmed" ? 1 : k === "review" ? 2 : 3);
  items.sort((a, b) => rank(a.kind) - rank(b.kind) || new Date(b.o.createdAt).getTime() - new Date(a.o.createdAt).getTime());
  const top = items.slice(0, 7);
  const unread = !isApiMockMode
    ? ((ordersSummary?.byStatus?.["pending_review"] ?? 0) +
       (ordersSummary?.byStatus?.["failed"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_failed"] ?? 0) +
       (ordersSummary?.byStatus?.["transform_failed"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_dead_letter"] ?? 0) +
       (ordersSummary?.byStatus?.["rejected_by_supplier"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_held"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_unconfirmed"] ?? 0))
    : items.filter((i) => i.kind === "failed" || i.kind === "review" || i.kind === "held" || i.kind === "unconfirmed").length;

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
        aria-label={unread > 0 ? `Notifications, ${unread} need action` : "Notifications"}
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
          {unread > 0 && (
            <span
              className="absolute flex items-center justify-center"
              style={{ top: 4, right: 4, minWidth: 15, height: 15, padding: "0 3.5px", borderRadius: 8, background: "#B36D14", color: "#FFFFFF", fontSize: 9.5, fontWeight: 700, border: "1.5px solid #0B1A2F", lineHeight: 1 }}
            >
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
            {unread > 0 && <span style={{ fontSize: 10.5, fontWeight: 600, color: "#B36D14" }}>{unread} need action</span>}
          </div>
          <div className="max-h-[60vh] sm:max-h-[360px]" style={{ overflowY: "auto" }}>
            {top.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12.5, color: "var(--ink-faint)" }}>No new activity.</div>
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
                      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#0B1A2F" }}>{meta.label}</span>
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
  badge?: number;
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
 * The horizontal primary nav for md+. Reuses buildVisibleNav (launch-flag +
 * inbound + admin gating and the inbound "Partners → Customers" relabel) and
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

  const { data: ordersSummary } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    enabled: queryEnabled,
    staleTime: 30_000,
  });
  const reviewCount = ordersSummary?.byStatus?.["pending_review"] ?? 0;

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
  const planLabel = billing
    ? `${billing.plan.charAt(0).toUpperCase()}${billing.plan.slice(1)} plan`
    : "Loading…";
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
          The top-level sections on their own row so they ALL stay visible at any
          desktop width — they can't fit in the utility row above alongside the
          org switcher, Upload, and account cluster (6 items + "Rules & formats"
          need ~540px). md+ only; mobile uses the hamburger drawer. A right-edge
          fade cues horizontal scroll on the rare narrow-desktop overflow. */}
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
          const badge = item.badgeKey === "review" && reviewCount > 0 ? reviewCount : undefined;
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
        className="flex items-center px-3 sm:px-5"
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
