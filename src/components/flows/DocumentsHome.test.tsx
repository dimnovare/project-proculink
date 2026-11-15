import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

type Count = number | Error;
type Counts = { needs?: Count; working?: Count; sent?: Count; failed?: Count };
const COUNTED: Record<string, keyof Counts> = {
  "needs_review,ready": "needs", "received,reading,sending": "working", sent: "sent", "read_failed,send_failed": "failed",
};
const row = (i: number) => ({
  id: `d${i}`, flowId: "f1", flowName: "Invoices", status: "sent", statusReason: null, fileName: `doc-${i}.pdf`,
  createdAt: "2026-11-01T00:00:00Z",
});
const page = (items: unknown[], totalCount: number, p: number, pageSize: number) => ({ items, totalCount, page: p, pageSize, sampleCount: 0 });

/** A `pageSize: 1` call is a count, a `pageSize: 50` call is the listed page; anything else is an empty page. */
function answers(counts: Counts & { rows?: unknown[] }) {
  listDocumentPage.mockImplementation((q: { status?: string[]; page: number; pageSize: number }) => {
    const key = COUNTED[q.status?.join(",") ?? ""];
    const n = (key && counts[key]) ?? 0;
    if (n instanceof Error) return Promise.reject(n);
    if (q.pageSize === 1) return Promise.resolve(page([], n, 1, 1));
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
    answers({ needs: 3 });
    const first = mount();
    expect(await screen.findByRole("tab", { name: "Needs you 3" })).toHaveAttribute("aria-selected", "true");
    expect(listDocumentPage).toHaveBeenCalledWith(expect.objectContaining({ status: ["needs_review", "ready"], page: 1, pageSize: 50 }));
    fireEvent.click(screen.getByRole("tab", { name: /^Sent/ }));
    expect(replace).toHaveBeenLastCalledWith("/documents?show=sent");
    search.q = "show=sent"; // the address changes under the screen (Back, Forward, a link): the tab follows it, not the latch
    first.again();
    expect(screen.getByRole("tab", { name: /^Sent/ })).toHaveAttribute("aria-selected", "true");
    first.unmount();
    search.q = "";
    answers({ needs: 0 });
    mount();
    expect(await screen.findByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  });

  it("prints a count only once it is known, pages a long list, and says when a page is past the end", async () => {
    search.q = "show=sent";
    answers({ sent: 120, failed: new Error("down") });
    const first = mount();
    expect(await screen.findByRole("tab", { name: "Sent 120" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tab", { name: "In progress 0" })).toBeInTheDocument(); // a known zero
    expect(screen.getByRole("tab", { name: "Couldn't send or read" })).toBeInTheDocument(); // unknown: no number, not 0
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

  it("says flows are off on the engine refusal", async () => {
    listFlows.mockRejectedValue(new ApiHttpError("no", 403, { error: "document_engine_not_enabled" }));
    mount();
    expect(await screen.findByText("Flows aren't switched on for this workspace yet.")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
