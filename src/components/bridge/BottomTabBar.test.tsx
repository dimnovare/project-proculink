import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { BottomTabBar, isFullScreenStep, needsYouBadge } from "./BottomTabBar";

let mockPath: string | null = "/documents";
const needsTotal = vi.hoisted(() => ({ n: 3 }));
vi.mock("next/navigation", () => ({ usePathname: () => mockPath, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("@/lib/api-client", () => ({ getBillingStatus: vi.fn(), checkAdminAccess: vi.fn() }));
vi.mock("@/lib/api/documents", () => ({
  listFlows: () => Promise.resolve([{ id: "f-1", name: "Flow" }]),
  listDocumentPage: () => Promise.resolve({ items: [], totalCount: needsTotal.n, page: 1, pageSize: 1 }),
}));

const renderBar = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("BottomTabBar", () => {
  it("offers Documents, Flows, Add a document, Activity and More, and marks where you are", () => {
    mockPath = "/flows/f-1";
    const onMore = vi.fn();
    renderBar(<BottomTabBar onMore={onMore} moreOpen={false} />);
    const bar = screen.getByRole("navigation", { name: "Main" });
    expect(within(bar).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/documents", "/flows", "/upload", "/operations/log"]);
    expect(within(bar).getByRole("link", { name: "Flows" })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: "Add a document" })).toBeInTheDocument();
    const more = within(bar).getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it("shows the needs-you count only when it is known", async () => {
    expect([needsYouBadge(undefined), needsYouBadge(0), needsYouBadge(1), needsYouBadge(99), needsYouBadge(120)]).toEqual([null, null, "1", "99", "99+"]);
    mockPath = "/flows";
    renderBar(<BottomTabBar onMore={() => {}} moreOpen={false} />);
    const bar = within(screen.getByRole("navigation", { name: "Main" }));
    expect(await bar.findByRole("link", { name: "Documents, 3 need you" })).toHaveAttribute("href", "/documents");
    expect(bar.getByRole("link", { name: "Flows" })).toBeInTheDocument(); // the count is on Documents only
    for (const [n, name, shown] of [[1, "Documents, 1 needs you", "1"], [120, "Documents, 120 need you", "99+"]] as const) {
      needsTotal.n = n;
      const r = renderBar(<BottomTabBar onMore={() => {}} moreOpen={false} />);
      const link = await within(r.container).findByRole("link", { name });
      expect(link).toHaveTextContent(new RegExp(`^${shown.replace("+", "\\+")}Documents$`));
      r.unmount();
    }
    needsTotal.n = 3;
  });

  it("steps aside on full-screen steps", () => {
    for (const p of ["/flows/new", "/flows/f-1/documents/d-1", "/flows/f-1/outputs/o-1/advanced"]) expect(isFullScreenStep(p)).toBe(true);
    for (const p of ["/documents", "/flows", "/flows/f-1", "/lookups/l-1", "/settings", null]) expect(isFullScreenStep(p)).toBe(false);
    mockPath = "/flows/f-1/documents/d-1";
    const { container } = renderBar(<BottomTabBar onMore={() => {}} moreOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
