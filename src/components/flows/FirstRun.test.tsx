import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { Flow } from "@/lib/api/documents";
import { COPY } from "@/lib/documentRefusals";
import { FirstRun } from "./FirstRun";
import { UploadQueueProvider } from "./UploadQueue";

const api = vi.hoisted(() => ({
  listFlows: vi.fn(), getFlow: vi.fn(), listDocumentPage: vi.fn(), getDocument: vi.fn(), retryDocumentRead: vi.fn(),
  editDocumentValues: vi.fn(), fetchDocumentSource: vi.fn(), listOutputs: vi.fn(), createOutput: vi.fn(), updateFlow: vi.fn(), saveFlowFields: vi.fn(),
  createFlow: vi.fn(), uploadDocument: vi.fn(),
}));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("@/lib/api/linkedAccounts", () => ({ listLinkedAccounts: () => Promise.resolve({ available: false, accounts: [] }) }));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }), useSearchParams: () => new URLSearchParams(nav.search), usePathname: () => "/flows/new",
}));
const setSearch = (s: string) => { nav.search = s; };

const unconfirmed: Flow = {
  id: "f-1", name: "New flow", fieldsConfirmed: false, fields: { fields: [], tables: [] }, documentCount: 1, createdAt: "2026-11-15T09:00:00Z",
  automation: "review", scansOn: true, formatsOn: false,
};
const freshWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}><UploadQueueProvider>{children}</UploadQueueProvider></QueryClientProvider>
  );
};
const wrapper = freshWrapper();

beforeEach(() => {
  vi.clearAllMocks();
  api.listDocumentPage.mockReturnValue(new Promise(() => {}));
  api.getDocument.mockReturnValue(new Promise(() => {}));
});

describe("FirstRun", () => {
  it("opens the step the address and the server agree on", async () => {
    api.listFlows.mockResolvedValue([unconfirmed]);
    api.getFlow.mockResolvedValue(unconfirmed);
    setSearch("step=send&flow=f-1&doc=d-1");                          // fields not saved yet: send is not open
    // PageShell draws no <main> (the app layout does): the render's container stands for it.
    const { container: main, unmount } = render(<FirstRun />, { wrapper });
    expect(await within(main).findByText("Step 2 of 3. This is what we read from your document.")).toBeInTheDocument();
    expect(within(main).getByRole("link", { name: "Back to Flows" })).toHaveAttribute("href", "/flows");
    expect(within(within(main).getByRole("list", { name: "Steps" })).getByText("Check what we read").closest("li"))
      .toHaveAttribute("aria-current", "step");
    unmount();
    api.getFlow.mockRejectedValue(new ApiHttpError("x", 404, { error: "flow_not_found" }));
    setSearch("step=check&flow=f-gone&doc=d-1");
    const again = render(<FirstRun />, { wrapper: freshWrapper() }).container;
    expect(await within(again).findByText(COPY.flow_not_found)).toBeInTheDocument();
    expect(within(again).getByRole("link", { name: "Start again" })).toHaveAttribute("href", "/flows/new");
  });

  it("draws no empty heading while the page loads or after a failed load", async () => {
    const empty = (c: HTMLElement) => within(c).queryAllByRole("heading").filter((h) => !h.textContent?.trim());
    api.listFlows.mockReturnValue(new Promise(() => {}));
    setSearch("");
    const loading = render(<FirstRun />, { wrapper: freshWrapper() });
    expect(await within(loading.container).findByText("Loading flows…")).toBeInTheDocument();
    expect(within(loading.container).getByRole("link", { name: "Back to Flows" })).toBeInTheDocument();
    expect(empty(loading.container)).toEqual([]);
    loading.unmount();
    api.listFlows.mockRejectedValue(new ApiHttpError("down", 500, null));
    const failed = render(<FirstRun />, { wrapper: freshWrapper() }).container;
    expect(await within(failed).findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(empty(failed)).toEqual([]);
  });

  it("never runs a step on a flow that is already set up", async () => {
    const finished = { ...unconfirmed, fieldsConfirmed: true, publishedVersion: 1 };
    api.listFlows.mockResolvedValue([finished]);
    api.getFlow.mockResolvedValue(finished);
    setSearch("step=send&flow=f-1&doc=d-1");
    const main = render(<FirstRun />, { wrapper: freshWrapper() }).container;
    expect(await within(main).findByText("This flow is set up.")).toBeInTheDocument();
    expect(within(main).getByRole("link", { name: "Open the flow" })).toHaveAttribute("href", "/flows/f-1");
    expect(within(main).queryByText("Where should the file go?")).toBeNull();
    expect(within(main).queryByText("What we read")).toBeNull();
  });

  it("moves on to check once the file is taken, though the address gained the flow it made on the way", async () => {
    const made = { ...unconfirmed, documentCount: 0 };
    api.listFlows.mockResolvedValue([]);
    api.createFlow.mockResolvedValue(made);
    api.getFlow.mockResolvedValue(made);
    api.uploadDocument.mockResolvedValue({ id: "d-1", flowId: "f-1", fileName: "po.pdf", status: "received" });
    setSearch("");
    // As the real router does: the replaced address reaches FirstRun, which draws again while the file goes up.
    nav.replace.mockImplementationOnce((to: string) => { setSearch(to.split("?")[1] ?? ""); view.rerender(<FirstRun />); });
    const view = render(<FirstRun />, { wrapper: freshWrapper() });
    fireEvent.change(await within(view.container).findByLabelText("Choose a file"), { target: { files: [new File(["x"], "po.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/flows/new?step=check&flow=f-1&doc=d-1"));
    expect(nav.replace).toHaveBeenCalledWith("/flows/new?flow=f-1");
  });
});
