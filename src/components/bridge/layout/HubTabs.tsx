"use client";

// HubTabs — the Claude Design v2 hub-page tab bar ("pages on the upper bar").
// Consolidation per FABLE5_BRIEF §3: Suppliers/Buyers/Connections → "Partners";
// Mappings/Rules/Output templates/Standards → "Rules & formats";
// System health/Exceptions/Delivery log → "Operations"; Connectors/Webhooks →
// "Integrations"; Invoices/Shipping notices → "Inbound". Deep routes stay valid —
// each tab IS the existing route; this bar just links between siblings.
//
// Visual: reference core.jsx underline tabs — 13px/600, active ink + 2px blue
// underline, optional mono count badge ("Invoices · 4" reads as label + count).

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

export type HubKey = "partners" | "rules-formats" | "operations" | "integrations" | "inbound";

interface HubTab {
  label: string;
  href: string;
  /** Extra pathnames that should light this tab (sub-routes). */
  match?: string[];
}

/**
 * Human display name for each hub — the word the sidebar teaches ("Partners",
 * "Rules & formats"). Used as the topbar prefix crumb and the in-page hub eyebrow
 * so the destination visibly belongs to the hub the user clicked. Kept next to
 * HUB_TABS so labels and tabs can't drift.
 */
export const HUB_LABELS: Record<HubKey, string> = {
  partners: "Partners",
  "rules-formats": "Rules & formats",
  operations: "Operations",
  integrations: "Integrations",
  inbound: "Inbound",
};

export const HUB_TABS: Record<HubKey, HubTab[]> = {
  partners: [
    { label: "Suppliers", href: "/library/suppliers", match: ["/library/suppliers"] },
    { label: "Buyers", href: "/library/buyers" },
    { label: "Connections", href: "/connections", match: ["/connections"] },
  ],
  "rules-formats": [
    { label: "Mappings", href: "/library/mappings" },
    // No "Rules" or "Output templates" tab: neither page could change what a
    // supplier receives or whether an order passed. Both jobs are per-supplier
    // (the Validation rules and Delivery tabs under Partners), so the hub no
    // longer offers an org-wide version of them.
    { label: "Standards", href: "/library/standards" },
  ],
  operations: [
    { label: "System health", href: "/operations/health" },
    { label: "Exceptions", href: "/operations/exceptions" },
    { label: "Delivery log", href: "/operations/log" },
  ],
  integrations: [
    { label: "Connectors", href: "/operations/connectors" },
    { label: "Webhooks", href: "/operations/webhooks" },
  ],
  inbound: [
    { label: "Invoices", href: "/inbound/invoices" },
    { label: "Shipping notices", href: "/inbound/asns" },
  ],
};

/**
 * A hub earns a tab strip only when it has somewhere to switch TO. With a
 * single tab the strip is one tab sitting under the top-nav item that already
 * names the same page — the founder-reported double navbar. Callers that build
 * the surrounding chrome (BridgeTopbar's hub row) check this before rendering
 * any of it; HubTabs itself also refuses, so no caller can reintroduce it.
 */
export function hubShowsTabs(hub: HubKey): boolean {
  return HUB_TABS[hub].length >= 2;
}

/** Which hub (if any) a pathname belongs to — used by the sidebar for active state. */
export function hubForPath(pathname: string): HubKey | null {
  for (const key of Object.keys(HUB_TABS) as HubKey[]) {
    for (const t of HUB_TABS[key]) {
      if (pathname === t.href || pathname.startsWith(t.href + "/")) return key;
      if (t.match?.some((m) => pathname === m || pathname.startsWith(m + "/"))) return key;
    }
  }
  return null;
}

/**
 * Visual variants:
 *   • "page"   — the original on-white hub-page bar (own bottom rule + margin).
 *   • "topbar" — compact on-navy strip for the BridgeTopbar context row (38px):
 *     no bar rule/margin, the nav stretches to the row height and the active
 *     2px blue underline rides the row's bottom edge. Same accent blue as the
 *     sidebar's active rail (#1E66C9); label colors follow the breadcrumb
 *     palette (inactive #7C8DA6 → hover #C8D1E0, active white).
 */
export type HubTabsVariant = "page" | "topbar";

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 22,
  borderBottom: "1px solid #E5E8EE",
  marginBottom: 18,
};

const topbarBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  // Small gap only — each tab now carries its own 8px horizontal padding so the
  // effective tap target is comfortable; a large gap on top would over-space them.
  gap: 4,
  height: "100%",
  flexShrink: 0,
};

export function HubTabs({
  hub,
  counts,
  variant = "page",
  counterpartyPlural,
}: {
  hub: HubKey;
  counts?: Record<string, number>;
  variant?: HubTabsVariant;
  /**
   * Direction-aware counterparty word ("Suppliers" | "Customers"). When an
   * inbound org relabels it (≠ "Suppliers"), the /library/suppliers tab shows
   * that word instead of the static "Suppliers" — the same display-only relabel
   * buildVisibleNav applies to the Partners nav item, and on mobile this tab is
   * the only surface naming the page (the page's own title is sr-only). Routes,
   * hrefs, and count keys are unchanged.
   */
  counterpartyPlural?: string;
}) {
  const pathname = usePathname() ?? "";
  const tabs = HUB_TABS[hub];
  const topbar = variant === "topbar";
  // Nothing to switch to → no strip (see hubShowsTabs).
  if (!hubShowsTabs(hub)) return null;
  return (
    <nav aria-label="Section" style={topbar ? topbarBarStyle : barStyle}>
      {tabs.map((t) => {
        const active =
          pathname === t.href ||
          pathname.startsWith(t.href + "/") ||
          (t.match?.some((m) => pathname === m || pathname.startsWith(m + "/")) ?? false);
        const count = counts?.[t.label] ?? counts?.[t.href];
        const label =
          t.href === "/library/suppliers" && counterpartyPlural && counterpartyPlural !== "Suppliers"
            ? counterpartyPlural
            : t.label;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            style={
              topbar
                ? {
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    // ≥38px tap target on touch: horizontal padding + full-row
                    // height so tabs are comfortably swipe-tappable at 390px.
                    padding: "0 8px",
                    minHeight: 38,
                    fontSize: 13,
                    fontWeight: 600,
                    color: active ? "#FFFFFF" : "#7C8DA6",
                    borderBottom: active ? "2px solid #1E66C9" : "2px solid transparent",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    transition: "color 130ms",
                  }
                : {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "0 2px 9px",
                    fontSize: 13,
                    fontWeight: 600,
                    color: active ? "#0B1A2F" : "#5E6779",
                    borderBottom: active ? "2px solid #1E66C9" : "2px solid transparent",
                    marginBottom: -1,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }
            }
            onMouseEnter={
              topbar && !active
                ? (e) => { (e.currentTarget as HTMLElement).style.color = "#C8D1E0"; }
                : undefined
            }
            onMouseLeave={
              topbar && !active
                ? (e) => { (e.currentTarget as HTMLElement).style.color = "#7C8DA6"; }
                : undefined
            }
          >
            {label}
            {typeof count === "number" && (
              <span
                style={{
                  fontFamily: "var(--font-mono, ui-monospace)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: topbar ? (active ? "#7FA8E0" : "#5E6779") : active ? "#1E66C9" : "var(--ink-faint)",
                }}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
