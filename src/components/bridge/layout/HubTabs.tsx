"use client";

// HubTabs — the hub-page tab bar ("pages on the upper bar").
//
// WP-26 / DESIGN-DB-1: the nav teaches FOUR destinations — Orders · Suppliers ·
// Activity · Settings — and three of them are hubs whose siblings live here.
// The old five hubs were named after containers ("Partners", "Rules & formats",
// "Integrations") that meant nothing on their own; these three are named after
// the job. NO URL CHANGED — each tab IS the existing route.
//
//   Orders    → /inbox              (orders · buyers · +inbound docs behind a flag)
//   Suppliers → /library/suppliers  (suppliers · item codes · rules · output layouts)
//   Activity  → /bridge             (overview · deliveries · issues)
//
// Some routes are reachable but deliberately NOT on a strip — an incident page
// or an advanced reference a coordinator should never have to read past. Those
// carry `hidden: true`: hubForPath still claims them (so the nav item lights and
// the route resolves), but they are absent from the rendered strip, from
// hubShowsTabs, and from the sidebar's hub tooltip. That flag is what lets the
// nav shrink to four words without stranding a surface — see
// BridgeSidebar.test.tsx's reachability guard and navRoutesResolve.test.ts.
//
// The HubKey values and every `href` are CODE and are deliberately unchanged by
// the WP-25 vocabulary pass: only the `label` a user reads moved. Renaming a key
// or a route would break bookmarks, ?tab= aliases, help links and e2e paths for
// zero user value (DESIGN-DB-1 §12.3).
//
// Visual: reference core.jsx underline tabs — 13px/600, active ink + 2px blue
// underline, optional mono count badge ("Invoices · 4" reads as label + count).

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { INBOUND_ENABLED } from "@/lib/launch-flags";

export type HubKey = "orders" | "suppliers" | "activity";

interface HubTab {
  label: string;
  href: string;
  /** Extra pathnames that should light this tab (sub-routes). */
  match?: string[];
  /**
   * Reachable, but never printed on the strip. Used for surfaces that must keep
   * working (incidents, deep references, versioned setup) while staying out of a
   * coordinator's daily reading. Each has exactly one in-context entry point.
   */
  hidden?: true;
  /**
   * Shown as a tab only when this launch flag is on. Unlike `hidden`, the intent
   * is "not yet", not "advanced" — the route still resolves and still belongs to
   * the hub either way.
   */
  flag?: "inbound";
}

/**
 * Human display name for each hub — the word the nav teaches. Used as the
 * in-page hub eyebrow so a destination visibly belongs to the item the user
 * clicked. Kept next to HUB_TABS so labels and tabs can't drift.
 */
export const HUB_LABELS: Record<HubKey, string> = {
  orders: "Orders",
  suppliers: "Suppliers",
  activity: "Activity",
};

export const HUB_TABS: Record<HubKey, HubTab[]> = {
  // Orders is the shift: the queue, plus who issued the orders in it.
  orders: [
    { label: "Orders", href: "/inbox" },
    { label: "Buyers", href: "/library/buyers" },
    { label: "Invoices", href: "/inbound/invoices", flag: "inbound" },
    { label: "Shipping notices", href: "/inbound/asns", flag: "inbound" },
    // No "Drafts" entry: FE #47 retired /drafts behind a permanent redirect to
    // /inbox, so there is no page left to keep reachable.
  ],
  // Suppliers is the setup: everything that can be wrong with a supplier.
  suppliers: [
    { label: "Suppliers", href: "/library/suppliers" },
    { label: "Item codes", href: "/library/mappings" },
    // The versioned setup that decides what each supplier actually receives.
    //
    // This was `hidden: true` and labelled "Changes", on the premise that it was
    // "the same data as a supplier's Changes tab". Both halves were wrong, and
    // the founder's call (2026-08-08) is to keep the route and give it a door:
    //
    //   • NOT the same data. A supplier's Changes tab (SupplierHistoryTab.tsx)
    //     imports no mapper. The draft-mapping editor — MapperWorkbench
    //     variant="connection", ConnectionDetail.tsx:272 — exists ONLY under
    //     /connections/[connectionId], so the Edit → Make live lifecycle had no
    //     entry point anywhere in the product.
    //   • It is authoritative. Production sets Connections__RevisionAuthority =
    //     true (ProcuLink.Api/Program.cs:555-557 records that the CODE default is
    //     OFF and that this is NOT the deployed value), and with it on, an
    //     order pinned to a published revision is transformed and delivered from
    //     that revision's snapshot rather than the live supplier tables —
    //     OrdersController.cs:1024-1029, :2497-2503,
    //     Services/Orders/OrderIngestionService.cs:115-117, :898-901.
    //
    // So an operator could not see the record governing their own outbound
    // documents. It is a tab now.
    //
    // Why "Supplier changes" and not "Connections": nav labels are a closed
    // vocabulary (src/lib/vocabulary.ts, enforced by lint:vocab --nouns).
    // "connection" is not one of the nine nouns — it only clears the gate via a
    // PENDING_IA_LABELS amnesty whose own spec row says HIDE, so shipping it as
    // a VISIBLE label would contradict the list that permits it. "Supplier
    // changes" is in-budget (supplier + change), and the qualifier is doing
    // work: a supplier's own tab is "Changes" (one supplier), this is the
    // cross-supplier list plus the only place a draft can be edited and made
    // live.
    { label: "Supplier changes", href: "/connections" },
    // No "Rules" or "Output layouts" entry: FE #47 retired /library/rules,
    // /library/rule-definitions and /library/templates behind permanent
    // redirects to /library/suppliers. Neither page could change what a supplier
    // receives or whether an order passed — both jobs are per-supplier (a
    // supplier's Rules and Delivery tabs).
    //
    // A read-only field↔standard matrix nobody opens cold; reached from the
    // format explainers.
    { label: "Format reference", href: "/library/standards", hidden: true },
    // STAYS HIDDEN — and unlike /connections above, that is NOT a defect to fix
    // by unhiding it. Both sentences this comment used to carry were false, and
    // the investigation that replaced them (2026-08-08) found a duplicate, not a
    // stranded surface:
    //
    //   • "Reached from a supplier's Delivery tab" — no such link exists. The
    //     traffic runs the other way only: page.tsx:921 links OUT to
    //     /library/suppliers/{id}?tab=delivery, and nothing links back.
    //   • "a read-only grid of channel TYPES derived from supplier delivery
    //     configs" — in live mode it derives nothing from them. Every row is
    //     hardcoded `type: "API (REST)"`, `status: "available"` (page.tsx:298-309)
    //     because GET /api/suppliers carries no delivery-config signal and the
    //     page declines to fan out per-supplier fetches.
    //
    // The screen that really does the described job is /library/suppliers — the
    // FIRST VISIBLE TAB of this same hub. It fans out exactly those per-supplier
    // delivery-config fetches (SupplierDockList.tsx:39 DELIVERY_FETCH_CAP = 50)
    // and prints each supplier's REAL channel (:892 desktop, :999 mobile).
    //
    // Its two remaining affordances already exist IN CONTEXT on the reachable
    // supplier Delivery tab, in better form:
    //
    //   • Test-fire — the same endpoint. Connectors calls
    //     testFireDeliveryConfig (api-client.ts:2683); the Delivery tab calls
    //     testFireDelivery (lib/api/delivery.ts:44) — both POST
    //     /api/suppliers/{id}/delivery-config/test-fire. The Delivery tab's
    //     button (DeliveryConfigEditor.tsx:1561) is disabled until a config is
    //     saved and renders the endpoint's captured response; the connectors
    //     page has no saved-config signal at all, so it fires blind.
    //   • Connector requirements — DeliveryConfigEditor.tsx:1451 renders
    //     ConnectorRequirementsPanel keyed on the protocol actually selected.
    //     The connectors copy derives its key from the hardcoded row type
    //     (resolveManifestKey, page.tsx:492-502), so `"API (REST)"` resolves to
    //     "http" for EVERY live supplier — an SFTP or Erply supplier is shown
    //     the HTTP field list.
    //
    // And its own CTAs create nothing: "Add connector" (header + empty state)
    // opens a panel whose test-fire returns "Connectors are set up per supplier
    // — open the supplier's Delivery tab…" (page.tsx:684), while the page
    // subtitle already tells the reader to go to the Delivery tab.
    //
    // So a door here would land an operator on a less accurate copy of the tab
    // beside it. Delete-or-rebuild is a founder call, tracked in
    // STRANDED_PENDING_DECISION (src/test/route-reachability.test.ts); until it
    // is made, do not unhide this as-is.
    { label: "Delivery channels", href: "/operations/connectors", hidden: true },
  ],
  // Activity is the receipt: did it go, what broke, is the system up.
  activity: [
    { label: "Overview", href: "/bridge" },
    { label: "Deliveries", href: "/operations/log" },
    { label: "Issues", href: "/operations/exceptions" },
    // Ambient, not a destination — surfaced by the health chip and a degraded
    // banner on Activity.
    { label: "System status", href: "/operations/health", hidden: true },
    // Event subscriptions are the same data as Settings ▸ Connectors. One data
    // source, one visible surface: Settings owns it.
    { label: "Notifications", href: "/operations/webhooks", hidden: true },
  ],
};

/**
 * The tabs a hub actually prints. Hidden entries are reachable, not switchable;
 * flagged entries are pre-launch. Everything that reads the strip — the strip
 * itself, hubShowsTabs, the nav item's href and its tooltip — reads THIS, so a
 * hidden route can never leak into the chrome by being added to HUB_TABS.
 */
export function visibleHubTabs(
  hub: HubKey,
  opts: { inboundEnabled?: boolean } = {},
): HubTab[] {
  const inboundEnabled = opts.inboundEnabled ?? INBOUND_ENABLED;
  return HUB_TABS[hub].filter(
    (t) => !t.hidden && (t.flag !== "inbound" || inboundEnabled),
  );
}

/**
 * A hub earns a tab strip only when it has somewhere to switch TO. With a
 * single visible tab the strip is one tab sitting under the top-nav item that
 * already names the same page — the founder-reported double navbar. Callers that
 * build the surrounding chrome (BridgeTopbar's hub row) check this before
 * rendering any of it; HubTabs itself also refuses, so no caller can
 * reintroduce it.
 */
export function hubShowsTabs(hub: HubKey): boolean {
  return visibleHubTabs(hub).length >= 2;
}

/**
 * Which hub (if any) a pathname belongs to — used by the nav for active state
 * and by the reachability guard. Iterates EVERY entry, hidden and flagged
 * included: that is precisely what keeps an off-strip route reachable.
 */
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
   * buildVisibleNav applies to the Suppliers nav item, and on mobile this tab is
   * the only surface naming the page (the page's own title is sr-only). Routes,
   * hrefs, and count keys are unchanged.
   */
  counterpartyPlural?: string;
}) {
  const pathname = usePathname() ?? "";
  // Hidden and pre-launch entries are reachable, never printed.
  const tabs = visibleHubTabs(hub);
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
