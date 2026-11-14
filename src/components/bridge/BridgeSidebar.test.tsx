import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Nav guard for the sidebar (the mobile drawer): its destinations, the admin gate, active state.

let mockPath = "/documents";
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
  getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth" }),
  checkAdminAccess: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import { BridgeSidebar, buildVisibleNav, isItemActive, PINNED_ACTION_HREF } from "./BridgeSidebar";

afterEach(() => {
  cleanup();
  mockPath = "/documents";
});

// The order product's nav (Orders hub, review badge, hub first-tab hrefs) went
// with the order screens on 2026-11-13. One nav is left: the document tool's.
describe("BridgeSidebar — the document tool's nav", () => {
  it("lists the five destinations, in order", () => {
    expect(buildVisibleNav(false).main[0].items.map((i) => [i.label, i.href])).toEqual([
      ["Documents", "/documents"],
      ["Flows", "/flows"],
      ["Lookups", "/lookups"],
      ["Activity", "/operations/log"],
      ["Settings", "/settings"],
    ]);
  });

  it("shows Admin to admins only", () => {
    const hasAdmin = (isAdmin: boolean) =>
      buildVisibleNav(isAdmin).tail.some((i) => i.href === "/admin");
    expect(hasAdmin(false)).toBe(false);
    expect(hasAdmin(true)).toBe(true);
  });

  it("renders the links, the pinned upload, and marks a nested route active", () => {
    mockPath = "/flows/f-1";
    render(<BridgeSidebar />);
    expect(screen.getByRole("link", { name: /^Documents/i })).toHaveAttribute("href", "/documents");
    expect(screen.getByRole("link", { name: /Upload document/i })).toHaveAttribute("href", PINNED_ACTION_HREF);
    expect(screen.getByRole("link", { name: /^Flows/i })).toHaveAttribute("aria-current", "page");
    expect(isItemActive("/flowsx", buildVisibleNav(false).main[0].items[1])).toBe(false);
  });
});
