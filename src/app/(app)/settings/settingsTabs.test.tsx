import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const nav = vi.hoisted(() => ({ search: "tab=billing&open=dest-1", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/settings",
}));
vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: undefined }),
  useUser: () => ({ user: undefined }),
  useClerk: () => ({}),
}));
vi.mock("@/components/bridge/BillingSection", () => ({ BillingSection: () => <p>billing here</p> }));
vi.mock("@/components/destinations/DestinationsSection", () => ({ DestinationsSection: () => <p>destinations here</p> }));
vi.mock("@/lib/api-client", async (o) => ({
  ...(await o<typeof import("@/lib/api-client")>()),
  getBillingStatus: vi.fn(() => new Promise(() => {})),
  getApiKeys: vi.fn().mockResolvedValue([]),
}));

import SettingsPage from "./page";

describe("Settings tabs", () => {
  it("the address picks the tab, and a press replaces the address with that tab alone", () => {
    render(<QueryClientProvider client={new QueryClient()}><SettingsPage /></QueryClientProvider>);
    const tabs = within(screen.getByRole("navigation", { name: "Settings sections" }));
    expect(tabs.getAllByRole("button").map((b) => b.textContent)).toEqual(["Workspace", "Destinations", "Plan & billing", "API keys"]);
    expect(tabs.getByRole("button", { name: "Plan & billing" })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("button", { name: "Workspace" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("billing here")).toBeTruthy();
    fireEvent.click(tabs.getByRole("button", { name: "API keys" }));
    expect(nav.replace).toHaveBeenCalledWith("/settings?tab=api", { scroll: false });
  });
});
