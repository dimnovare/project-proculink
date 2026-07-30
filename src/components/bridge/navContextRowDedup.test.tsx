import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

// FE-2 — double navbar (founder screenshot, 2026-07-24).
//
// On a top-level page such as Dashboard the topbar rendered TWO stacked bars
// naming the same thing: the primary nav row with "Dashboard" active, and
// directly beneath it a context row whose entire content was a lone unlinked
// "Dashboard" crumb. That crumb links nowhere, so it adds no navigation — it
// only repeats the active nav item, reading as a redundant second navbar.
//
// The context row is now suppressed exactly where the primary nav row is
// visible (md+). Below md the primary nav row is hidden (hamburger drawer), so
// the row is kept there — it carries the only "where am I" label.

let mockPath = "/bridge";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { id: "org_1", name: "Acme" } }),
}));

// All useQuery calls (admin probe, orders summary, billing) degrade to
// undefined; the crumb cache lookups return undefined. Deterministic render.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ getQueryData: () => undefined }),
}));

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: { getOrders: vi.fn(), getOrdersSummary: vi.fn() },
  checkAdminAccess: vi.fn(),
  getBillingStatus: vi.fn(),
}));

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({ labels: { counterpartyPlural: "Suppliers" } }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

// Collaborators that own their own chrome — outside this contract.
vi.mock("./CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("./HelpSlideover", () => ({ HelpSlideover: () => null }));
vi.mock("./SetupProgressChip", () => ({ SetupProgressChip: () => null }));
vi.mock("./OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("./UserChipMenu", () => ({ UserChipMenu: () => null }));

import { BridgeTopbar } from "./BridgeTopbar";

afterEach(() => {
  cleanup();
  mockPath = "/bridge";
});

/**
 * The context row (row 3) — the element that follows the primary nav row.
 * Returns null when the topbar renders no context row at all (the 2px
 * link-spine is what follows in that case).
 */
function contextRow(): HTMLElement | null {
  const primary = document.querySelector('nav[aria-label="Primary"]');
  const next = primary?.nextElementSibling as HTMLElement | null;
  if (!next || next.classList.contains("link-spine")) return null;
  return next;
}

/** The row is hidden from the `md` breakpoint up — where the nav row shows. */
function hiddenAtDesktop(row: HTMLElement): boolean {
  return row.classList.contains("md:hidden");
}

describe("BridgeTopbar context row — no second navbar under the primary nav", () => {
  it("hides the row at md+ on Dashboard, whose lone crumb repeats the active nav item", () => {
    render(<BridgeTopbar />);
    const row = contextRow();
    expect(row).not.toBeNull();
    expect(hiddenAtDesktop(row!)).toBe(true);
  });

  it("keeps the Dashboard label in the row for the < md band (no primary nav there)", () => {
    render(<BridgeTopbar />);
    // Both the sm+ breadcrumb and the mobile page label still name the page.
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
  });

  it("hides the row at md+ on Inbox (same lone-crumb shape)", () => {
    mockPath = "/inbox";
    render(<BridgeTopbar />);
    expect(hiddenAtDesktop(contextRow()!)).toBe(true);
  });

  it("keeps the row at md+ when the trail has an ancestor crumb (Admin / Guides)", () => {
    mockPath = "/admin/guides";
    render(<BridgeTopbar />);
    const row = contextRow();
    expect(row).not.toBeNull();
    expect(hiddenAtDesktop(row!)).toBe(false);
    // The ancestor crumb is real navigation the nav row does not offer.
    expect(screen.getByText("Admin")).toBeTruthy();
  });

  it("keeps the row at md+ on a hub route — the tab strip is real navigation", () => {
    mockPath = "/library/suppliers";
    render(<BridgeTopbar />);
    const row = contextRow();
    expect(row).not.toBeNull();
    expect(hiddenAtDesktop(row!)).toBe(false);
    // The hub strip offers siblings to switch to, so it is not a duplicate.
    expect(document.querySelector('nav[aria-label="Section"]')).not.toBeNull();
  });

  it("keeps the row at md+ on a detail route (crumb trail is a real path)", () => {
    mockPath = "/library/suppliers/a8c18df7-dec8-4a1b-9c2d-1f2e3a4b5c6d";
    render(<BridgeTopbar />);
    expect(hiddenAtDesktop(contextRow()!)).toBe(false);
  });
});
