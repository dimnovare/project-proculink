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
// The order hubs' tab strips went with the order screens (2026-11-13). The
// contract that must not weaken is the one the founder actually reported, so it
// is asserted directly on every primary nav route: at md+ the context row NEVER
// re-prints the word the active nav item above it already shows.

let mockPath = "/documents";

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

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

// Collaborators that own their own chrome — outside this contract.
vi.mock("./CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("./HelpSlideover", () => ({ HelpSlideover: () => null }));
vi.mock("./OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("./UserChipMenu", () => ({ UserChipMenu: () => null }));

import { BridgeTopbar } from "./BridgeTopbar";

afterEach(() => {
  cleanup();
  mockPath = "/documents";
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
  it("keeps the row at md+ when the trail has an ancestor crumb (Admin / Guides)", () => {
    mockPath = "/admin/guides";
    render(<BridgeTopbar />);
    const row = contextRow();
    expect(row).not.toBeNull();
    expect(hiddenAtDesktop(row!)).toBe(false);
    // The ancestor crumb is real navigation the nav row does not offer.
    expect(screen.getByText("Admin")).toBeTruthy();
  });

  // The defect the founder actually reported, asserted directly: whatever Row 1
  // highlights must not be printed again in the row beneath it.
  it("never re-prints the active nav item's own word in the context row", () => {
    const PATHS = ["/documents", "/flows", "/lookups", "/operations/log", "/settings"];
    let asserted = 0;
    for (const path of PATHS) {
      cleanup();
      mockPath = path;
      render(<BridgeTopbar />);
      const active = activeNavLabel();
      expect(active, `${path} must light a primary nav item`).not.toBeNull();
      const row = contextRow();
      // Every path above renders a context row (at least the mobile-only crumb).
      // `if (!row) continue` used to stand here:
      // a route that stopped rendering its row skipped the dead-crumb assertion entirely
      // and reported green, which is the same silence as the defect passing.
      expect(row, `${path} rendered no context row to check`).not.toBeNull();
      // A row hidden at md+ is the < md fallback, where the primary nav is absent
      // and this crumb is the only "where am I" label.
      if (hiddenAtDesktop(row!)) { asserted++; continue; }
      // The active tab may legitimately repeat the hub word (Orders ▸ Orders is
      // the queue itself) — but only as a LINK. An unlinked crumb repeating it is
      // the duplicate.
      const deadCrumbs = [...row!.querySelectorAll("span")]
        .filter((el) => el.children.length === 0)
        .map((el) => el.textContent?.trim());
      expect(deadCrumbs, `${path} re-prints "${active}" as a dead crumb`).not.toContain(active);
      asserted++;
    }
    expect(asserted, "the path loop ran zero assertions").toBe(PATHS.length);
  });

  it("keeps the row at md+ on a detail route (crumb trail is a real path)", () => {
    mockPath = "/flows/a8c18df7-dec8-4a1b-9c2d-1f2e3a4b5c6d";
    render(<BridgeTopbar />);
    expect(hiddenAtDesktop(contextRow()!)).toBe(false);
  });
});
