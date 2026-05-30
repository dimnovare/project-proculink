"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Inbox, Upload, Truck, Building2, GitBranch,
  ShieldCheck, FileCode, BookOpen, FileText, Package, ScrollText,
  Plug, Webhook, Settings, PanelLeftClose, PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { ProcuLinkMark } from "./DSPrimitives";

// ─── Nav structure ────────────────────────────────────────────────────────────

const NAV: Array<{
  group?: string;
  items: Array<{ label: string; href: string; icon: LucideIcon; badge?: number }>;
}> = [
  { items: [{ label: "Dashboard", href: "/bridge", icon: LayoutDashboard }] },
  {
    group: "Inbox",
    // Status filtering lives on the inbox's own filter chips — sidebar deep-links to the full queue only.
    items: [{ label: "All orders", href: "/inbox", icon: Inbox }],
  },
  {
    group: "Workbench",
    items: [{ label: "Upload", href: "/upload", icon: Upload }],
  },
  {
    group: "Library",
    items: [
      { label: "Suppliers",        href: "/library/suppliers", icon: Truck },
      { label: "Buyers",           href: "/library/buyers",    icon: Building2 },
      { label: "Mappings",         href: "/library/mappings",  icon: GitBranch },
      { label: "Rules",            href: "/library/rules",     icon: ShieldCheck },
      { label: "Output templates", href: "/library/templates", icon: FileCode },
      { label: "Standards",        href: "/library/standards", icon: BookOpen },
    ],
  },
  {
    group: "Inbound",
    items: [
      { label: "Invoices", href: "/inbound/invoices", icon: FileText },
      { label: "ASNs",     href: "/inbound/asns",     icon: Package },
    ],
  },
  {
    group: "Operations",
    items: [
      { label: "Delivery log", href: "/operations/log",        icon: ScrollText },
      { label: "Connectors",   href: "/operations/connectors", icon: Plug },
      { label: "Webhooks",     href: "/operations/webhooks",   icon: Webhook },
    ],
  },
  { items: [{ label: "Settings", href: "/settings", icon: Settings }] },
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

  // Restore persisted collapse state (read after mount to avoid an SSR/CSR mismatch).
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
    if (path === "/inbox")  return pathname === "/inbox" && !href.includes("?");
    return pathname.startsWith(path);
  }

  return (
    <aside
      className="flex h-full flex-shrink-0 flex-col overflow-hidden transition-[width] duration-200"
      style={{ width: isCollapsed ? 66 : 220, background: "#0B1A2F", borderRight: "1px solid #1C2F49" }}
    >
      {/* ── Logo + collapse toggle ────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-3"
        style={{ height: 56, borderBottom: "1px solid #1C2F49", flexShrink: 0, color: "#FFFFFF" }}
      >
        <ProcuLinkMark size={28} mono />
        {!isCollapsed && (
          <span
            className="flex-1"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, system-ui, sans-serif", fontSize: 17, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.02em" }}
          >
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
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>

      {/* ── Workspace switcher ────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Switch workspace"
        title={isCollapsed ? "Nordic Distribution · Free plan" : undefined}
        className={`mt-3 mb-2 flex items-center rounded-[8px] text-left ${isCollapsed ? "mx-auto justify-center w-[42px] py-2" : "mx-3 gap-2.5 px-3 py-2 w-[calc(100%-24px)]"}`}
        style={{ background: "#10243E", border: "1px solid #1C2F49", cursor: "pointer" }}
      >
        <div className="flex items-center justify-center rounded-[5px] text-[10px] font-bold text-white flex-shrink-0" style={{ width: 22, height: 22, background: "#1E66C9" }}>
          ND
        </div>
        {!isCollapsed && (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-white leading-none truncate">Nordic Distribution</div>
              <div className="text-[10.5px] mt-0.5" style={{ color: "#7C8DA6" }}>Free plan</div>
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
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#7C8DA6" }}>
                {section.group}
              </div>
            )}
            {section.group && isCollapsed && si > 0 && (
              <div className="mx-3 mb-1.5" style={{ height: 1, background: "#1C2F49" }} aria-hidden />
            )}
            {section.items.map((item) => {
              const active = isActive(item.href);
              const Ico = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={isCollapsed ? item.label : undefined}
                  className={`flex items-center rounded-[6px] text-[13px] font-medium transition-colors duration-75 relative ${isCollapsed ? "justify-center py-2" : "gap-2.5 px-3 py-[6px]"}`}
                  style={{
                    color: active ? "#FFFFFF" : "#C5D2E4",
                    background: active ? "#10243E" : "transparent",
                    ...(active && { boxShadow: "inset 2px 0 0 0 #1E66C9" }),
                  }}
                  onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; } }}
                  onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C5D2E4"; } }}
                >
                  <Ico size={16} strokeWidth={1.9} style={{ flexShrink: 0, color: active ? "#6BA5F0" : "#7C8DA6" }} />
                  {!isCollapsed && <span className="flex-1">{item.label}</span>}
                  {!isCollapsed && item.badge && item.badge > 0 && (
                    <span className="flex items-center justify-center rounded-full text-[10px] font-bold" style={{ minWidth: 17, height: 17, padding: "0 4px", background: "#C53A3A", color: "#FFFFFF" }}>
                      {item.badge}
                    </span>
                  )}
                  {isCollapsed && item.badge && item.badge > 0 && (
                    <span className="absolute rounded-full" style={{ top: 5, right: 11, width: 7, height: 7, background: "#C53A3A" }} aria-hidden />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer — system health ────────────────────────────────── */}
      <div
        className={`flex items-center px-4 py-3 ${isCollapsed ? "justify-center" : "gap-2"}`}
        style={{ borderTop: "1px solid #1C2F49", flexShrink: 0 }}
        title={isCollapsed ? "System healthy · 12/min" : undefined}
      >
        <div className="rounded-full flex-shrink-0" style={{ width: 7, height: 7, background: "#2E8E3A" }} />
        {!isCollapsed && (
          <span className="text-[11.5px]" style={{ color: "#7C8DA6" }}>System healthy · 12/min</span>
        )}
      </div>
    </aside>
  );
}
