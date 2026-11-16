import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";

let mockPath = "/documents";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@clerk/nextjs", () => ({ useOrganization: () => ({ organization: { id: "org_1", name: "Acme" } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }), useQueryClient: () => ({ getQueryData: () => undefined }) }));
vi.mock("@/lib/api-client", () => ({ isApiMockMode: false, checkAdminAccess: vi.fn(), getBillingStatus: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("./CommandPalette", () => ({ CommandPalette: () => <div data-testid="palette" /> }));
vi.mock("./OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("./UserChipMenu", () => ({ UserChipMenu: () => null }));

import { BridgeTopbar } from "./BridgeTopbar";
import { setSingleKeys } from "@/lib/shortcuts";

afterEach(() => { cleanup(); mockPath = "/documents"; localStorage.clear(); });

describe("BridgeTopbar", () => {
  it("draws no breadcrumb and no page-name row: the page's own title says where you are", () => {
    mockPath = "/flows/a8c18df7-dec8-4a1b-9c2d-1f2e3a4b5c6d";
    render(<BridgeTopbar />);
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(document.querySelector("header")!.querySelectorAll("nav")).toHaveLength(1);
  });

  it("is one row: one Main navigation with three places, and Upload", () => {
    // A page the bar does not carry lights the place it is reached from.
    for (const [path, lit] of [["/lookups", "Flows"], ["/lookups/l1", "Flows"], ["/operations/log", "Documents"]]) {
      mockPath = path;
      render(<BridgeTopbar />);
      const main = screen.getByRole("navigation", { name: "Main" });
      expect(within(main).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent), path).toEqual([lit]);
      cleanup();
    }
    mockPath = "/flows";
    render(<BridgeTopbar />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Documents", "/documents"], ["Flows", "/flows"], ["Settings", "/settings"],
    ]);
    expect(within(nav).getByRole("link", { name: "Flows" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Upload a document" })).toHaveAttribute("href", "/upload");
    const menu = screen.getByRole("button", { name: "Open navigation" });
    expect(menu).toHaveAttribute("aria-haspopup", "dialog");
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("header")!.querySelectorAll("nav")).toHaveLength(1);
  });

  it("? opens the shortcuts list and Escape closes it with focus back; typed in a field, or with its switch off, it does nothing", async () => {
    render(<BridgeTopbar />);
    const search = screen.getByRole("button", { name: "Search" });
    search.focus();
    fireEvent.keyDown(search, { key: "?", shiftKey: true });
    const region = screen.getByRole("region", { name: "Keyboard shortcuts" });
    await waitFor(() => expect(within(region).getByRole("button", { name: "Close keyboard shortcuts" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Keyboard shortcuts" })).toBeNull();
    expect(search).toHaveFocus();

    const box = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(box, { key: "?", shiftKey: true });
    expect(screen.queryByRole("region", { name: "Keyboard shortcuts" })).toBeNull();
    box.remove();

    setSingleKeys(false);
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    expect(screen.queryByRole("region", { name: "Keyboard shortcuts" })).toBeNull();

    expect(screen.queryByTestId("palette")).toBeNull();
    fireEvent.keyDown(document.body, { key: "k", code: "KeyK", ctrlKey: true });
    expect(screen.getByTestId("palette")).toBeInTheDocument();
  });
});
