import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HubTabs, HUB_TABS, hubForPath, hubShowsTabs, visibleHubTabs } from "./HubTabs";

// The hub strip: which tabs it prints, which routes it claims, and when it prints nothing.
// (The Suppliers hub and its direction-aware relabel went with the supplier screens.)

let mockPath = "/bridge";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
}));

let mockEngine: "on" | "off" | "unknown" = "unknown";
vi.mock("@/hooks/useDocumentEngine", () => ({ useDocumentEngine: () => mockEngine }));

afterEach(() => {
  cleanup();
  mockPath = "/bridge";
  mockEngine = "unknown";
});

test("engine-on orgs get no hub strip, and exact /documents never lights a legacy hub", () => {
  mockEngine = "on";
  const { container } = render(<HubTabs hub="activity" variant="topbar" />);
  expect(container.firstChild).toBeNull();
  expect(hubForPath("/documents")).toBeNull();
  expect(hubForPath("/documents/d1")).toBe("orders");
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
  // The Suppliers hub is gone with the supplier screens (/library/*, /connections):
  // those URLs 308 to the flow list; see src/lib/retired-routes.ts.
  // /operations/webhooks and /operations/connectors were deleted earlier and are
  // not hidden tabs either; they 308 as well.
  const HIDDEN = {
    activity: ["/operations/health"],
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

  test("the strip still renders on a hidden route so the user can leave it", () => {
    mockPath = "/operations/health";
    render(<HubTabs hub="activity" variant="topbar" />);
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
    // …and no tab claims to be the current page, because none of them is.
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });
});
