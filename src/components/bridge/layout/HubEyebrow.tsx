"use client";

// HubEyebrow — a small uppercase hub label above a page's H1.
//
// Hub pages (Suppliers, Buyers, Connections, Mappings, Rules, …) reach their
// siblings through the HubTabs bar in the navy topbar. First-time users scan the
// white content area, not the chrome, so nothing in-content told them the page
// belongs to a hub. This eyebrow closes that gap: it derives the hub from the
// current route (no page file changes) and renders the hub's teaching word
// ("PARTNERS", "RULES & FORMATS") in the 9.5px group-label style used by the
// sidebar section headers. Renders nothing on non-hub routes.

import { usePathname } from "next/navigation";
import { HUB_LABELS, hubForPath } from "./HubTabs";

export function HubEyebrow() {
  const pathname = usePathname() ?? "";
  const hub = hubForPath(pathname);
  if (!hub) return null;
  return (
    <div
      className="uppercase"
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.15em",
        color: "var(--ink-muted)",
        marginBottom: 5,
        lineHeight: 1,
      }}
    >
      {HUB_LABELS[hub]}
    </div>
  );
}

export default HubEyebrow;
