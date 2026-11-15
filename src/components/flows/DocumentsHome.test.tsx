import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { buttonClass } from "@/components/bridge/DSPrimitives";
import { OPEN_SEARCH_EVENT } from "@/lib/shortcuts";
import { DocumentsHome } from "./DocumentsHome";
import { UploadQueueProvider } from "./UploadQueue";

const replace = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ q: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.q),
  useRouter: () => ({ replace, push: vi.fn() }),
}));
const listFlows = vi.fn();
const listDocumentPage = vi.hoisted(() => vi.fn());
const sendDocument = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/documents", () => ({ listFlows: () => listFlows(), listDocumentPage, sendDocument }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("@/lib/api/linkedAccounts", () => ({ listLinkedAccounts: () => Promise.resolve({ available: false, accounts: [] }) }));
const getOrders = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiClient: { getOrders } }));

/** "pending" never settles: the request is still out. */
type Count = number | Error | "pending";
type Counts = { needs?: Count; working?: Count; sent?: Count; failed?: Count; /** a count that carries `sentFrom` */ week?: Count };
const COUNTED: Record<string, keyof Counts> = {
  "needs_review,ready": "needs", "received,reading,sending": "working", sent: "sent", "read_failed,send_failed": "failed",
};
const row = (i: number) => ({
  id: `d${i}`, flowId: "f1", flowName: "Invoices", status: "sent", statusReason: null, fileName: `doc-${i}.pdf`,
  createdAt: "2026-11-01T00:00:00Z",
});
const page = (items: unknown[], totalCount: number, p: number, pageSize: number) => ({ items, totalCount, page: p, pageSize, sampleCount: 0 });

/** A `pageSize: 1` call is a count, a `pageSize: 50` call is the listed page; anything else is an empty page.
 *  The needs-you count's one row is `rows[0]`. */
function answers(counts: Counts & { rows?: unknown[] }) {
  listDocumentPage.mockImplementation((q: { status?: string[]; sentFrom?: string; page: number; pageSize: number }) => {
    const key = q.sentFrom ? "week" : COUNTED[q.status?.join(",") ?? ""];
    const n = (key ? counts[key] : undefined) ?? 0;
    if (n === "pending") return new Promise(() => {});
    if (n instanceof Error) return Promise.reject(n);
    if (q.pageSize === 1) return Promise.resolve(page(key === "needs" ? (counts.rows ?? []).slice(0, 1) : [], n, 1, 1));
    if (q.pageSize === 50) return Promise.resolve(page(counts.rows ?? Array.from({ length: Math.min(n, 50) }, (_, i) => row(i)), n, q.page, 50));
    return Promise.resolve(page([], 0, q.page, q.pageSize));
  });
}

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={client}>
      <UploadQueueProvider><DocumentsHome /></UploadQueueProvider>
    </QueryClientProvider>
  );
  const r = render(ui());
  return { ...r, client, again: () => r.rerender(ui()) };
};

beforeEach(() => {
  vi.clearAllMocks();
  search.q = "";
  listFlows.mockResolvedValue([{ id: "f1", name: "Invoices" }]);
  getOrders.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 1, sampleCount: 0 });
});

describe("DocumentsHome", () => {
  it("draws the welcome only once the flows answered that the workspace is new", async () => {
    const welcome = () => screen.queryByRole("heading", { level: 1, name: /Let's read your first document/ });
    answers({});
    listFlows.mockReturnValue(new Promise(() => {}));
    const loading = mount();
    expect(await screen.findByText("Loading flows…")).toBeInTheDocument();
    expect(welcome()).toBeNull();
    loading.unmount();
    listFlows.mockRejectedValue(new ApiHttpError("down", 500, null));
    const failed = mount();
    expect(await screen.findByRole("button", { name: "Retry" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(welcome()).toBeNull();
    failed.unmount();
    listFlows.mockResolvedValue([]);
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome. Let's read your first document." })).toBeInTheDocument();
  });

  it("opens on Needs you when something needs you and on All when nothing does, and a tab press writes the address", async () => {
    answers({ needs: 3, working: "pending" });
    const first = mount();
    expect(await screen.findByRole("tab", { name: "Needs you 3" })).toHaveAttribute("aria-selected", "true");
    expect(listDocumentPage).toHaveBeenCalledWith(expect.objectContaining({ status: ["needs_review", "ready"], page: 1, pageSize: 50 }));
    // getAll: jsdom has no Tailwind, so the table and the phone list both render each row.
    expect((await within(screen.getByRole("tabpanel")).findAllByText("doc-0.pdf")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: /^Sent/ }));
    expect(replace).toHaveBeenLastCalledWith("/documents?show=sent");
    // The address changes under the screen (Back, Forward, a link): the tab follows it, not the latch,
    // and while its page is out the panel holds none of the previous tab's rows.
    search.q = "show=in-progress";
    first.again();
    expect(screen.getByRole("tab", { name: "In progress" })).toHaveAttribute("aria-selected", "true");
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("Loading documents…")).toBeInTheDocument();
    expect(panel.queryAllByText("doc-0.pdf")).toHaveLength(0);
    first.unmount();
    search.q = "";
    answers({ needs: 0 });
    mount();
    expect(await screen.findByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  });

  it("prints a count only once it is known, pages a long list, and says when a page is past the end", async () => {
    search.q = "show=sent";
    answers({ sent: 120, failed: new Error("down"), needs: "pending" });
    const first = mount();
    expect(await screen.findByRole("tab", { name: "Sent 120" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tab", { name: "In progress 0" })).toBeInTheDocument(); // a known zero
    expect(screen.getByRole("tab", { name: "Couldn't send or read" })).toBeInTheDocument(); // unknown: no number, not 0
    expect(screen.getByRole("tab", { name: "Needs you" })).toBeInTheDocument(); // still out: no number, not 0
    expect(await screen.findByText("Documents 1 to 50 of 120")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/documents?show=sent&page=2");
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    first.unmount();
    search.q = "show=sent&page=9";
    answers({ sent: 120, rows: [] });
    mount();
    expect(await screen.findByText("There is nothing on this page.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "First page" })).toHaveAttribute("href", "/documents?show=sent");
  });

  it("says what is known under the title, and Review next opens the newest document that needs you", async () => {
    answers({ needs: 3, week: 24, rows: [{ ...row(0), id: "d-new", flowId: "f1" }] });
    const first = mount();
    expect(await screen.findByText("3 need you. 24 were sent this week.")).toBeInTheDocument();
    expect(screen.getByTestId("review-next")).toHaveAttribute("href", "/flows/f1/documents/d-new");
    expect(screen.getByTestId("review-next")).toHaveTextContent(/^Review next\s*3$/);
    expect(screen.getByTestId("review-next")).toHaveAccessibleName("Review next, 3 need you");
    expect(within(screen.getByTestId("action-bar")).getByRole("link", { name: "Review next, 3 need you" })).toHaveAttribute("href", "/flows/f1/documents/d-new");
    first.unmount();
    answers({ needs: 0, week: 0 });
    const second = mount();
    expect(await screen.findByText("Nothing needs you.")).toBeInTheDocument();
    expect(screen.queryByTestId("review-next")).toBeNull();
    expect(screen.queryByTestId("action-bar")).toBeNull();
    second.unmount();
    // While the needs-you answer is out, the plain line stays: an unknown number is not "Nothing".
    answers({ needs: "pending" });
    mount();
    await screen.findByRole("tablist");
    expect(screen.getByText("Every document that has arrived, newest first.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing needs you.")).toBeNull();
    expect(screen.queryByTestId("review-next")).toBeNull();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("uses different words for nothing needs you and for an empty filter", async () => {
    search.q = "show=needs-you";
    answers({ needs: 0, sent: 4 });
    const first = mount();
    expect(await screen.findByRole("heading", { name: "You're all caught up." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload a document" })).toHaveAttribute("href", "/upload");
    first.unmount();
    search.q = "show=in-progress";
    mount();
    expect(await screen.findByRole("heading", { name: "Nothing is in progress right now." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all documents" })).toHaveAttribute("href", "/documents?show=all");
    expect(screen.queryByText("No documents here.")).toBeNull();
  });

  it("keeps the stopped alert above the tabs through a failed refresh, and closes a whole needs-you list", async () => {
    search.q = "show=needs-you";
    answers({ needs: 1, rows: [{ ...row(0), status: "needs_review" }] });
    const base = listDocumentPage.getMockImplementation()!;
    const stoppedPage = page([{ ...row(9), status: "send_failed", failedAt: null, stop: null }], 1, 1, 20);
    let asked = 0;
    let listed = 0;
    listDocumentPage.mockImplementation((q: { status?: string[]; pageSize: number }) =>
      q.pageSize === 20 && q.status?.join(",") === "send_failed"
        ? (asked++ === 0 ? Promise.resolve(stoppedPage) : Promise.reject(new Error("down")))
        : q.pageSize === 50 && listed++ > 0 ? Promise.reject(new Error("down")) : base(q));
    const { client } = mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("1 document couldn't be sent");
    expect(alert.compareDocumentPosition(screen.getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(screen.getByRole("tabpanel")).findByText("That is everything that needs you. Older documents are under Sent and All.")).toBeInTheDocument();
    // An answer in hand is still the best knowledge: a failed refresh does not read as "all is well".
    await act(async () => {
      await client.refetchQueries({ queryKey: ["documents", "stopped"] });
      await client.refetchQueries({ queryKey: ["documents", "page"] });
      await new Promise((r) => setTimeout(r, 0)); // the query's batched notify lands on the next tick
    });
    expect(client.getQueryState(["documents", "stopped"])?.status).toBe("error");
    expect(screen.getByText(/1 document couldn't be sent/)).toBeInTheDocument();
    expect(within(within(screen.getByRole("tabpanel")).getByRole("table")).getByText("doc-0.pdf")).toBeInTheDocument();
  });

  it("Select ticks only the rows on screen, Send sends only the ready ones once, and a new tab clears it", async () => {
    const two = [
      { ...row(1), id: "doc-1", fileName: "invoice-1001.pdf", status: "needs_review", checks: [], failedChecks: 1 },
      { ...row(2), id: "doc-2", fileName: "invoice-1002.pdf", status: "ready" },
    ];
    answers({ needs: 2, rows: two });
    sendDocument.mockResolvedValue([]);
    const first = mount();
    const table = () => within(within(screen.getByRole("tabpanel")).getByRole("table"));
    await screen.findAllByText("invoice-1001.pdf");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    fireEvent.click(table().getByRole("checkbox", { name: "Select invoice-1001.pdf" }));
    fireEvent.click(table().getByRole("checkbox", { name: "Select invoice-1002.pdf" }));
    const bar = within(screen.getByRole("region", { name: "2 documents selected" }));
    expect(bar.getByText("2 selected")).toBeInTheDocument();
    // The bar's Send is the one filled button: the header's Review next turns secondary, the phone bar goes.
    expect(screen.getByTestId("review-next").className).toContain(buttonClass("secondary", "lg"));
    expect(screen.queryByTestId("action-bar")).toBeNull();
    const send = bar.getByRole("button", { name: "Send the ready one" });
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    expect(await bar.findByRole("status")).toHaveTextContent("invoice-1002.pdf is on its way.");
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(sendDocument).toHaveBeenCalledWith("doc-2");
    expect(table().getByRole("checkbox", { name: "Select invoice-1002.pdf" })).not.toBeChecked();
    search.q = "show=all";
    first.again();
    await waitFor(() => expect(table().getByText("invoice-1001.pdf")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: /selected$/ })).toBeNull();
    expect(table().getByRole("checkbox", { name: "Select invoice-1001.pdf" })).not.toBeChecked();
    // A failed refresh keeps the rows and the ticks.
    fireEvent.click(table().getByRole("checkbox", { name: "Select invoice-1001.pdf" }));
    listDocumentPage.mockRejectedValue(new Error("down"));
    await act(async () => {
      await first.client.refetchQueries({ queryKey: ["documents", "page"] });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(first.client.getQueryState(["documents", "page", "all", 1])?.status).toBe("error");
    expect(table().getByRole("checkbox", { name: "Select invoice-1001.pdf" })).toBeChecked();
    expect(screen.getByRole("region", { name: "1 document selected" })).toBeInTheDocument();
  });

  it("a run outlives its bar: leaving Select mode and coming back sends nothing twice, and its result is shown", async () => {
    const three = [
      { ...row(1), id: "doc-1", fileName: "invoice-1001.pdf", status: "needs_review", checks: [], failedChecks: 1 },
      { ...row(2), id: "doc-2", fileName: "invoice-1002.pdf", status: "ready" },
      { ...row(3), id: "doc-3", fileName: "invoice-1003.pdf", status: "ready" },
    ];
    answers({ needs: 3, rows: three });
    const out: ((v: unknown) => void)[] = [];
    sendDocument.mockImplementation(() => new Promise((ok) => out.push(ok)));
    mount();
    await screen.findAllByText("invoice-1001.pdf");
    const table = () => within(within(screen.getByRole("tabpanel")).getByRole("table"));
    const tickBoth = () => ["invoice-1002.pdf", "invoice-1003.pdf"].forEach((f) => fireEvent.click(table().getByRole("checkbox", { name: `Select ${f}` })));
    const sendBoth = () => act(async () => {
      fireEvent.click(within(screen.getByRole("region", { name: "2 documents selected" })).getByRole("button", { name: "Send both" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    tickBoth();
    await sendBoth();
    expect(sendDocument).toHaveBeenCalledTimes(1);
    // Done while the run is out, Select again, tick the same rows (still listed as ready) and press Send: nothing more leaves.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    tickBoth();
    await sendBoth();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await act(async () => { out[0]([]); await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { out[1]([]); await new Promise((r) => setTimeout(r, 0)); });
    expect(sendDocument.mock.calls).toEqual([["doc-2"], ["doc-3"]]);
    // Out of Select mode, the result is shown where the list's notices go.
    expect(await within(screen.getByRole("tabpanel").parentElement!).findByText("2 documents are on their way.")).toBeInTheDocument();
    // Back in Select mode, what this screen sent is never offered to send again, even before the list refreshes.
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    tickBoth();
    const bar = within(screen.getByRole("region", { name: "2 documents selected" }));
    expect(bar.queryByRole("button", { name: /^Send/ })).toBeNull();
    expect(sendDocument).toHaveBeenCalledTimes(2);
  });

  it("the footer offers search, and Old orders only when there are old orders", async () => {
    answers({ needs: 0, rows: [row(1)] });
    const spy = vi.spyOn(window, "dispatchEvent");
    const first = mount();
    const line = await screen.findByText(/^Looking for something older\?/);
    expect(line).toHaveTextContent(/^Looking for something older\? Search all documents\.$/);
    fireEvent.click(within(line).getByRole("button", { name: "Search all documents" }));
    expect(spy.mock.calls.map(([e]) => e.type)).toContain(OPEN_SEARCH_EVENT);
    expect(screen.getByText("Press Ctrl K to find any document, flow or lookup.")).toBeInTheDocument();
    first.unmount();
    spy.mockRestore();
    getOrders.mockResolvedValue({ items: [{}], totalCount: 1, page: 1, pageSize: 1, sampleCount: 0 });
    mount();
    expect(await screen.findByText(/or open/)).toHaveTextContent(/^Looking for something older\? Search all documents or open Old orders\.$/);
    expect(screen.getByRole("link", { name: "Old orders" })).toHaveAttribute("href", "/archive");
  });

  it("says flows are off on the engine refusal", async () => {
    listFlows.mockRejectedValue(new ApiHttpError("no", 403, { error: "document_engine_not_enabled" }));
    mount();
    expect(await screen.findByText("Flows aren't switched on for this workspace yet.")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
