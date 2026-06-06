"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import {
  Layers, Upload, Inbox, Truck, Building2, GitBranch,
  ShieldCheck, FileCode, BookOpen, FileText, Package, ScrollText,
  Plug, Webhook, Settings, ChevronsLeft, ChevronsRight, ChevronDown, ExternalLink,
  Files, HelpCircle, X, ShieldHalf, AlertTriangle, Activity,
  type LucideIcon,
} from "lucide-react";
import { apiClient, getBillingStatus, isApiMockMode } from "@/lib/api-client";
import { LAUNCH_CORE_ONLY, LAUNCH_CORE_HREFS } from "@/lib/launch-flags";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { ProcuLinkMark } from "./DSPrimitives";

// ─── Nav structure (matches the "Bridge Layer" design handoff) ─────────────────

type NavItem = { label: string; href: string; icon: LucideIcon; badgeKey?: "review" };

const NAV: Array<{ group?: string; items: NavItem[] }> = [
  { items: [{ label: "Dashboard", href: "/bridge", icon: Layers }] },
  {
    group: "Workbench",
    items: [
      { label: "Upload", href: "/upload", icon: Upload },
      { label: "Inbox",  href: "/inbox",  icon: Inbox, badgeKey: "review" },
      { label: "Drafts", href: "/drafts", icon: Files },
    ],
  },
  {
    group: "Library",
    items: [
      { label: "Suppliers", href: "/library/suppliers", icon: Truck },
      { label: "Buyers",    href: "/library/buyers",    icon: Building2 },
      { label: "Mappings",       href: "/library/mappings",  icon: GitBranch },
      { label: "Rules",          href: "/library/rules",     icon: ShieldCheck },
      { label: "Output templates", href: "/library/templates", icon: FileCode },
      { label: "Standards",      href: "/library/standards", icon: BookOpen },
    ],
  },
  {
    group: "Operations",
    items: [
      // Exceptions + System health pages existed but were URL-only (unreachable
      // from the nav). Exceptions first — it's the daily triage surface.
      { label: "Exceptions",    href: "/operations/exceptions", icon: AlertTriangle },
      { label: "System health", href: "/operations/health",     icon: Activity },
      { label: "Delivery log",  href: "/operations/log",        icon: ScrollText },
      { label: "Connectors",    href: "/operations/connectors", icon: Plug },
      { label: "Webhooks",      href: "/operations/webhooks",   icon: Webhook },
    ],
  },
  {
    // Inbound (Invoices/ASNs) are real features in this app; the design mock omitted them.
    group: "Inbound",
    items: [
      { label: "Invoices", href: "/inbound/invoices", icon: FileText },
      { label: "ASNs",     href: "/inbound/asns",     icon: Package },
    ],
  },
  {
    items: [
      // Admin is always rendered. The /admin page itself refuses non-admins
      // (the backend allowlist returns 403), so showing the link leaks nothing.
      { label: "Admin", href: "/admin", icon: ShieldHalf },
      { label: "Help", href: "/help", icon: HelpCircle },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

// First-launch shell: filter NAV down to the core hrefs and drop now-empty
// group sections. The full nav is restored by setting NEXT_PUBLIC_LAUNCH_FULL_NAV=true.
// `counterpartyPlural` relabels the "Suppliers" entry to "Customers" in inbound
// mode (DISPLAY ONLY — the route stays /library/suppliers).
function buildVisibleNav(counterpartyPlural: string): Array<{ group?: string; items: NavItem[] }> {
  const relabelled = NAV.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.href === "/library/suppliers" ? { ...item, label: counterpartyPlural } : item,
    ),
  }));
  return LAUNCH_CORE_ONLY
    ? relabelled
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => LAUNCH_CORE_HREFS.has(item.href)),
        }))
        .filter((section) => section.items.length > 0)
    : relabelled;
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
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { organization } = useOrganization();
  const clerkReady = clerkLoaded && !!isSignedIn;
  const queryEnabled = isApiMockMode || clerkReady;
  // Direction-aware nav: "Suppliers" → "Customers" in inbound mode (route unchanged).
  const { labels } = useOrderDirection();
  const VISIBLE_NAV = useMemo(() => buildVisibleNav(labels.counterpartyPlural), [labels.counterpartyPlural]);

  // Live billing plan for workspace switcher display.
  const { data: billing } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
    staleTime: 60_000,
  });
  const planLabel = billing ? `${billing.plan.charAt(0).toUpperCase()}${billing.plan.slice(1)} plan` : "Loading…";
  const orgName = organization?.name ?? "Your workspace";
  const initials = (orgName.match(/\b\p{L}/gu) ?? []).slice(0, 2).join("").toUpperCase() || "PL";

  // Live "needs review" count → Inbox badge via summary endpoint (accurate regardless of volume).
  const { data: ordersSummary } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    enabled: queryEnabled,
    staleTime: 30_000,
  });
  const reviewCount = ordersSummary?.byStatus?.["pending_review"] ?? 0;
  const badgeFor = (key?: "review") => (key === "review" && reviewCount > 0 ? reviewCount : undefined);

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

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("pl-side", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });

  // Forced rail in the tablet band wins; otherwise honor the persisted preference.
  const isCollapsed = (collapseBelowLg && belowLg) || (collapsible && collapsed);

  function isActive(href: string) {
    const path = href.split("?")[0];
    if (path === "/bridge") return pathname === "/bridge";
    if (path === "/inbox")  return pathname === "/inbox" || pathname.startsWith("/inbox/");
    return pathname.startsWith(path);
  }

  return (
    <aside
      className="flex h-full flex-shrink-0 flex-col overflow-hidden transition-[width] duration-200"
      style={{ width: fullWidth ? "100%" : (isCollapsed ? 66 : 220), background: "#0B1A2F", borderRight: fullWidth ? "none" : "1px solid #1C2F49" }}
    >
      {/* ── Logo + collapse toggle ────────────────────────────────── */}
      <div
        className="flex items-center flex-shrink-0"
        style={{ height: 56, gap: isCollapsed ? 0 : 9, padding: isCollapsed ? "0 14px" : "0 18px", borderBottom: "1px solid #1C2F49", color: "#FFFFFF" }}
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
            className={`flex items-center justify-center rounded-[6px] flex-shrink-0 ${isCollapsed ? "mx-auto" : "ml-auto"}`}
            style={{ width: 28, height: 28, color: "#7C8DA6", background: "transparent", border: "1px solid transparent", cursor: "pointer", transition: "background 150ms, color 150ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#10243E"; (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#7C8DA6"; }}
          >
            {isCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        )}
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            title="Close navigation"
            className="flex items-center justify-center rounded-[6px] flex-shrink-0 ml-auto"
            style={{ width: 28, height: 28, color: "#7C8DA6", background: "transparent", border: "1px solid transparent", cursor: "pointer", transition: "background 150ms, color 150ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#10243E"; (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#7C8DA6"; }}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* ── Workspace switcher ────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Switch workspace"
        title={isCollapsed ? `${orgName} · ${planLabel}` : undefined}
        className={`flex items-center rounded-[6px] text-left ${isCollapsed ? "mx-auto justify-center w-[44px] py-[9px]" : "gap-2.5 w-[calc(100%-28px)]"}`}
        style={{ background: "#10243E", border: "1px solid #1C2F49", cursor: "pointer", margin: isCollapsed ? "12px auto 6px" : "12px 14px 6px", padding: isCollapsed ? undefined : "9px 11px", transition: "background 150ms" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#163052"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#10243E"; }}
      >
        <div className="flex items-center justify-center rounded-[4px] text-[10.5px] font-bold text-white flex-shrink-0" style={{ width: 26, height: 26, background: "#1E66C9" }}>{initials}</div>
        {!isCollapsed && (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold text-white leading-none truncate">{orgName}</div>
              <div className="text-[10.5px] mt-0.5" style={{ color: "#7C8DA6" }}>{planLabel}</div>
            </div>
            <ChevronDown size={15} style={{ color: "#7C8DA6", flexShrink: 0 }} />
          </>
        )}
      </button>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none", padding: "8px 10px 20px" }}>
        {VISIBLE_NAV.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-4" : ""}>
            {section.group && !isCollapsed && (
              <div className="px-[10px] pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#7C8DA6" }}>{section.group}</div>
            )}
            {section.group && isCollapsed && si > 0 && (
              <div className="mx-3 mb-1.5" style={{ height: 1, background: "#1C2F49" }} aria-hidden />
            )}
            {section.items.map((item) => {
              const active = isActive(item.href);
              const Ico = item.icon;
              const badge = badgeFor(item.badgeKey);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={isCollapsed ? item.label : undefined}
                  className={`flex items-center rounded-[6px] text-[12.5px] font-medium transition-colors duration-75 relative ${isCollapsed ? "justify-center py-[9px]" : "gap-2.5 px-[10px] py-[7px]"}`}
                  style={{ color: active ? "#FFFFFF" : "#C5D2E4", background: active ? "#1E66C9" : "transparent" }}
                  onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "#10243E"; (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; } }}
                  onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C5D2E4"; } }}
                >
                  <Ico size={16} strokeWidth={1.9} style={{ flexShrink: 0, color: active ? "#FFFFFF" : "#7C8DA6" }} />
                  {!isCollapsed && <span className="flex-1">{item.label}</span>}
                  {!isCollapsed && badge && (
                    <span className="flex items-center justify-center rounded-full text-[10.5px] font-semibold" style={{ minWidth: 18, height: 18, padding: "0 5px", background: "#C97A14", color: "#FFFFFF" }}>{badge}</span>
                  )}
                  {isCollapsed && badge && (
                    <span className="absolute rounded-full" style={{ top: 5, right: 11, width: 7, height: 7, background: "#C97A14" }} aria-hidden />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer — back to site ─────────────────────────────────────
          The old "Pipeline healthy · 12/min" line was a hardcoded literal, not
          real telemetry, so it was removed (offer↔works). Live system status
          now has its own nav entry (Operations → System health). */}
      <div
        className={`flex items-center ${isCollapsed ? "justify-center" : "gap-2"}`}
        style={{ borderTop: "1px solid #1C2F49", flexShrink: 0, padding: "12px 18px" }}
        title={isCollapsed ? "Back to site" : undefined}
      >
        <Link
          href="/"
          title="Back to site"
          aria-label="Back to site"
          className={`flex items-center text-[11.5px] ${isCollapsed ? "justify-center" : "gap-2 flex-1"}`}
          style={{ color: "#7C8DA6" }}
        >
          <ExternalLink size={13} className="flex-shrink-0" />
          {!isCollapsed && <span className="flex-1">Back to site</span>}
        </Link>
      </div>
    </aside>
  );
}
