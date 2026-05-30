"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Layers, Upload, Inbox, Truck, Building2, GitBranch,
  ShieldCheck, FileCode, BookOpen, FileText, Package, ScrollText,
  Plug, Webhook, Settings, ChevronsLeft, ChevronsRight, ExternalLink,
  Files, HelpCircle,
  type LucideIcon,
} from "lucide-react";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { OrderSummary } from "@/types/procurement";
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
      { label: "Delivery log", href: "/operations/log",        icon: ScrollText },
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
      { label: "Help", href: "/help", icon: HelpCircle },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface BridgeSidebarProps {
  onNavigate?: () => void;
  /** Desktop instance is collapsible (66px icon rail, persisted). The mobile drawer is not. */
  collapsible?: boolean;
}

export function BridgeSidebar({ onNavigate, collapsible = false }: BridgeSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Live "needs review" count → Inbox badge (deduped with the inbox/notifications query).
  const { data: ordersPage } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    enabled: !isApiMockMode,
    staleTime: 30_000,
  });
  const orders: OrderSummary[] = ordersPage?.items ?? [];
  const reviewCount = orders.filter(
    (o) => o.status === "pending_review" || (o.unresolvedCount ?? 0) > 0,
  ).length;
  const badgeFor = (key?: "review") => (key === "review" && reviewCount > 0 ? reviewCount : undefined);

  useEffect(() => {
    if (!collapsible) return;
    try { setCollapsed(localStorage.getItem("pl-side") === "1"); } catch { /* ignore */ }
  }, [collapsible]);

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("pl-side", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });

  const isCollapsed = collapsible && collapsed;

  function isActive(href: string) {
    const path = href.split("?")[0];
    if (path === "/bridge") return pathname === "/bridge";
    if (path === "/inbox")  return pathname === "/inbox" || pathname.startsWith("/inbox/");
    return pathname.startsWith(path);
  }

  return (
    <aside
      className="flex h-full flex-shrink-0 flex-col overflow-hidden transition-[width] duration-200"
      style={{ width: isCollapsed ? 66 : 220, background: "#0B1A2F", borderRight: "1px solid #1C2F49" }}
    >
      {/* ── Logo + collapse toggle ────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3" style={{ height: 56, borderBottom: "1px solid #1C2F49", flexShrink: 0, color: "#FFFFFF" }}>
        <ProcuLinkMark size={28} mono />
        {!isCollapsed && (
          <span className="flex-1" style={{ fontFamily: "'Bricolage Grotesque', Inter, system-ui, sans-serif", fontSize: 17, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.02em" }}>
            ProcuLink
          </span>
        )}
        {collapsible && (
          <button
            type="button"
            onClick={toggle}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex items-center justify-center rounded-[6px] flex-shrink-0"
            style={{ width: 26, height: 26, color: "#7C8DA6", background: "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "#C5D2E4"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#7C8DA6"; }}
          >
            {isCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        )}
      </div>

      {/* ── Workspace switcher ────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Switch workspace"
        title={isCollapsed ? "Nordic Distribution · Operations plan" : undefined}
        className={`mt-3 mb-2 flex items-center rounded-[8px] text-left ${isCollapsed ? "mx-auto justify-center w-[42px] py-2" : "mx-3 gap-2.5 px-3 py-2 w-[calc(100%-24px)]"}`}
        style={{ background: "#10243E", border: "1px solid #1C2F49", cursor: "pointer" }}
      >
        <div className="flex items-center justify-center rounded-[5px] text-[10px] font-bold text-white flex-shrink-0" style={{ width: 22, height: 22, background: "#1E66C9" }}>ND</div>
        {!isCollapsed && (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-white leading-none truncate">Nordic Distribution</div>
              <div className="text-[10.5px] mt-0.5" style={{ color: "#7C8DA6" }}>Operations plan</div>
            </div>
            <span style={{ color: "#7C8DA6", fontSize: 11 }}>⌄</span>
          </>
        )}
      </button>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-2 py-1" style={{ scrollbarWidth: "none" }}>
        {NAV.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-4" : ""}>
            {section.group && !isCollapsed && (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#7C8DA6" }}>{section.group}</div>
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
                  className={`flex items-center rounded-[6px] text-[13px] font-medium transition-colors duration-75 relative ${isCollapsed ? "justify-center py-2" : "gap-2.5 px-3 py-[6px]"}`}
                  style={{ color: active ? "#FFFFFF" : "#C5D2E4", background: active ? "#10243E" : "transparent", ...(active && { boxShadow: "inset 2px 0 0 0 #1E66C9" }) }}
                  onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; } }}
                  onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C5D2E4"; } }}
                >
                  <Ico size={16} strokeWidth={1.9} style={{ flexShrink: 0, color: active ? "#6BA5F0" : "#7C8DA6" }} />
                  {!isCollapsed && <span className="flex-1">{item.label}</span>}
                  {!isCollapsed && badge && (
                    <span className="flex items-center justify-center rounded-full text-[10px] font-bold" style={{ minWidth: 17, height: 17, padding: "0 4px", background: "#C97A14", color: "#FFFFFF" }}>{badge}</span>
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

      {/* ── Footer — system health + back to site ─────────────────── */}
      <div
        className={`flex items-center px-4 py-3 ${isCollapsed ? "justify-center" : "gap-2"}`}
        style={{ borderTop: "1px solid #1C2F49", flexShrink: 0 }}
        title={isCollapsed ? "Pipeline healthy · 12/min" : undefined}
      >
        <div className="rounded-full flex-shrink-0" style={{ width: 7, height: 7, background: "#2E8E3A" }} />
        {!isCollapsed && (
          <>
            <span className="text-[11.5px] flex-1" style={{ color: "#7C8DA6" }}>Pipeline healthy · 12/min</span>
            <Link href="/" title="Back to site" aria-label="Back to site" style={{ color: "#7C8DA6", display: "inline-flex" }}>
              <ExternalLink size={13} />
            </Link>
          </>
        )}
      </div>
    </aside>
  );
}
