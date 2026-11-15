import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityEvent } from "@/lib/api/documents";
import { ActivityPage } from "./ActivityPage";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const search = vi.hoisted(() => ({ q: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search.q), useRouter: () => router }));
const { listActivity } = vi.hoisted(() => ({ listActivity: vi.fn() }));
vi.mock("@/lib/api/documents", () => ({ listActivity, listDestinations: vi.fn(), sendDocument: vi.fn() }));
const { saveBlob } = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock("@/lib/saveBlob", () => ({ saveBlob }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({
    memberships: { data: [{ publicUserData: { userId: "user_member_a", firstName: "Alex", lastName: "Example", identifier: "alex@example.test" } }] },
  }),
}));

const ev = (id: string, ts: string, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id, ts, action: "document.received", documentId: `doc-${id}`, flowId: "flow-1", documentName: `invoice-${id}.csv`,
  flowName: "Supplier invoices", source: "upload", actorId: null, startedAt: null, poNumber: null, payload: null, ...over,
});
const answer = (events: ActivityEvent[], total = events.length) =>
  listActivity.mockImplementation((q: { page: number; pageSize: number }) => Promise.resolve({ events, total, page: q.page, pageSize: q.pageSize }));

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => <QueryClientProvider client={client}><ActivityPage /></QueryClientProvider>;
  const r = render(ui());
  return { ...r, again: () => r.rerender(ui()) };
};
const panel = () => within(screen.getByRole("tabpanel", { name: "Activity, newest first" }));
const typeSearch = async (text: string) => {
  fireEvent.change(screen.getByLabelText("Search activity"), { target: { value: text } });
  await act(() => vi.advanceTimersByTimeAsync(300));
};

beforeEach(() => {
  vi.clearAllMocks();
  search.q = "";
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-06-01T09:30:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("ActivityPage", () => {
  it("asks the server for the tab and search, and groups by day", async () => {
    answer([ev("1", "2026-06-01T08:00:00Z", { actorId: "user_member_a" }), ev("2", "2026-05-31T15:00:00Z")]);
    const { again } = mount();
    await panel().findAllByTestId("activity-row");

    fireEvent.click(screen.getByRole("tab", { name: "Couldn't send" }));
    expect(router.replace).toHaveBeenCalledWith("/operations/log?show=failed");
    search.q = "show=failed";
    again();
    await waitFor(() => expect(listActivity).toHaveBeenLastCalledWith(expect.objectContaining({ actions: ["document.delivery_failed"], page: 1 })));

    listActivity.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("tab", { name: "Sent" }));
    expect(router.replace).toHaveBeenCalledWith("/operations/log?show=sent");
    search.q = "show=sent";
    again();
    expect(await panel().findByText("Loading activity…")).toBeInTheDocument();
    expect(panel().queryAllByTestId("activity-row")).toHaveLength(0);

    answer([ev("1", "2026-06-01T08:00:00Z", { actorId: "user_member_a" }), ev("2", "2026-05-31T15:00:00Z")]);
    await typeSearch("inv");
    expect(listActivity).toHaveBeenCalledWith(expect.objectContaining({ q: "inv", actions: ["document.delivered"], page: 1 }));
    const rows = await panel().findAllByTestId("activity-row");
    expect(panel().getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Today, 1 June", "Yesterday, 31 May"]);
    expect(within(rows[0]).getByText("Alex Example")).toBeInTheDocument();
  });

  it("empty, filtered-empty and failed states", async () => {
    answer([], 0);
    const first = mount();
    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload a document" })).toHaveAttribute("href", "/upload");
    expect(screen.queryByRole("button", { name: "Upload a document" })).toBeNull();

    await typeSearch("zzz");
    expect(await screen.findByText("Nothing matches “zzz”.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(screen.getByLabelText("Search activity")).toHaveValue("");
    first.unmount();

    vi.clearAllMocks();
    listActivity.mockRejectedValue(new Error("offline"));
    mount();
    expect(await screen.findByText("We couldn't load your activity. Nothing is lost. Check your connection and try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(listActivity).toHaveBeenCalledTimes(2));
  });

  it("a page past the end says so", async () => {
    search.q = "page=3";
    answer([], 61);
    const { again } = mount();
    expect(await screen.findByText("There is nothing on this page.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "First page" })).toHaveAttribute("href", "/operations/log");
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(listActivity).toHaveBeenCalledTimes(1);

    search.q = "page=2";
    answer(Array.from({ length: 11 }, (_, i) => ev(`p${i}`, "2026-06-01T08:00:00Z")), 61);
    again();
    expect(await screen.findByText("Showing 51 to 61 of 61.")).toBeInTheDocument();
    const pages = within(screen.getByRole("navigation", { name: "Activity pages" }));
    expect(pages.getByRole("link", { name: "Newer" })).toHaveAttribute("href", "/operations/log");
    expect(pages.queryByRole("link", { name: "Older" })).toBeNull();
  });

  it("Export walks the current tab and says when it stops early", async () => {
    search.q = "show=sent";
    listActivity.mockImplementation((q: { page: number; pageSize: number }) => Promise.resolve({
      events: Array.from({ length: q.pageSize }, (_, i) => ev(`${q.page}-${i}`, "2026-06-01T08:00:00Z", { action: "document.delivered" })),
      total: 2500, page: q.page, pageSize: q.pageSize,
    }));
    mount();
    await panel().findAllByTestId("activity-row");

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText("The file has the newest 2,000 of 2,500 events.")).toBeInTheDocument();

    const walks = listActivity.mock.calls.map(([q]) => q).filter((q) => q.pageSize === 200);
    expect(walks).toHaveLength(10);
    walks.forEach((q, i) => expect(q).toEqual(expect.objectContaining({ actions: ["document.delivered"], pageSize: 200, page: i + 1 })));
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/^activity-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await new Promise<string>((done) => { const r = new FileReader(); r.onload = () => done(r.result as string); r.readAsText(blob); });
    expect(csv.split("\r\n")[0]).toBe('"Date","Time","What happened","Flow","Who","Result","Details"');
  });
});
