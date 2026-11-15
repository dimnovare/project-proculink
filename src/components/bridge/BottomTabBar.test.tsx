import { describe, it, expect, vi } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { UploadQueueProvider } from "@/components/flows/UploadQueue";
import { BottomTabBar, isFullScreenStep, needsYouBadge } from "./BottomTabBar";

let mockPath: string | null = "/documents";
const needsTotal = vi.hoisted(() => ({ n: 3 }));
const flowList = vi.hoisted(() => ({ items: [{ id: "f-1", name: "Flow" }] as object[] }));
const listFlowsCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("next/navigation", () => ({ usePathname: () => mockPath, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("@/lib/api-client", () => ({ getBillingStatus: vi.fn(), checkAdminAccess: vi.fn() }));
vi.mock("@/lib/api/documents", () => ({
  listFlows: () => { listFlowsCalls.n++; return Promise.resolve(flowList.items); },
  listDocumentPage: () => Promise.resolve({ items: [], totalCount: needsTotal.n, page: 1, pageSize: 1 }),
}));

const renderBar = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}><UploadQueueProvider>{ui}</UploadQueueProvider></QueryClientProvider>);

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

  it("Add opens the sheet when there is a flow, and goes to Upload when there is none", async () => {
    mockPath = "/documents";
    flowList.items = [];
    listFlowsCalls.n = 0;
    const r = renderBar(<BottomTabBar onMore={() => {}} moreOpen={false} />);
    await waitFor(() => expect(listFlowsCalls.n).toBe(1));
    await act(async () => {});                                             // the empty answer is applied before the check
    expect(within(r.container).getByRole("link", { name: "Add a document" })).toHaveAttribute("href", "/upload");
    r.unmount();
    flowList.items = [{ id: "f-1", name: "Supplier invoices", automation: "review", scansOn: true }];
    renderBar(<BottomTabBar onMore={() => {}} moreOpen={false} />);
    const add = await within(screen.getByRole("navigation", { name: "Main" })).findByRole("button", { name: "Add a document" });
    expect(add).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(add);
    expect(await screen.findByRole("dialog", { name: "Add a document" })).toBeInTheDocument();
    expect(add).toHaveAttribute("aria-expanded", "true");
    flowList.items = [{ id: "f-1", name: "Flow" }];
  });

  it("steps aside on full-screen steps", () => {
    for (const p of ["/flows/new", "/flows/f-1/documents/d-1", "/flows/f-1/outputs/o-1/advanced"]) expect(isFullScreenStep(p)).toBe(true);
    for (const p of ["/documents", "/flows", "/flows/f-1", "/lookups/l-1", "/settings", null]) expect(isFullScreenStep(p)).toBe(false);
    mockPath = "/flows/f-1/documents/d-1";
    const { container } = renderBar(<BottomTabBar onMore={() => {}} moreOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
