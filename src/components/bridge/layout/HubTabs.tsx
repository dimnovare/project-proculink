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

export const HUB_TABS: Record<HubKey, HubTab[]> = {
  partners: [
    { label: "Suppliers", href: "/library/suppliers", match: ["/library/suppliers"] },
    { label: "Buyers", href: "/library/buyers" },
    { label: "Connections", href: "/connections", match: ["/connections"] },
  ],
  "rules-formats": [
    { label: "Mappings", href: "/library/mappings" },
    { label: "Rules", href: "/library/rules", match: ["/library/rule-definitions"] },
    { label: "Output templates", href: "/library/templates" },
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

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 22,
  borderBottom: "1px solid #E5E8EE",
  marginBottom: 18,
};

export function HubTabs({ hub, counts }: { hub: HubKey; counts?: Record<string, number> }) {
  const pathname = usePathname() ?? "";
  const tabs = HUB_TABS[hub];
  return (
    <nav aria-label="Section" style={barStyle}>
      {tabs.map((t) => {
        const active =
          pathname === t.href ||
          pathname.startsWith(t.href + "/") ||
          (t.match?.some((m) => pathname === m || pathname.startsWith(m + "/")) ?? false);
        const count = counts?.[t.label] ?? counts?.[t.href];
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            style={{
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
            }}
          >
            {t.label}
            {typeof count === "number" && (
              <span
                style={{
                  fontFamily: "var(--font-mono, ui-monospace)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: active ? "#1E66C9" : "#98A0AE",
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
