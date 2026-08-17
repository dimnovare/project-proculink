"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import {
  Upload, Inbox, Users, Zap,
  Lock, HelpCircle, Settings, ChevronsLeft, ChevronsRight, X,
  type LucideIcon,
} from "lucide-react";
import { apiClient, getBillingStatus, checkAdminAccess } from "@/lib/api-client";
import { SIDEBAR_AUTO_COLLAPSE_EVENT } from "@/lib/sidebar-auto-collapse";
import { planDisplayName } from "@/lib/plans";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { ProcuLinkMark } from "./DSPrimitives";
import { hubForPath, visibleHubTabs, type HubKey } from "./layout/HubTabs";
import { OrgSwitcher } from "./OrgSwitcher";
import { UserChipMenu } from "./UserChipMenu";

// ─── Nav structure (WP-26 / DESIGN-DB-1: four destinations) ───────────────────
//
// FOUR top-level items, one flat section, no group headers:
//
//   Orders    → /inbox              hub "orders"     · the shift
//   Suppliers → /library/suppliers  hub "suppliers"  · the setup
//   Activity  → /bridge             hub "activity"   · the receipt
//   Settings  → /settings                            · the workspace
//
// What this replaces: ten top-level words across four group headers (Dashboard ·
// Inbox · Drafts · Inbound · Partners · Rules & formats · Operations ·
// Integrations · Admin · Help · Settings). Three of them — Partners, Rules &
// formats, Integrations — were containers with no meaning of their own, and the
// "Monitor" group header existed only so it would stop colliding with the
// "Operations" item beneath it. Only "Inbox" named something a user does.
//
// NO URL CHANGED. Each hub item links to its first VISIBLE tab route (derived
// from HUB_TABS so the two can never drift) and lights up for ANY route in its
// hub via hubForPath() — including the `hidden` entries that keep advanced
// surfaces reachable without putting them on a strip. The Wire Topology
// dashboard stays at /bridge as Activity ▸ Overview; the brand mark still links
// there. Guarded by BridgeSidebar.test.tsx (reachability) and
// navRoutesResolve.test.ts (nothing 404s).

export type SidebarNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: "review";
  newTab?: boolean;
  /** Hub items light up for any route in their hub (hubForPath). */
  hub?: HubKey;
};
export type SidebarNavSection = { group?: string; items: SidebarNavItem[] };

/**
 * What a nav item's count badge can be. THREE values, not two, and the third is
 * the whole point:
 *
 *   number     → a count we received and it is worth showing.
 *   undefined  → a count we received and it is zero. Render nothing.
 *   "unknown"  → `GET /api/orders/summary` failed and left no cached answer, so
 *                there is no count. Render the dash chip, never nothing.
 *
 * "unknown" exists because `reviewCount = summary?.byStatus?.pending_review ?? 0`
 * collapsed the third case into the second: a failed summary produced 0, 0
 * produced no badge, and no badge is exactly what a clean workspace looks like.
 * The sidebar drawer and the desktop topbar both read this type so the two
 * cannot answer the same failure differently.
 */
export type NavBadge = number | "unknown" | undefined;

/** Accessible name for the "count unavailable" chip. One string, both surfaces. */
export const NAV_BADGE_UNKNOWN_LABEL = "Needs-review count unavailable";

/** The pinned primary action at the top of the rail (not a nav item). */
export const PINNED_ACTION_HREF = "/upload";

/** A hub item's href: its first VISIBLE tab, never a hidden or pre-launch one. */
const hubHome = (hub: HubKey) => visibleHubTabs(hub)[0].href;

const NAV_MAIN: SidebarNavSection[] = [
  {
    // Four items need no group headers.
    items: [
      { label: "Orders", href: hubHome("orders"), icon: Inbox, badgeKey: "review", hub: "orders" },
      // STRUCT-1 still holds: no standalone "Connections" entry — /connections is
      // a hidden entry of this hub and stays fully routable.
      { label: "Suppliers", href: hubHome("suppliers"), icon: Users, hub: "suppliers" },
      { label: "Activity", href: hubHome("activity"), icon: Zap, hub: "activity" },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

// Pinned above the footer user chip (below the flexible spacer). Settings was
// promoted out of here to a primary item; the account menu still lists it.
const NAV_TAIL: SidebarNavItem[] = [
  // Admin is shown only to allowlisted users (buildVisibleNav filters it via
  // the /api/admin/access probe). Even if shown, the page + every /api/admin
  // endpoint re-gate server-side (403), so the link never leaks access — the
  // probe just spares non-admins a dead end.
  { label: "Admin", href: "/admin", icon: Lock },
  // Help lives in the marketing layout (no app shell). Open it in a new tab
  // so the user doesn't lose the app shell mid-task.
  { label: "Help & support", href: "/help", icon: HelpCircle, newTab: true },
];

export interface VisibleNav {
  main: SidebarNavSection[];
  tail: SidebarNavItem[];
}

// The four primary items are never gated — a coordinator sees the same four
// words on day one and on day four hundred. The only nav-level gate left is the
// admin allowlist; INBOUND_ENABLED now gates two TABS inside the Orders hub
// (visibleHubTabs), not a nav item, and the old LAUNCH_CORE_ONLY narrowing is
// gone because there is nothing left to narrow.
//
// `counterpartyPlural` relabels the "Suppliers" entry (href /library/suppliers)
// for inbound orgs (DISPLAY ONLY — the route stays /library/suppliers): inbound
// orgs see their counterparty word ("Customers").
export function buildVisibleNav(counterpartyPlural: string, isAdmin: boolean): VisibleNav {
  const filterItems = (items: SidebarNavItem[]) =>
    items
      // Hide the Admin link unless the server confirmed this user is on the
      // admin allowlist (UX only — the page + API re-gate server-side).
      .filter((item) => item.href !== "/admin" || isAdmin)
      .map((item) =>
        item.href === "/library/suppliers" && counterpartyPlural !== "Suppliers"
          ? { ...item, label: counterpartyPlural }
          : item,
      );

  const main = NAV_MAIN
    .map((section) => ({ ...section, items: filterItems(section.items) }))
    // Drop any section left empty by the filters above.
    .filter((section) => section.items.length > 0);

  return { main, tail: filterItems(NAV_TAIL) };
}

/**
 * Descriptive tooltip for a hub item — lists the tabs INSIDE the hub so a
 * first-time user knows what a hub contains before clicking. Derived from the
 * VISIBLE tabs (middot-joined) so it can never drift from the rendered strip and
 * never advertises a hidden surface. Returns undefined for non-hub items.
 */
export function hubTooltip(item: SidebarNavItem): string | undefined {
  if (!item.hub) return undefined;
  return visibleHubTabs(item.hub).map((t) => t.label).join(" · ");
}

/** Active state: hub items light for ANY route in their hub; plain items by prefix. */
export function isItemActive(pathname: string, item: SidebarNavItem): boolean {
  if (item.hub) return hubForPath(pathname) === item.hub;
  const path = item.href.split("?")[0];
  if (path === "/bridge") return pathname === "/bridge";
  return pathname === path || pathname.startsWith(path + "/");
}

// ─── Component ────────────────────────────────────────────────────────────────

interface BridgeSidebarProps {
  onNavigate?: () => void;
  /** Desktop instance is collapsible (66px icon rail, persisted). The mobile drawer is not. */
  collapsible?: boolean;
  /**
   * Desktop only: default to the collapsed icon rail below the `lg` breakpoint
   * (≤1023px) regardless of the persisted preference, restoring it at `lg`+.
   * Keeps the tablet band (md→lg) on the compact rail.
   */
  collapseBelowLg?: boolean;
  /** Mobile drawer: stretch the aside to fill its container (solid full-screen panel). */
  fullWidth?: boolean;
  /** Render an in-panel close (X) button in the header (mobile drawer). */
  showClose?: boolean;
  /** Invoked by the in-panel close button. */
  onClose?: () => void;
}

export function BridgeSidebar({
  onNavigate,
  collapsible = false,
  collapseBelowLg = false,
  fullWidth = false,
  showClose = false,
  onClose,
}: BridgeSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // Tablet band (md→lg): force the compact rail until the viewport reaches lg.
  const [belowLg, setBelowLg] = useState(false);
  // Screen-requested collapse (e.g. the Review screen's Full-document mode at
  // <1440px). Session-only — never persisted; the requester restores it on exit.
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const { organization } = useOrganization();
  const queryEnabled = useQueriesEnabled();
  // Direction-aware nav: "Suppliers" → "Customers" in inbound mode (route unchanged).
  const { labels } = useOrderDirection();
  // Admin-link visibility probe (UX hint only; the page + API re-gate server-side).
  const { data: adminAccess } = useQuery({
    queryKey: ["admin-access"],
    queryFn: checkAdminAccess,
    enabled: queryEnabled,
    staleTime: 300_000,
    retry: false,
  });
  const isAdmin = adminAccess === true;
  const { main: NAV_VISIBLE, tail: TAIL_VISIBLE } = useMemo(
    () => buildVisibleNav(labels.counterpartyPlural, isAdmin),
    [labels.counterpartyPlural, isAdmin],
  );

  // Live billing plan for the workspace card + switcher (active org only).
  const { data: billing } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
    staleTime: 60_000,
  });
  // Derived from the ladder — see the note on planDisplayName in src/lib/plans.ts.
  const planLabel = billing ? planDisplayName(billing.plan) : "Loading…";
  const orgName = organization?.name ?? "Your workspace";

  // Live "needs review" count → Inbox badge via summary endpoint (accurate regardless of volume).
  const { data: ordersSummary, isError: summaryError } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    enabled: queryEnabled,
    staleTime: 30_000,
  });
  // See NavBadge above. A failed summary with no cached answer yields "unknown",
  // not 0 — the `?? 0` default is what let a dead endpoint render a clean drawer.
  const summaryUnknown = summaryError && ordersSummary === undefined;
  const reviewCount = ordersSummary?.byStatus?.["pending_review"] ?? 0;
  const badgeFor = (key?: "review"): NavBadge =>
    key !== "review" ? undefined : summaryUnknown ? "unknown" : reviewCount > 0 ? reviewCount : undefined;

  useEffect(() => {
    if (!collapsible) return;
    try { setCollapsed(localStorage.getItem("pl-side") === "1"); } catch { /* ignore */ }
  }, [collapsible]);

  useEffect(() => {
    if (!collapseBelowLg) return;
    const mql = window.matchMedia("(max-width: 1023px)");
    const onChange = () => setBelowLg(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [collapseBelowLg]);

  // Listen for screen-requested auto-collapse (window event channel; only the
  // collapsible desktop instance participates — the mobile drawer ignores it).
  useEffect(() => {
    if (!collapsible) return;
    const onAuto = (e: Event) => setAutoCollapsed((e as CustomEvent<boolean>).detail === true);
    window.addEventListener(SIDEBAR_AUTO_COLLAPSE_EVENT, onAuto);
    return () => window.removeEventListener(SIDEBAR_AUTO_COLLAPSE_EVENT, onAuto);
  }, [collapsible]);

  const toggle = () => {
    // A manual click overrides a screen-requested auto-collapse first (user
    // agency wins; no persistence change for that step), then behaves as before.
    if (autoCollapsed) { setAutoCollapsed(false); return; }
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("pl-side", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // Forced rail in the tablet band wins; then a screen-requested auto-collapse;
  // otherwise honor the persisted preference.
  const isCollapsed = (collapseBelowLg && belowLg) || (collapsible && autoCollapsed) || (collapsible && collapsed);

  const renderItem = (item: SidebarNavItem) => {
    const active = isItemActive(pathname, item);
    const Ico = item.icon;
    const badge = badgeFor(item.badgeKey);
    // Collapsed rail → the label (icons only). Expanded → an always-on tooltip
    // listing a hub's tabs so a first-time user sees what's inside before
    // clicking; plain items get no expanded tooltip (their label is visible).
    const title = isCollapsed ? item.label : hubTooltip(item);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        target={item.newTab ? "_blank" : undefined}
        rel={item.newTab ? "noopener noreferrer" : undefined}
        title={title}
        aria-current={active ? "page" : undefined}
        className={`flex items-center text-[13.5px] ${active ? "font-[600]" : "font-medium"} transition-colors duration-[130ms] relative ${isCollapsed ? "justify-center py-[9px] mx-[10px]" : `gap-[11px] px-[11px] ${fullWidth ? "py-[11px]" : "py-[8px]"} mx-3`} my-px rounded-[9px]`}
        style={{ color: active ? "#FFFFFF" : "#C8D1E0", background: active ? "rgba(30,102,201,0.20)" : "transparent" }}
        onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.055)"; (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; } }}
        onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C8D1E0"; } }}
      >
        {/* v2 active marker: a crisp 3px blue bar straddling the inner edge. */}
        {active && (
          <span
            className="absolute"
            aria-hidden
            style={{ left: isCollapsed ? 5 : -2, top: "50%", transform: "translateY(-50%)", width: 3, height: 17, borderRadius: 3, background: "#1E66C9" }}
          />
        )}
        <Ico size={16} strokeWidth={1.9} style={{ flexShrink: 0, color: active ? "#FFFFFF" : "#7C8DA6", opacity: active ? 1 : 0.82 }} />
        {!isCollapsed && <span className="flex-1 truncate">{item.label}</span>}
        {!isCollapsed && badge === "unknown" && (
          <span
            className="flex items-center justify-center rounded-full text-[10.5px]"
            style={{ minWidth: 18, height: 18, padding: "0 5px", background: "transparent", color: "var(--navy-text)", border: "1px solid var(--navy-muted)", fontFamily: "'JetBrains Mono',monospace", borderRadius: 999, fontWeight: 700 }}
          >
            <span aria-hidden>—</span>
            <span className="sr-only">{NAV_BADGE_UNKNOWN_LABEL}</span>
          </span>
        )}
        {!isCollapsed && typeof badge === "number" && (
          <span className="flex items-center justify-center rounded-full text-[10.5px]" style={{ minWidth: 18, height: 18, padding: "0 5px", background: "#1E66C9", color: "#FFFFFF", fontFamily: "'JetBrains Mono',monospace", borderRadius: 999, fontWeight: 700 }}>{badge}</span>
        )}
        {isCollapsed && badge === "unknown" && (
          <>
            <span className="absolute rounded-full" style={{ top: 5, right: 12, width: 7, height: 7, background: "transparent", border: "1.5px solid var(--amber-text)" }} aria-hidden />
            <span className="sr-only">{NAV_BADGE_UNKNOWN_LABEL}</span>
          </>
        )}
        {isCollapsed && typeof badge === "number" && (
          <span className="absolute rounded-full" style={{ top: 5, right: 12, width: 7, height: 7, background: "#1E66C9", border: "1.5px solid #0A1728" }} aria-hidden />
        )}
      </Link>
    );
  };

  return (
    <aside
      className="on-navy flex h-full flex-shrink-0 flex-col overflow-hidden transition-[width] duration-200"
      style={{
        width: fullWidth ? "100%" : (isCollapsed ? 64 : 240),
        // v2 chrome: subtle vertical gradient (control-room depth) instead of a flat fill.
        background: "linear-gradient(179deg, #0D2038 0%, #0A1727 62%, #091422 100%)",
        borderRight: fullWidth ? "none" : "1px solid #1F3252",
        boxShadow: fullWidth ? "18px 0 52px rgba(6,12,22,0.52)" : "inset -1px 0 0 rgba(255,255,255,0.03)",
      }}
    >
      {/* ── Logo + collapse toggle ────────────────────────────────── */}
      <div
        className="flex items-center flex-shrink-0"
        style={{ height: 56, gap: isCollapsed ? 0 : 9, padding: isCollapsed ? "0 14px" : "16px 12px 12px 16px", borderBottom: "1px solid #1F3252", color: "#FFFFFF" }}
      >
        <ProcuLinkMark size={24} mono />
        {!isCollapsed && (
          <span className="flex-1" style={{ fontFamily: "'Bricolage Grotesque', Inter, system-ui, sans-serif", fontSize: 16, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.015em" }}>
            ProcuLink
          </span>
        )}
        {collapsible && (
          <button
            type="button"
            onClick={toggle}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex items-center justify-center flex-shrink-0 ${isCollapsed ? "mx-auto" : "ml-auto"}`}
            style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          >
            {/* Visible 28x28 chip; button is a 44x44 transparent hit area. */}
            <span
              className="flex items-center justify-center rounded-[6px]"
              style={{ width: 28, height: 28, color: "#7C8DA6", background: "transparent", border: "1px solid transparent", transition: "background 150ms, color 150ms" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#14253D"; (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#7C8DA6"; }}
            >
              {isCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            </span>
          </button>
        )}
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            title="Close navigation"
            className="flex items-center justify-center flex-shrink-0 ml-auto"
            style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          >
            {/* Visible 28x28 chip; button is a 44x44 transparent hit area. */}
            <span
              className="flex items-center justify-center rounded-[6px]"
              style={{ width: 28, height: 28, color: "#7C8DA6", background: "transparent", border: "1px solid transparent", transition: "background 150ms, color 150ms" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#14253D"; (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#7C8DA6"; }}
            >
              <X size={18} />
            </span>
          </button>
        )}
      </div>

      {/* ── Workspace card + WORKSPACES switcher ──────────────────────
          Real Clerk organizations only (useOrganizationList); the plan line is
          the live billing query and renders for the ACTIVE org only. Falls back
          to a static card when Clerk isn't configured (mock/QA shells). */}
      <OrgSwitcher
        collapsed={isCollapsed}
        orgName={orgName}
        planLabel={planLabel}
        activePlan={billing ? planLabel : null}
      />

      {/* ── Pinned primary action — Upload order ──────────────────────
          v2 shell pins the primary create action at the top of the rail
          (the Workbench group no longer carries a separate Upload entry).
          Blue = buyer/source action, matching the semantic law. */}
      {!isCollapsed ? (
        <div style={{ padding: "8px 12px 6px" }}>
          <Link
            href={PINNED_ACTION_HREF}
            onClick={onNavigate}
            className="flex w-full items-center justify-center gap-2 text-[13px] font-semibold text-white"
            style={{ height: 38, borderRadius: 9, background: "#1E66C9", boxShadow: "0 1px 2px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.14)", transition: "background 140ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#0F4FA8"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#1E66C9"; }}
          >
            <Upload size={15} strokeWidth={2} />
            Upload order
          </Link>
        </div>
      ) : (
        <div className="flex justify-center" style={{ padding: "6px 0 8px" }}>
          <Link
            href={PINNED_ACTION_HREF}
            onClick={onNavigate}
            title="Upload order"
            aria-label="Upload order"
            className="flex items-center justify-center text-white"
            style={{ width: 40, height: 40, borderRadius: 10, background: "#1E66C9", boxShadow: "0 1px 2px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.14)", transition: "background 140ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#0F4FA8"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#1E66C9"; }}
          >
            <Upload size={17} strokeWidth={2} />
          </Link>
        </div>
      )}

      {/* ── Navigation (grouped hubs; flexible spacer pushes the tail down) ── */}
      <nav aria-label="Workspace" className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none", padding: "4px 0 12px" }}>
        {NAV_VISIBLE.map((section, si) => (
          <div key={si}>
            {section.group && !isCollapsed && (
              <div className="text-[9.5px] font-[700] uppercase" style={{ letterSpacing: "0.15em", color: "#7C8DA6", padding: "17px 20px 7px" }}>{section.group}</div>
            )}
            {section.group && isCollapsed && si > 0 && (
              <div style={{ height: 1, background: "#1F3252", margin: "11px 16px 10px", opacity: 0.7 }} aria-hidden />
            )}
            {section.items.map(renderItem)}
          </div>
        ))}
      </nav>

      {/* ── Tail — Admin · Help & support · Settings (pinned above the chip) ── */}
      {TAIL_VISIBLE.length > 0 && (
        <div className="flex-shrink-0" style={{ padding: "6px 0 8px" }}>
          {isCollapsed && (
            <div style={{ height: 1, background: "#1F3252", margin: "0 16px 8px", opacity: 0.7 }} aria-hidden />
          )}
          {TAIL_VISIBLE.map(renderItem)}
        </div>
      )}

      {/* ── Footer — user chip (real name + role; Profile/Settings/Sign out) ── */}
      <UserChipMenu collapsed={isCollapsed} onNavigate={onNavigate} />
    </aside>
  );
}
