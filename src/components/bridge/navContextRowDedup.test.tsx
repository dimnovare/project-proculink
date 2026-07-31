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
// The context row is suppressed exactly where the primary nav row is visible
// (md+) AND the row would carry only that duplicate. Below md the primary nav
// row is hidden (hamburger drawer), so the row is kept there — it carries the
// only "where am I" label.
//
// WP-26: under the four-destination nav (Orders · Suppliers · Activity ·
// Settings) /bridge and /inbox became hub routes, so their context row now
// carries a real tab strip instead of a dead crumb — the case this file already
// accepted for /library/suppliers. The contract that must not weaken is the one
// the founder actually reported, so it is now asserted directly on every hub
// route: the context row NEVER re-prints the word the active nav item above it
// already shows.

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

/** The active item in the primary nav row (the word Row 1 is already showing). */
function activeNavLabel(): string | null {
  const primary = document.querySelector('nav[aria-label="Primary"]');
  return primary?.querySelector('[aria-current="page"]')?.textContent?.trim() ?? null;
}

describe("BridgeTopbar context row — no second navbar under the primary nav", () => {
  it("keeps the row at md+ on Activity ▸ Overview, and it is a tab strip, not a dead crumb", () => {
    render(<BridgeTopbar />);
    const row = contextRow();
    expect(row).not.toBeNull();
    expect(hiddenAtDesktop(row!)).toBe(false);
    // Real navigation: three siblings to switch to.
    expect(row!.querySelector('nav[aria-label="Section"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Deliveries" })).toBeTruthy();
  });

  it("names the page in the row for the < md band (no primary nav there)", () => {
    render(<BridgeTopbar />);
    // The hub strip renders on mobile too, and its active tab is the page name.
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the row at md+ on Orders, as a tab strip", () => {
    mockPath = "/inbox";
    render(<BridgeTopbar />);
    const row = contextRow();
    expect(hiddenAtDesktop(row!)).toBe(false);
    expect(row!.querySelector('nav[aria-label="Section"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Buyers" })).toBeTruthy();
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

  // WP-26 used /drafts as the off-strip example; FE #47 retired that route, so
  // the case is asserted on /operations/health — a hidden entry of the Activity
  // hub, and the exact example BridgeTopbar's useHubRow comment describes.
  it("keeps the row at md+ on an off-strip route, and names it (System status)", () => {
    mockPath = "/operations/health";
    render(<BridgeTopbar />);
    const row = contextRow();
    expect(row).not.toBeNull();
    expect(hiddenAtDesktop(row!)).toBe(false);
    // /operations/health is a hidden entry of the Activity hub: the strip lets
    // the user leave, and a tail crumb says where they are. No tab is current.
    const strip = row!.querySelector('nav[aria-label="Section"]')!;
    expect(strip.querySelector('a[href="/bridge"]')).not.toBeNull();
    expect(strip.querySelector('[aria-current="page"]')).toBeNull();
    expect(screen.getAllByText("System status").length).toBeGreaterThan(0);
    // "Activity" is the active nav item one row above — the row must not repeat
    // it as an unlinked crumb. That container word is what the restructure
    // retired from the context row.
    const deadCrumbs = [...row!.querySelectorAll("span")]
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent?.trim());
    expect(deadCrumbs).not.toContain("Activity");
  });

  // The defect the founder actually reported, asserted directly: whatever Row 1
  // highlights must not be printed again in the row beneath it.
  it("never re-prints the active nav item's own word in the context row", () => {
    for (const path of [
      "/bridge", "/inbox", "/library/suppliers", "/library/mappings",
      "/operations/log", "/operations/health", "/operations/exceptions",
    ]) {
      cleanup();
      mockPath = path;
      render(<BridgeTopbar />);
      const active = activeNavLabel();
      expect(active, `${path} must light a primary nav item`).not.toBeNull();
      const row = contextRow();
      if (!row) continue;
      // The active tab may legitimately repeat the hub word (Orders ▸ Orders is
      // the queue itself) — but only as a LINK. An unlinked crumb repeating it is
      // the duplicate.
      const deadCrumbs = [...row.querySelectorAll("span")]
        .filter((el) => el.children.length === 0)
        .map((el) => el.textContent?.trim());
      expect(deadCrumbs, `${path} re-prints "${active}" as a dead crumb`).not.toContain(active);
    }
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
