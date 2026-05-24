"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProcuLinkMark } from "./DSPrimitives";

// ─── Nav structure ────────────────────────────────────────────────────────────

const NAV: Array<{
  group?: string;
  items: Array<{ label: string; href: string; badge?: number }>;
}> = [
  {
    items: [{ label: "Bridge", href: "/bridge" }],
  },
  {
    group: "Inbox",
    items: [
      { label: "All crossings",   href: "/inbox" },
      { label: "New",             href: "/inbox?status=new" },
      { label: "Needs review",    href: "/inbox?status=review", badge: 3 },
      { label: "Failed",          href: "/inbox?status=failed", badge: 2 },
      { label: "Sent",            href: "/inbox?status=sent" },
    ],
  },
  {
    group: "Workbench",
    items: [
      { label: "Upload",  href: "/upload" },
      { label: "Drafts",  href: "/drafts" },
    ],
  },
  {
    group: "Library",
    items: [
      { label: "Supplier docks",     href: "/library/suppliers" },
      { label: "Buyer docks",        href: "/library/buyers" },
      { label: "Mappings",           href: "/library/mappings" },
      { label: "Rules",              href: "/library/rules" },
      { label: "Output templates",   href: "/library/templates" },
    ],
  },
  {
    group: "Operations",
    items: [
      { label: "Crossings log", href: "/operations/log" },
      { label: "Connectors",    href: "/operations/connectors" },
      { label: "Webhooks",      href: "/operations/webhooks" },
    ],
  },
  {
    items: [{ label: "Settings", href: "/settings" }],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function BridgeSidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    // Strip query string from href for comparison
    const path = href.split("?")[0];
    if (path === "/bridge") return pathname === "/bridge";
    if (path === "/inbox")  return pathname === "/inbox" && !href.includes("?");
    return pathname.startsWith(path);
  }

  return (
    <aside
      className="flex h-full flex-col overflow-hidden flex-shrink-0"
      style={{
        width: 220,
        background: "#0B1A2F",
        borderRight: "1px solid #1C2F49",
      }}
    >
      {/* ── Logo ──────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4"
        style={{ height: 56, borderBottom: "1px solid #1C2F49", flexShrink: 0, color: "#FFFFFF" }}
      >
        <ProcuLinkMark size={28} mono />
        <span
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, system-ui, sans-serif",
            fontSize: 17,
            fontWeight: 700,
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
          }}
        >
          ProcuLink
        </span>
      </div>

      {/* ── Workspace switcher ────────────────────────────────────── */}
      <div
        className="mx-3 mt-3 mb-2 flex items-center gap-2.5 rounded-[8px] px-3 py-2 cursor-pointer"
        style={{ background: "#10243E", border: "1px solid #1C2F49" }}
      >
        <div
          className="flex items-center justify-center rounded-[5px] text-[10px] font-bold text-white flex-shrink-0"
          style={{ width: 22, height: 22, background: "#1E66C9" }}
        >
          ND
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-white leading-none truncate">
            Nordic Distribution
          </div>
          <div className="text-[10.5px] mt-0.5" style={{ color: "#7C8DA6" }}>
            Free plan
          </div>
        </div>
        <span style={{ color: "#7C8DA6", fontSize: 11 }}>⌄</span>
      </div>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-2 py-1" style={{ scrollbarWidth: "none" }}>
        {NAV.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-4" : ""}>
            {section.group && (
              <div
                className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: "#7C8DA6" }}
              >
                {section.group}
              </div>
            )}
            {section.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 rounded-[6px] px-3 py-[5px] text-[13px] font-medium transition-colors duration-75 relative"
                  style={{
                    color: active ? "#FFFFFF" : "#C5D2E4",
                    background: active ? "#10243E" : "transparent",
                    ...(active && {
                      boxShadow: "inset 2px 0 0 0 #1E66C9",
                    }),
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background =
                        "rgba(255,255,255,0.05)";
                      (e.currentTarget as HTMLElement).style.color = "#FFFFFF";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                      (e.currentTarget as HTMLElement).style.color = "#C5D2E4";
                    }
                  }}
                >
                  <span className="flex-1">{item.label}</span>
                  {item.badge && item.badge > 0 && (
                    <span
                      className="flex items-center justify-center rounded-full text-[10px] font-bold"
                      style={{
                        minWidth: 17,
                        height: 17,
                        padding: "0 4px",
                        background: "#C53A3A",
                        color: "#FFFFFF",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer — bridge health ────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderTop: "1px solid #1C2F49", flexShrink: 0 }}
      >
        <div
          className="rounded-full flex-shrink-0"
          style={{ width: 7, height: 7, background: "#2E8E3A" }}
        />
        <span className="text-[11.5px]" style={{ color: "#7C8DA6" }}>
          Bridge healthy · 12/min
        </span>
      </div>
    </aside>
  );
}
