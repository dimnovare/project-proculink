import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// WP-26 — nav-guard for the destination-based information architecture (DB-1).
//
// The Suppliers destination (and its hub: suppliers, item codes, supplier changes,
// format reference) went with the supplier screens, so the rail teaches Orders ·
// Activity · Settings. No URL changed except those retired ones, which 308 to the
// flow list. This suite guards:
//   • the primary items, one flat section, no group headers;
//   • no standalone /connections item and no Suppliers item;
//   • hub items link to their hub's first VISIBLE tab route;
//   • EVERY route that exists keeps a reachable entry (hub item — visible or
//     hidden tab — direct item, or the pinned Upload action). This is the
//     invariant that makes "hide it from the nav" safe: nothing 404s and nothing
//     becomes unreachable;
//   • one data source never gets two visible nav surfaces;
//   • the gates: INBOUND_ENABLED (now two TABS, not a nav item) and the admin
//     allowlist.

let mockPath = "/bridge";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({
    organization: { id: "org_1", name: "Acme" },
    membership: { role: "org:admin" },
  }),
  useOrganizationList: () => ({
    isLoaded: true,
    setActive: vi.fn(),
    userMemberships: {
      data: [],
      isLoading: false,
      isFetching: false,
      hasNextPage: false,
      fetchNext: vi.fn(),
    },
  }),
  useClerk: () => ({
    openCreateOrganization: vi.fn(),
    openUserProfile: vi.fn(),
    signOut: vi.fn(),
  }),
  useUser: () => ({ user: null, isLoaded: true }),
}));

// All useQuery calls (admin-access probe + orders summary + billing) degrade to
// undefined → non-admin, no badge, "Loading…" plan. Deterministic render.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: { getOrdersSummary: vi.fn().mockResolvedValue({ byStatus: {} }) },
  getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth" }),
  checkAdminAccess: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({ labels: { counterpartyPlural: "Suppliers" } }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import {
  BridgeSidebar,
  buildVisibleNav,
  hubTooltip,
  isItemActive,
  PINNED_ACTION_HREF,
  type SidebarNavItem,
} from "./BridgeSidebar";
import { HUB_TABS, hubForPath, hubShowsTabs, visibleHubTabs, type HubKey } from "./layout/HubTabs";

afterEach(() => {
  cleanup();
  mockPath = "/bridge";
});

const HUBS = Object.keys(HUB_TABS) as HubKey[];

/** Flatten the visible nav (main sections + tail) into one item list. */
function allItems(nav: ReturnType<typeof buildVisibleNav>): SidebarNavItem[] {
  return [...nav.main.flatMap((s) => s.items), ...nav.tail];
}

describe("BridgeSidebar — the destinations", () => {
  // /connections and /library/suppliers were Suppliers-hub surfaces; both retired
  // (they 308 to the flow list), so the rail carries neither a Connections nor a
  // Suppliers item. "Connections" was a nav label pending retirement
  // (src/lib/vocabulary.ts PENDING_IA_LABELS) and is NOT resurrected.
  it("gives /connections and the supplier list no rail item", () => {
    const { container } = render(<BridgeSidebar />);
    expect(container.querySelector('a[href="/connections"]')).toBeNull();
    expect(container.querySelector('a[href="/library/suppliers"]')).toBeNull();
    expect(screen.queryByText("Connections")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Suppliers/i })).toBeNull();
  });

  it("renders the primary destinations with their hub first-tab hrefs", () => {
    render(<BridgeSidebar />);
    expect(screen.getByRole("link", { name: /^Documents/i })).toHaveAttribute("href", "/inbox");
    expect(screen.getByRole("link", { name: /^Activity/i })).toHaveAttribute("href", "/bridge");
    expect(screen.getByRole("link", { name: /Settings/i })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: /Help & support/i })).toHaveAttribute("href", "/help");
    // Pinned primary action.
    expect(screen.getByRole("link", { name: /Upload document/i })).toHaveAttribute("href", PINNED_ACTION_HREF);
  });

  it("retires the container words the old nav taught", () => {
    render(<BridgeSidebar />);
    for (const word of [
      "Dashboard", "Inbox", "Drafts", "Inbound",
      "Partners", "Rules & formats", "Operations", "Integrations",
      "Workbench", "Library", "Monitor",
    ]) {
      expect(screen.queryByText(word), `"${word}" must not be a nav label`).toBeNull();
    }
  });

  it("keeps Admin out of the nav for a non-admin probe", () => {
    render(<BridgeSidebar />);
    expect(screen.queryByText("Admin")).toBeNull(); // non-admin probe (mocked undefined)
  });

  it("lights the Activity hub item for a sibling tab route (/operations/exceptions)", () => {
    mockPath = "/operations/exceptions";
    render(<BridgeSidebar />);
    expect(screen.getByRole("link", { name: /^Activity/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^Documents/i })).not.toHaveAttribute("aria-current");
  });

  // WP-26 asserted this on /drafts; FE #47 retired that route, so the invariant
  // is asserted on /operations/health — a hidden entry of the Activity hub.
  it("lights the owning hub item for a hidden owned route (/operations/health)", () => {
    mockPath = "/operations/health";
    render(<BridgeSidebar />);
    expect(screen.getByRole("link", { name: /^Activity/i })).toHaveAttribute("aria-current", "page");
  });
});

describe("buildVisibleNav — three items, one flat section", () => {
  it("renders exactly three primary nav items", () => {
    const nav = buildVisibleNav("Suppliers", true);
    expect(nav.main).toHaveLength(1);
    expect(nav.main[0].items).toHaveLength(3);
  });

  it("produces one ungrouped section: Documents · Activity · Settings", () => {
    const nav = buildVisibleNav("Suppliers", true);
    // A few items need no group headers — the old Workbench/Library/Monitor
    // headers are gone, so every section label is null.
    expect(nav.main.map((s) => s.group ?? null)).toEqual([null]);
    expect(nav.main.map((s) => s.items.map((i) => i.label))).toEqual([
      ["Documents", "Activity", "Settings"],
    ]);
    // Settings is promoted to primary; the tail keeps only the icon-only items.
    expect(nav.tail.map((i) => i.label)).toEqual(["Admin", "Help & support"]);
  });

  it("exposes exactly the five nav hrefs, in order (a standing guard against creep)", () => {
    const items = allItems(buildVisibleNav("Suppliers", true));
    expect(items.map((i) => i.href)).toEqual([
      "/inbox",
      "/bridge",
      "/settings",
      "/admin",
      "/help",
    ]);
  });

  it("hub items link to their hub's FIRST VISIBLE tab route", () => {
    const byLabel = Object.fromEntries(allItems(buildVisibleNav("Suppliers", true)).map((i) => [i.label, i]));
    expect(byLabel["Documents"].href).toBe("/inbox");
    expect(byLabel["Activity"].href).toBe("/bridge");
    for (const hub of HUBS) {
      const item = Object.values(byLabel).find((i) => i.hub === hub);
      expect(item?.href, `hub ${hub} item href`).toBe(visibleHubTabs(hub)[0].href);
    }
    // …and each hub item's own href resolves back to its hub (no drift).
    for (const item of Object.values(byLabel)) {
      if (item.hub) expect(hubForPath(item.href)).toBe(item.hub);
    }
  });

  // FE-2: a hub whose strip would hold a lone tab renders no strip at all
  // (hubShowsTabs) — that lone tab would sit directly under the nav item naming
  // the same page, the founder-reported double navbar. Hidden entries don't
  // count: they are reachable, not switchable. The Orders hub has one visible
  // tab until the pre-launch inbound tabs are switched on.
  it("a hub shows a strip only when it has two VISIBLE tabs to switch between", () => {
    for (const key of HUBS) {
      expect(hubShowsTabs(key), `hub ${key}`).toBe(visibleHubTabs(key).length >= 2);
    }
    expect(visibleHubTabs("activity").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the review badge wiring on the Orders item", () => {
    const orders = allItems(buildVisibleNav("Suppliers", true)).find((i) => i.href === "/inbox");
    expect(orders?.badgeKey).toBe("review");
  });

  it("every legacy deep route keeps a reachable entry (hub item, direct item, or pinned action)", () => {
    const items = allItems(buildVisibleNav("Suppliers", true));
    const LEGACY_ROUTES = [
      "/bridge", "/upload", "/inbox",
      "/operations/health", "/operations/exceptions", "/operations/log",
      "/inbound/invoices", "/inbound/asns",
      "/admin", "/settings", "/help",
      // Extended to the new tree's child routes — the four-item nav must keep
      // reaching them too, not just the top-level pages.
      "/inbox/008412", "/upload/preview/8f2c1a90",
      "/admin/guides", "/admin/guides/onboard-a-new-client",
    ];
    for (const route of LEGACY_ROUTES) {
      const direct = items.some((i) => route === i.href || route.startsWith(i.href + "/"));
      const viaHub = items.some((i) => i.hub && hubForPath(route) === i.hub);
      // The pinned action owns its whole subtree, exactly as a nav item does:
      // /upload/preview/[id] is where an upload lands you, so the Upload button
      // is its entry point. (Prefix form, matching `direct` above.)
      const viaPinned =
        route === PINNED_ACTION_HREF || route.startsWith(PINNED_ACTION_HREF + "/");
      expect(direct || viaHub || viaPinned, `route ${route} must stay reachable`).toBe(true);
    }
  });

  it("hub active-state covers every tab route of the hub, hidden entries included", () => {
    const items = allItems(buildVisibleNav("Suppliers", true));
    const activity = items.find((i) => i.label === "Activity")!;
    // /operations/webhooks is not here: FE #130 deleted it (a duplicate of
    // Settings ▸ Connectors), and a permanent redirect has no nav state — the
    // same reason /library/rules and /library/templates are absent below.
    // /operations/connectors is gone for the same reason: deleted 2026-08-13, so
    // the cross-hub check that used to sit under this loop went with it.
    for (const p of [
      "/bridge", "/operations/log", "/operations/exceptions",
      "/operations/health",
    ]) {
      expect(isItemActive(p, activity), `${p} lights Activity`).toBe(true);
    }
    const orders = items.find((i) => i.label === "Documents")!;
    for (const p of [
      "/inbox", "/inbox/008412",
      "/inbound/invoices", "/inbound/asns",
    ]) {
      expect(isItemActive(p, orders), `${p} lights Orders`).toBe(true);
    }
  });

  // AC: no duplicate nav surface for one data source, and no route claimed by
  // two hubs. There is no hidden-duplicate example left, because both of them
  // were resolved the same way — by deletion, which is the other way this rule
  // can be satisfied.
  //
  // /operations/webhooks was the first: the same event-subscription data as
  // Settings ▸ Connectors. FE #130 deleted the page rather than leaving a hidden
  // duplicate, and its URL 308s to /settings?tab=connectors.
  //
  // /operations/connectors was the second, deleted 2026-08-13. It claimed to be
  // a cross-supplier delivery-channel view, but it was read-only with no
  // endpoint behind it and no delivery-config signal to render — the suppliers
  // list prints each supplier's real channel and the supplier Delivery tab owns
  // the config. Its URL 308s to /library/suppliers.
  //
  // /connections was listed here as the second example — "versioned supplier
  // setup belongs to the supplier Changes tab" — and it was NOT a duplicate.
  // The supplier tab is one supplier's version history; this is the
  // cross-supplier list, and its detail page is the only surface in the product
  // that mounts the draft-mapping editor (ConnectionDetail.tsx:272,
  // MapperWorkbench variant="connection"). Hiding it did not de-duplicate a
  // surface, it removed the only door to a capability. It is visible now.
  it("offers one data source exactly one visible nav surface", () => {
    const claimed = new Map<string, HubKey>();
    for (const hub of HUBS) {
      for (const tab of HUB_TABS[hub]) {
        expect(claimed.get(tab.href), `${tab.href} is claimed by two hubs`).toBeUndefined();
        claimed.set(tab.href, hub);
      }
    }
    // Event subscriptions belong to Settings, and the duplicate that used to sit
    // in this hub was deleted rather than hidden — so it is gone from BOTH.
    expect(visibleHubTabs("activity").some((t) => t.href === "/operations/webhooks")).toBe(false);
    expect(HUB_TABS.activity.some((t) => t.href === "/operations/webhooks")).toBe(false);
  });
});

describe("hubTooltip — lists a hub's VISIBLE tabs (derived from HUB_TABS, can't drift)", () => {
  const byLabel = Object.fromEntries(
    allItems(buildVisibleNav("Suppliers", true)).map((i) => [i.label, i]),
  );
  it("describes each hub with its visible tab labels", () => {
    expect(hubTooltip(byLabel["Documents"])).toBe("Orders");
    expect(hubTooltip(byLabel["Activity"])).toBe("Overview · Deliveries · Issues");
  });
  // The regression this guards is "a hidden tab leaked into the hub tooltip". The old
  // shape asserted that inside `HUB_TABS[hub].filter((t) => t.hidden)` and nothing else —
  // so dropping `hidden: true` from every tab, the exact way the leak happens, emptied the
  // loop and the test still passed. It was ALREADY vacuous for the `orders` hub, which has
  // no hidden entry at all: one third of the iterations asserted nothing.
  //
  // So the expected hidden set is now declared, compared, and counted. Losing a `hidden`
  // flag fails on the table comparison; leaking one into a tooltip fails on the tooltip
  // assertion; a loop that runs zero times fails on the count.
  const EXPECTED_HIDDEN: Record<HubKey, string[]> = {
    orders: [],
    // "Notifications" (/operations/webhooks) is no longer here: the page was
    // DELETED, not unhidden. Removing it from this table is the deliberate half
    // of that change — leaving it would have failed on the comparison below.
    activity: ["System status"],
  };

  it("still has hidden entries to hide — the flag is what makes the nav four words wide", () => {
    for (const hub of HUBS) {
      expect(
        HUB_TABS[hub].filter((t) => t.hidden).map((t) => t.label),
        `${hub}'s hidden entries drifted — update EXPECTED_HIDDEN deliberately, or restore the flag`,
      ).toEqual(EXPECTED_HIDDEN[hub]);
    }
    // Every hub key is accounted for, so a NEW hub cannot slip in unexamined.
    expect(Object.keys(EXPECTED_HIDDEN).sort()).toEqual([...HUBS].sort());
  });

  it("never names a hidden entry (it is reachable, not switchable)", () => {
    let asserted = 0;
    for (const hub of HUBS) {
      const item = Object.values(byLabel).find((i) => i.hub === hub)!;
      const tip = hubTooltip(item)!;
      expect(tip, `${hub} has no tooltip to check`).toBeTruthy();
      for (const label of EXPECTED_HIDDEN[hub]) {
        expect(tip, `${hub} tooltip must not name hidden "${label}"`).not.toContain(label);
        asserted++;
      }
    }
    // One hidden entry across the hubs left (the Suppliers hub took its hidden
    // entry with it). If this drops to 0 the loop above proved nothing, whatever
    // colour the run reported.
    expect(asserted, "the hidden-entry loop ran zero assertions").toBe(1);
  });
  it("returns undefined for non-hub items", () => {
    expect(hubTooltip(byLabel["Settings"])).toBeUndefined();
    expect(hubTooltip(byLabel["Admin"])).toBeUndefined();
  });
});

describe("buildVisibleNav — gates", () => {
  it("hides Admin for non-admins", () => {
    const items = allItems(buildVisibleNav("Suppliers", false));
    expect(items.some((i) => i.href === "/admin")).toBe(false);
  });

  it("never puts /inbound in the nav — INBOUND_ENABLED now gates two Orders TABS", () => {
    const items = allItems(buildVisibleNav("Suppliers", true));
    expect(items.some((i) => i.href.startsWith("/inbound"))).toBe(false);
    // Off: reachable through the Orders hub, absent from its strip.
    expect(visibleHubTabs("orders", { inboundEnabled: false }).map((t) => t.href))
      .toEqual(["/inbox"]);
    expect(hubForPath("/inbound/invoices")).toBe("orders");
    expect(hubForPath("/inbound/asns")).toBe("orders");
    // On: two extra visible tabs, same hub, same hrefs.
    expect(visibleHubTabs("orders", { inboundEnabled: true }).map((t) => t.href))
      .toEqual(["/inbox", "/inbound/invoices", "/inbound/asns"]);
  });
});

describe("buildVisibleNav — document engine", () => {
  it("on: the five new-product items, in order", () => {
    const items = buildVisibleNav("Suppliers", false, true).main[0].items;
    expect(items.map((i) => [i.label, i.href])).toEqual([
      ["Documents", "/documents"],
      ["Flows", "/flows"],
      ["Lookups", "/lookups"],
      ["Activity", "/operations/log"],
      ["Settings", "/settings"],
    ]);
    expect(items.some((i) => i.hub || i.badgeKey)).toBe(false);
  });

  it("off: today's list, without Flows or Lookups", () => {
    const labels = buildVisibleNav("Suppliers", false, false).main[0].items.map((i) => i.label);
    expect(labels).toEqual(["Documents", "Activity", "Settings"]);
  });
});
