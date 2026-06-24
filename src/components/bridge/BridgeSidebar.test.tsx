import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// STRUCT-1 — "Connections" was removed from the launch sidebar (the /connections
// routes still resolve directly; the version-history view now lives on the
// supplier page). This guards that the launch nav surfaces NO /connections link
// while keeping the core entries (Suppliers, etc.) intact.

vi.mock("next/navigation", () => ({
  usePathname: () => "/bridge",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Acme" } }),
}));

// Both useQuery calls (admin-access probe + orders summary + billing) degrade to
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

import { BridgeSidebar } from "./BridgeSidebar";
import { LAUNCH_CORE_ONLY } from "@/lib/launch-flags";

afterEach(cleanup);

describe("BridgeSidebar — launch nav (STRUCT-1)", () => {
  it("is in launch-core-only mode by default (no NEXT_PUBLIC_LAUNCH_FULL_NAV)", () => {
    // Sanity: the assertions below only mean something in the narrow launch nav.
    expect(LAUNCH_CORE_ONLY).toBe(true);
  });

  it("renders NO nav link to /connections", () => {
    const { container } = render(<BridgeSidebar />);
    expect(container.querySelector('a[href="/connections"]')).toBeNull();
    // And there's no "Connections" nav label either.
    expect(screen.queryByText("Connections")).toBeNull();
  });

  it("still renders the core Suppliers entry", () => {
    render(<BridgeSidebar />);
    expect(screen.getByRole("link", { name: /Suppliers/i })).toBeInTheDocument();
  });
});
