import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HubTabs, HUB_TABS, hubForPath, hubShowsTabs, visibleHubTabs } from "./HubTabs";

// #22 follow-up: the suppliers page hides its visible title because "the topbar
// names the page" — but the hub tab label was static "Suppliers", so an inbound
// org (relabeled "Customers" everywhere else) lost the only surface carrying
// the correct word, most visibly on mobile where the hub strip is the sole page
// label. HubTabs accepts the direction-aware counterpartyPlural and applies the
// SAME display-only relabel buildVisibleNav applies to the Suppliers item.

let mockPath = "/library/suppliers";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
}));

afterEach(() => {
  cleanup();
  mockPath = "/library/suppliers";
});

describe("HubTabs — direction-aware Suppliers tab relabel", () => {
  test("without counterpartyPlural the suppliers tabs keep their canonical labels", () => {
    render(<HubTabs hub="suppliers" variant="topbar" />);
    expect(screen.getByRole("link", { name: "Suppliers" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Item codes" })).toBeTruthy();
    // No "Rules"/"Output layouts" tab — FE #47 retired both routes.
    expect(screen.queryByRole("link", { name: "Rules" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Output layouts" })).toBeNull();
  });

  test("outbound ('Suppliers') is a no-op relabel", () => {
    render(<HubTabs hub="suppliers" variant="topbar" counterpartyPlural="Suppliers" />);
    expect(screen.getByRole("link", { name: "Suppliers" })).toBeTruthy();
  });

  test("inbound ('Customers') relabels ONLY the suppliers tab; href and active state are unchanged", () => {
    render(<HubTabs hub="suppliers" variant="topbar" counterpartyPlural="Customers" />);
    const customers = screen.getByRole("link", { name: "Customers" });
    expect(customers.getAttribute("href")).toBe("/library/suppliers");
    // Active state keys off the route, not the label — the relabel keeps it.
    expect(customers.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("Suppliers")).toBeNull();
    // The sibling tabs are untouched.
    expect(screen.getByRole("link", { name: "Item codes" })).toBeTruthy();
  });

  test("counts stay keyed by the canonical label even when relabeled", () => {
    render(
      <HubTabs
        hub="suppliers"
        variant="topbar"
        counterpartyPlural="Customers"
        counts={{ Suppliers: 4 }}
      />,
    );
    // The count badge renders inside the relabeled tab.
    const customers = screen.getByRole("link", { name: /Customers/ });
    expect(customers.textContent).toContain("4");
  });
});

// FE-2 — a hub with a single VISIBLE tab has nowhere to switch TO. Rendering its
// strip puts one tab under the top nav item that already names the same page (the
// founder-reported double navbar). No shipped hub has one tab today; this pins
// the guard so a future consolidation can't reintroduce the duplicate.
describe("HubTabs — a hub with nothing to switch to renders no strip", () => {
  const original = HUB_TABS.activity;
  afterEach(() => {
    HUB_TABS.activity = original;
  });

  test("renders nothing when the hub exposes a single visible tab", () => {
    mockPath = "/bridge";
    HUB_TABS.activity = [original[0]];
    const { container } = render(<HubTabs hub="activity" variant="topbar" />);
    expect(hubShowsTabs("activity")).toBe(false);
    expect(container.querySelector('nav[aria-label="Section"]')).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  test("a hub whose only siblings are HIDDEN also renders no strip", () => {
    mockPath = "/bridge";
    HUB_TABS.activity = [
      original[0],
      { label: "System status", href: "/operations/health", hidden: true },
    ];
    const { container } = render(<HubTabs hub="activity" variant="topbar" />);
    expect(hubShowsTabs("activity")).toBe(false);
    expect(container.querySelector('nav[aria-label="Section"]')).toBeNull();
  });

  test("still renders the strip at two visible tabs", () => {
    mockPath = "/bridge";
    const { container } = render(<HubTabs hub="activity" variant="topbar" />);
    expect(container.querySelector('nav[aria-label="Section"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Deliveries" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Issues" })).toBeTruthy();
  });
});

// WP-26 — the `hidden` flag is what lets the nav shrink to four words without
// stranding an advanced surface. A hidden entry is claimed by hubForPath (so the
// nav item lights, the reachability guard passes, and the route resolves) but is
// never printed in the strip a coordinator has to read past.
describe("HubTabs — hidden entries are reachable, not switchable", () => {
  // The Orders hub has no hidden entry any more: its only one was /drafts, which
  // FE #47 retired behind a permanent redirect to /inbox.
  const HIDDEN = {
    suppliers: ["/library/standards", "/connections", "/operations/connectors"],
    activity: ["/operations/health", "/operations/webhooks"],
  } as const;

  test("every hidden entry is claimed by its hub and absent from the rendered strip", () => {
    for (const hub of Object.keys(HIDDEN) as (keyof typeof HIDDEN)[]) {
      const routes = HIDDEN[hub];
      for (const route of routes) {
        expect(hubForPath(route), `${route} belongs to ${hub}`).toBe(hub);
        expect(
          visibleHubTabs(hub).some((t) => t.href === route),
          `${route} must not be a visible tab`,
        ).toBe(false);
      }
      cleanup();
      mockPath = routes[0];
      const { container } = render(<HubTabs hub={hub} variant="topbar" />);
      const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
      for (const route of routes) {
        expect(hrefs, `${hub} strip must not link ${route}`).not.toContain(route);
      }
    }
  });

  test("a hidden entry's sub-routes are claimed too (/connections/:id)", () => {
    expect(hubForPath("/connections/9c0f")).toBe("suppliers");
  });

  test("the strip still renders on a hidden route so the user can leave it", () => {
    mockPath = "/operations/health";
    render(<HubTabs hub="activity" variant="topbar" />);
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
    // …and no tab claims to be the current page, because none of them is.
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });
});
