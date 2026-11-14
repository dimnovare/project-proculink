import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

let mockPath = "/documents";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@clerk/nextjs", () => ({ useOrganization: () => ({ organization: { id: "org_1", name: "Acme" } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }), useQueryClient: () => ({ getQueryData: () => undefined }) }));
vi.mock("@/lib/api-client", () => ({ isApiMockMode: false, checkAdminAccess: vi.fn(), getBillingStatus: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("./CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("./HelpSlideover", () => ({ HelpSlideover: () => null }));
vi.mock("./OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("./UserChipMenu", () => ({ UserChipMenu: () => null }));

import { BridgeTopbar } from "./BridgeTopbar";

afterEach(() => { cleanup(); mockPath = "/documents"; });

describe("BridgeTopbar", () => {
  it("draws no breadcrumb and no page-name row: the page's own title says where you are", () => {
    mockPath = "/flows/a8c18df7-dec8-4a1b-9c2d-1f2e3a4b5c6d";
    render(<BridgeTopbar />);
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(document.querySelector("header")!.querySelectorAll("nav")).toHaveLength(1);
  });
});
