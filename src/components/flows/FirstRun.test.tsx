import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { Flow } from "@/lib/api/documents";
import { COPY } from "@/lib/documentRefusals";
import { FirstRun } from "./FirstRun";

const api = vi.hoisted(() => ({
  listFlows: vi.fn(), getFlow: vi.fn(), listDocumentPage: vi.fn(), getDocument: vi.fn(), retryDocumentRead: vi.fn(),
  editDocumentValues: vi.fn(), fetchDocumentSource: vi.fn(), listOutputs: vi.fn(), createOutput: vi.fn(), updateFlow: vi.fn(), saveFlowFields: vi.fn(),
}));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(nav.search), usePathname: () => "/flows/new",
}));
const setSearch = (s: string) => { nav.search = s; };

const unconfirmed: Flow = {
  id: "f-1", name: "New flow", fieldsConfirmed: false, fields: { fields: [], tables: [] }, documentCount: 1, createdAt: "2026-11-15T09:00:00Z",
  automation: "review", scansOn: true, formatsOn: false,
};
const freshWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
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
});
