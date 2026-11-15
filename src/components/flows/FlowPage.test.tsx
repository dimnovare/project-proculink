import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { Flow, FlowField } from "@/lib/api/documents";
import { FlowPage } from "./FlowPage";
import { useDraftPart } from "./flowDraft";

const replace = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ q: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.q),
  useRouter: () => ({ replace, push: vi.fn() }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  getFlow: vi.fn(), updateFlow: vi.fn(), listIntakes: vi.fn(), listOutputs: vi.fn(), listDestinations: vi.fn(),
  listDocumentPage: vi.fn(), publishFlow: vi.fn(), restoreFlowVersion: vi.fn(), listFlowVersions: vi.fn(),
  flowApiEndpoint: (id: string) => `/api/v1/flows/${id}/documents`,
}));
vi.mock("@/lib/api/documents", () => api);
vi.mock("./UploadQueue", () => ({ useUploadQueue: () => ({ items: [], add: vi.fn(), retry: vi.fn() }) }));

// History stands in for a step with a draft part: the frame must flush it before it lets the person leave.
const part = vi.hoisted(() => ({ save: vi.fn(), change: null as null | ((v: string) => void) }));
vi.mock("./FlowVersionsPanel", () => ({
  FlowVersionsPanel: function Panel() {
    part.change = useDraftPart("values", "read", part.save).change;
    return <p>Earlier versions</p>;
  },
}));

const field = (key: string): FlowField => ({ key, label: key, type: "text", meaning: null, required: true });
const flow = {
  id: "flow-1", name: "Supplier invoices", fieldsConfirmed: true, documentCount: 3, createdAt: "", automation: "review",
  fields: { fields: ["a", "b", "c", "d", "e", "f"].map(field), tables: [{ key: "lines", label: "Lines", columns: ["x", "y", "z"].map(field) }] },
  publishedVersion: 1, hasChanges: false, noCorrectionStreak: null,
} as Flow;

beforeEach(() => {
  vi.clearAllMocks();
  search.q = "";
  api.getFlow.mockResolvedValue(flow);
  api.listIntakes.mockResolvedValue([]);
  api.listOutputs.mockResolvedValue([]);
  api.listDestinations.mockResolvedValue([]);
  api.listDocumentPage.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 10, sampleCount: 0 });
  api.listFlowVersions.mockResolvedValue([]);
});

const renderPage = () => render(<QueryClientProvider client={new QueryClient()}><FlowPage flowId="flow-1" /></QueryClientProvider>);
const strip = () => within(screen.getByRole("navigation", { name: "Flow sections" }));
const findStrip = async () => within(await screen.findByRole("navigation", { name: "Flow sections" }));

describe("FlowPage", () => {
  it("the strip marks the chosen step and an old tab name still works", async () => {
    search.q = "tab=fields";
    renderPage();
    const read = (await findStrip()).getByRole("link", { name: "We read" });
    expect(read).toHaveAttribute("aria-current", "page");
    expect(read).toHaveAccessibleDescription("9 values, 1 table");
    expect(within(strip().getByRole("link", { name: /^Documents/ })).getByText("3")).toBeTruthy();
    expect(strip().getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")).toEqual([read]);
  });

  it.each([["fields", "We read"], ["outputs", "We send"], ["intake", "Arrives"], ["versions", /^History/], ["documents", /^Documents/]] as const)(
    "the old tab name %s lands on %s", async (tab, name) => {
      search.q = `tab=${tab}`;
      renderPage();
      expect((await findStrip()).getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    });

  it("a refused change keeps the person on the step", async () => {
    search.q = "tab=history";
    part.save.mockRejectedValue(new ApiHttpError("forbidden", 403, { error: "requires_org_admin" }));
    renderPage();
    await screen.findByText("Earlier versions");
    act(() => part.change!("Invoice no"));
    fireEvent.click(strip().getByRole("link", { name: "We send" }));
    expect(await screen.findByText(/^A change couldn't be saved, so you are still on this step\./)).toHaveTextContent(
      "A change couldn't be saved, so you are still on this step. Only a workspace admin can change this.",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("rename", async () => {
    api.updateFlow.mockImplementation(async (_id: string, patch: { name: string }) => ({ ...flow, ...patch }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rename this flow" }));
    const input = screen.getByRole("textbox", { name: "Flow name" });
    fireEvent.change(input, { target: { value: "Supplier bills" } });
    fireEvent.submit(input);
    fireEvent.submit(input);
    expect(await screen.findByRole("heading", { level: 1, name: "Supplier bills" })).toBeTruthy();
    expect(api.updateFlow).toHaveBeenCalledTimes(1);
    expect(api.updateFlow).toHaveBeenCalledWith("flow-1", { name: "Supplier bills" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Flow name" })).toBeNull());
  });
});
