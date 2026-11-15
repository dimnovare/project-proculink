import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { DocumentsHome } from "./DocumentsHome";

const replace = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ q: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.q),
  useRouter: () => ({ replace, push: vi.fn() }),
}));
const listFlows = vi.fn();
const listDocumentPage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/documents", () => ({ listFlows: () => listFlows(), listDocumentPage }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

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
      <DocumentsHome />
    </QueryClientProvider>
  );
  const r = render(ui());
  return { ...r, again: () => r.rerender(ui()) };
};

beforeEach(() => {
  vi.clearAllMocks();
  search.q = "";
  listFlows.mockResolvedValue([{ id: "f1", name: "Invoices" }]);
});

describe("DocumentsHome", () => {
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

  it("says flows are off on the engine refusal", async () => {
    listFlows.mockRejectedValue(new ApiHttpError("no", 403, { error: "document_engine_not_enabled" }));
    mount();
    expect(await screen.findByText("Flows aren't switched on for this workspace yet.")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
