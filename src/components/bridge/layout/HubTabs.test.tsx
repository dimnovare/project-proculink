import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HubTabs, HUB_TABS } from "./HubTabs";

// #22 follow-up: the suppliers page hides its visible title because "the topbar
// names the page" — but the hub tab label was static "Suppliers", so an inbound
// org (relabeled "Customers" everywhere else) lost the only surface carrying
// the correct word, most visibly on mobile where the hub strip is the sole page
// label. HubTabs now accepts the direction-aware counterpartyPlural and applies
// the SAME display-only relabel buildVisibleNav applies to the Partners item.

vi.mock("next/navigation", () => ({
  usePathname: () => "/library/suppliers",
}));

afterEach(cleanup);

describe("HubTabs — direction-aware Suppliers tab relabel", () => {
  test("without counterpartyPlural the partners tabs keep their canonical labels", () => {
    render(<HubTabs hub="partners" variant="topbar" />);
    expect(screen.getByRole("link", { name: "Suppliers" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Buyers" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connections" })).toBeTruthy();
  });

  test("outbound ('Suppliers') is a no-op relabel", () => {
    render(<HubTabs hub="partners" variant="topbar" counterpartyPlural="Suppliers" />);
    expect(screen.getByRole("link", { name: "Suppliers" })).toBeTruthy();
  });

  test("inbound ('Customers') relabels ONLY the suppliers tab; href and active state are unchanged", () => {
    render(<HubTabs hub="partners" variant="topbar" counterpartyPlural="Customers" />);
    const customers = screen.getByRole("link", { name: "Customers" });
    expect(customers.getAttribute("href")).toBe("/library/suppliers");
    // Active state keys off the route, not the label — the relabel keeps it.
    expect(customers.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("Suppliers")).toBeNull();
    // The sibling tabs are untouched.
    expect(screen.getByRole("link", { name: "Buyers" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connections" })).toBeTruthy();
  });

  test("counts stay keyed by the canonical label even when relabeled", () => {
    render(
      <HubTabs
        hub="partners"
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

// FE-2 — a hub with a single tab has nowhere to switch TO. Rendering its strip
// puts one tab under the top nav item that already names the same page (the
// founder-reported double navbar). No shipped hub has one tab today; this pins
// the guard so a future consolidation can't reintroduce the duplicate.
describe("HubTabs — a hub with nothing to switch to renders no strip", () => {
  const original = HUB_TABS.integrations;
  afterEach(() => {
    HUB_TABS.integrations = original;
  });

  test("renders nothing when the hub exposes a single tab", () => {
    HUB_TABS.integrations = [original[0]];
    const { container } = render(<HubTabs hub="integrations" variant="topbar" />);
    expect(container.querySelector('nav[aria-label="Section"]')).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  test("still renders the strip at two tabs", () => {
    const { container } = render(<HubTabs hub="integrations" variant="topbar" />);
    expect(container.querySelector('nav[aria-label="Section"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Connectors" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Webhooks" })).toBeTruthy();
  });
});
