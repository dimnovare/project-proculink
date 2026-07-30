import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// STRUCT-1 — nav-guard for the consolidated Claude Design v2 hub shell.
//
// The sidebar no longer lists every deep route; hub items (Partners,
// Rules & formats, Operations, Integrations, Inbound) each link to their FIRST
// tab route and light up for ANY route in their hub (hubForPath). This suite
// guards:
//   • the launch nav still surfaces NO /connections link (original STRUCT-1);
//   • the consolidated structure + hub → first-tab-route invariant;
//   • every legacy deep route keeps a reachable entry (hub item, direct item,
//     or the pinned Upload action);
//   • the gates: LAUNCH_CORE_ONLY, INBOUND_ENABLED, admin allowlist, and the
//     inbound counterparty relabel.

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

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

import {
  BridgeSidebar,
  buildVisibleNav,
  hubTooltip,
  isItemActive,
  PINNED_ACTION_HREF,
  type SidebarNavItem,
} from "./BridgeSidebar";
import { HUB_TABS, hubForPath, type HubKey } from "./layout/HubTabs";
import { LAUNCH_CORE_ONLY } from "@/lib/launch-flags";

afterEach(() => {
  cleanup();
  mockPath = "/bridge";
});

const FULL = { coreOnly: false, inboundEnabled: true };

/** Flatten the visible nav (main sections + tail) into one item list. */
function allItems(nav: ReturnType<typeof buildVisibleNav>): SidebarNavItem[] {
  return [...nav.main.flatMap((s) => s.items), ...nav.tail];
}

describe("BridgeSidebar — launch nav (STRUCT-1)", () => {
  it("is in launch-core-only mode by default (no NEXT_PUBLIC_LAUNCH_FULL_NAV)", () => {
    // Sanity: the rendered assertions below only mean something in the narrow launch nav.
    expect(LAUNCH_CORE_ONLY).toBe(true);
  });

  it("renders NO nav link to /connections (covered by the Partners hub instead)", () => {
    const { container } = render(<BridgeSidebar />);
    expect(container.querySelector('a[href="/connections"]')).toBeNull();
    // And there's no "Connections" nav label either.
    expect(screen.queryByText("Connections")).toBeNull();
  });

  it("renders the consolidated core entries with their hub first-tab hrefs", () => {
    render(<BridgeSidebar />);
    expect(screen.getByRole("link", { name: /Dashboard/i })).toHaveAttribute("href", "/bridge");
    expect(screen.getByRole("link", { name: /^Inbox/i })).toHaveAttribute("href", "/inbox");
    expect(screen.getByRole("link", { name: /Partners/i })).toHaveAttribute("href", "/library/suppliers");
    expect(screen.getByRole("link", { name: /^Operations/i })).toHaveAttribute("href", "/operations/health");
    expect(screen.getByRole("link", { name: /Help & support/i })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("link", { name: /Settings/i })).toHaveAttribute("href", "/settings");
    // Pinned primary action.
    expect(screen.getByRole("link", { name: /Upload order/i })).toHaveAttribute("href", PINNED_ACTION_HREF);
  });

  it("surfaces all five announced hubs in the launch nav (core-mode hub first-tabs)", () => {
    render(<BridgeSidebar />);
    // The five hub words the sidebar teaches all render in core mode now.
    expect(screen.getByRole("link", { name: /Partners/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Rules & formats/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Operations/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Integrations/i })).toBeTruthy();
  });

  it("keeps Drafts, Inbound and Admin out of the launch nav", () => {
    render(<BridgeSidebar />);
    expect(screen.queryByText("Drafts")).toBeNull();
    // Inbound is separately gated by INBOUND_ENABLED (default off), so it stays
    // hidden even though its first-tab href is now a core href.
    expect(screen.queryByText("Inbound")).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull(); // non-admin probe (mocked undefined)
  });

  it("lights the Operations hub item for a sibling tab route (/operations/exceptions)", () => {
    mockPath = "/operations/exceptions";
    render(<BridgeSidebar />);
    expect(screen.getByRole("link", { name: /^Operations/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Dashboard/i })).not.toHaveAttribute("aria-current");
  });

  it("lights the Partners hub item for a supplier detail route", () => {
    mockPath = "/library/suppliers/1b2c3d4e";
    render(<BridgeSidebar />);
    expect(screen.getByRole("link", { name: /Partners/i })).toHaveAttribute("aria-current", "page");
  });
});

describe("buildVisibleNav — consolidated structure (full nav)", () => {
  it("produces the v2 grouped structure in order", () => {
    const nav = buildVisibleNav("Suppliers", true, FULL);
    // The Operations GROUP header is displayed as "Monitor" (renamed so it no
    // longer collides with the "Operations" ITEM below it); routes untouched.
    expect(nav.main.map((s) => s.group ?? null)).toEqual([null, "Workbench", "Library", "Monitor"]);
    expect(nav.main.map((s) => s.items.map((i) => i.label))).toEqual([
      ["Dashboard"],
      ["Inbox", "Inbound"],
      ["Partners", "Rules & formats"],
      ["Operations", "Integrations"],
    ]);
    expect(nav.tail.map((i) => i.label)).toEqual(["Admin", "Help & support", "Settings"]);
  });

  it("hub items link to their hub's FIRST tab route", () => {
    const byLabel = Object.fromEntries(allItems(buildVisibleNav("Suppliers", true, FULL)).map((i) => [i.label, i]));
    expect(byLabel["Partners"].href).toBe("/library/suppliers");
    expect(byLabel["Rules & formats"].href).toBe("/library/mappings");
    expect(byLabel["Operations"].href).toBe("/operations/health");
    expect(byLabel["Integrations"].href).toBe("/operations/connectors");
    expect(byLabel["Inbound"].href).toBe("/inbound/invoices");
    // …and each hub item's own href resolves back to its hub (no drift).
    for (const item of Object.values(byLabel)) {
      if (item.hub) expect(hubForPath(item.href)).toBe(item.hub);
    }
  });

  // FE-2: a hub item promises siblings. If a hub ever shrank to one tab, its
  // topbar strip would render a single tab directly under the nav item naming
  // the same page — the founder-reported double navbar. HubTabs suppresses a
  // lone-tab strip; this keeps the nav structure itself honest.
  it("every hub exposes at least two tabs (a lone tab has nowhere to switch to)", () => {
    for (const key of Object.keys(HUB_TABS) as HubKey[]) {
      expect(HUB_TABS[key].length, `hub ${key}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the Inbox review badge wiring on the Inbox item", () => {
    const inbox = allItems(buildVisibleNav("Suppliers", true, FULL)).find((i) => i.href === "/inbox");
    expect(inbox?.badgeKey).toBe("review");
  });

  it("every legacy deep route keeps a reachable entry (hub item, direct item, or pinned action)", () => {
    const items = allItems(buildVisibleNav("Suppliers", true, FULL));
    const LEGACY_ROUTES = [
      "/bridge", "/upload", "/inbox",
      "/library/suppliers", "/library/buyers", "/connections",
      "/library/mappings", "/library/standards",
      "/operations/health", "/operations/exceptions", "/operations/log",
      "/operations/connectors", "/operations/webhooks",
      "/inbound/invoices", "/inbound/asns",
      "/admin", "/settings", "/help",
    ];
    for (const route of LEGACY_ROUTES) {
      const direct = items.some((i) => route === i.href || route.startsWith(i.href + "/"));
      const viaHub = items.some((i) => i.hub && hubForPath(route) === i.hub);
      const viaPinned = route === PINNED_ACTION_HREF;
      expect(direct || viaHub || viaPinned, `route ${route} must stay reachable`).toBe(true);
    }
  });

  it("hub active-state covers every tab route of the hub (isItemActive)", () => {
    const items = allItems(buildVisibleNav("Suppliers", true, FULL));
    const operations = items.find((i) => i.label === "Operations")!;
    for (const p of ["/operations/health", "/operations/exceptions", "/operations/log"]) {
      expect(isItemActive(p, operations), `${p} lights Operations`).toBe(true);
    }
    expect(isItemActive("/operations/connectors", operations)).toBe(false); // Integrations hub
    const partners = items.find((i) => i.label === "Partners")!;
    for (const p of ["/library/suppliers", "/library/buyers", "/connections", "/connections/abc"]) {
      expect(isItemActive(p, partners), `${p} lights Partners`).toBe(true);
    }
    const rules = items.find((i) => i.label === "Rules & formats")!;
    for (const p of ["/library/mappings", "/library/standards"]) {
      expect(isItemActive(p, rules), `${p} lights Rules & formats`).toBe(true);
    }
  });
});

describe("hubTooltip — lists a hub's tabs (derived from HUB_TABS, can't drift)", () => {
  const byLabel = Object.fromEntries(
    allItems(buildVisibleNav("Suppliers", true, FULL)).map((i) => [i.label, i]),
  );
  it("describes each hub with its tab labels", () => {
    expect(hubTooltip(byLabel["Partners"])).toBe("Suppliers · Buyers · Connections");
    expect(hubTooltip(byLabel["Rules & formats"])).toBe("Mappings · Standards");
    expect(hubTooltip(byLabel["Operations"])).toBe("System health · Exceptions · Delivery log");
    expect(hubTooltip(byLabel["Integrations"])).toBe("Connectors · Webhooks");
    expect(hubTooltip(byLabel["Inbound"])).toBe("Invoices · Shipping notices");
  });
  it("returns undefined for non-hub items", () => {
    expect(hubTooltip(byLabel["Dashboard"])).toBeUndefined();
    expect(hubTooltip(byLabel["Inbox"])).toBeUndefined();
  });
});

describe("buildVisibleNav — gates", () => {
  it("LAUNCH_CORE_ONLY keeps only core-href items (all five hub first-tabs + core)", () => {
    const items = allItems(buildVisibleNav("Suppliers", true, { coreOnly: true, inboundEnabled: false }));
    // Inbound's first-tab is a core href too, but stays filtered here because
    // inboundEnabled:false — so it is absent from this list.
    expect(items.map((i) => i.href).sort()).toEqual(
      [
        "/admin",
        "/bridge",
        "/help",
        "/inbox",
        "/library/mappings",
        "/library/suppliers",
        "/operations/connectors",
        "/operations/health",
        "/settings",
      ].sort(),
    );
  });

  it("reveals Inbound in core mode only when INBOUND_ENABLED (first-tab is a core href)", () => {
    const withInbound = allItems(buildVisibleNav("Suppliers", true, { coreOnly: true, inboundEnabled: true }));
    expect(withInbound.some((i) => i.href === "/inbound/invoices")).toBe(true);
    const withoutInbound = allItems(buildVisibleNav("Suppliers", true, { coreOnly: true, inboundEnabled: false }));
    expect(withoutInbound.some((i) => i.href.startsWith("/inbound"))).toBe(false);
  });

  it("hides Admin for non-admins", () => {
    const items = allItems(buildVisibleNav("Suppliers", false, FULL));
    expect(items.some((i) => i.href === "/admin")).toBe(false);
  });

  it("hides Inbound unless INBOUND_ENABLED (full nav alone must not reveal it)", () => {
    const items = allItems(buildVisibleNav("Suppliers", true, { coreOnly: false, inboundEnabled: false }));
    expect(items.some((i) => i.href.startsWith("/inbound"))).toBe(false);
  });

  it("relabels the Partners entry to the counterparty word for inbound orgs (display only)", () => {
    const items = allItems(buildVisibleNav("Customers", true, FULL));
    const partners = items.find((i) => i.href === "/library/suppliers");
    expect(partners?.label).toBe("Customers");
    // Route is unchanged — display-only relabel.
    expect(partners?.hub).toBe("partners");
  });
});
