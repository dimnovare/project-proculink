import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buttonClass } from "@/components/bridge/DSPrimitives";
import { ApiHttpError } from "@/lib/api/core";
import type { Flow, FlowField } from "@/lib/api/documents";
import { FlowPage } from "./FlowPage";
import { useDraftPart } from "./flowDraft";

const replace = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ q: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.q),
  useRouter: () => ({ replace, push }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  getFlow: vi.fn(), updateFlow: vi.fn(), deleteFlow: vi.fn(), listIntakes: vi.fn(), listOutputs: vi.fn(), listDestinations: vi.fn(),
  listDocumentPage: vi.fn(), publishFlow: vi.fn(), restoreFlowVersion: vi.fn(), listFlowVersions: vi.fn(),
  flowApiEndpoint: (id: string) => `/api/v1/flows/${id}/documents`, listLookups: vi.fn(async () => []),
  listDocuments: vi.fn(), getDocument: vi.fn(), previewOutput: vi.fn(), testOutput: vi.fn(),
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
  api.listDocuments.mockResolvedValue([]);
});

const renderPage = () => render(<QueryClientProvider client={new QueryClient()}><FlowPage flowId="flow-1" /></QueryClientProvider>);
const strip = () => within(screen.getByRole("navigation", { name: "Flow sections" }));
const findStrip = async () => within(await screen.findByRole("navigation", { name: "Flow sections" }));

describe("FlowPage", () => {
  it("a flow the server does not know is the in-app not-found page; any other failure keeps Try again", async () => {
    const quiet = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.getFlow.mockRejectedValue(new ApiHttpError("not found", 404, { error: "flow_not_found" }));
    const view = render(<QueryClientProvider client={quiet}><FlowPage flowId="nope" /></QueryClientProvider>);
    expect(await within(view.container).findByRole("heading", { level: 1, name: "We can't find that page" })).toBeTruthy();
    expect(within(view.container).getByRole("button", { name: "Get help" })).toBeTruthy();
    expect(within(view.container).queryByRole("button", { name: "Try again" })).toBeNull();
    view.unmount();
    api.getFlow.mockRejectedValue(new ApiHttpError("down", 503, null));
    const down = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FlowPage flowId="f" /></QueryClientProvider>);
    expect(await within(down.container).findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(within(down.container).queryByText("We can't find that page")).toBeNull();
  });

  it("the header says In use only for a flow with a saved setup", async () => {
    for (const publishedVersion of [1, null, undefined]) {
      api.getFlow.mockResolvedValue({ ...flow, publishedVersion });
      const { unmount } = renderPage();
      await screen.findByRole("heading", { level: 1, name: "Supplier invoices" });
      expect(screen.queryAllByText("In use").length, `publishedVersion ${publishedVersion}`).toBe(publishedVersion === 1 ? 1 : 0);
      unmount();
    }
  });

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

  it("the Flows back link saves what is waiting before it leaves", async () => {
    search.q = "tab=history";
    const log: string[] = [];
    part.save.mockImplementation(async (v: string) => { log.push(`save ${v}`); });
    push.mockImplementation((href: string) => log.push(`push ${href}`));
    renderPage();
    await screen.findByText("Earlier versions");
    act(() => part.change!("Invoice no"));
    fireEvent.click(screen.getByRole("link", { name: "Back to Flows" }));
    await waitFor(() => expect(log).toEqual(["save Invoice no", "push /flows"]));
  });

  it("on every step the publish bar holds the one filled button", async () => {
    // A filled button is any variant drawn with white text, read from the Button's own classes.
    const fill = new Set((["primary", "send", "blue", "secondary", "ghost", "danger", "ai"] as const)
      .map((v) => buttonClass(v).split(" ")).filter((c) => c.includes("text-white")).map((c) => c.find((x) => x.startsWith("bg-"))!));
    const filled = (el: Element) => el.className.split(/\s+/).some((c) => fill.has(c));
    api.getFlow.mockResolvedValue({ ...flow, hasChanges: true });
    api.listOutputs.mockResolvedValue([{
      id: "out-1", flowId: "flow-1", name: "Invoice CSV", format: "csv", tableKey: null, destinationId: "dest-1", createdAt: "", sendWhen: null,
      template: { format: "csv", root: { name: "document", nodeType: "object", children: [] } },
    }]);
    api.listDestinations.mockResolvedValue([{ id: "dest-1", name: "Accounting server", protocol: "sftp", config: { host: "sftp.example.test" }, hasCredentials: true }]);
    // We send previews and tests with this document, so the walk sees the preview and the test's result too.
    const summary = { id: "doc-1", flowId: "flow-1", fileName: "invoice-1001.csv", status: "needs_review", statusReason: null, createdAt: "2026-11-01T10:00:00Z" };
    api.listDocuments.mockResolvedValue([summary]);
    api.getDocument.mockResolvedValue({ summary, contentType: "text/csv", checks: [], read: { kindLabel: null, truncated: false, fields: [], tables: [] } });
    api.previewOutput.mockResolvedValue({ contentType: "text/csv", fileName: "invoice-1001.csv", content: "Invoice\n1001", lookupMisses: [] });
    api.testOutput.mockResolvedValue({ success: true, message: null });
    for (const step of ["arrives", "read", "check", "send"]) {
      search.q = `tab=${step}`;
      const { unmount } = renderPage();
      await screen.findByRole("button", { name: "Use these changes" });
      if (step === "send") {
        const editor = within(await screen.findByRole("region", { name: "Edit the file Invoice CSV" }));
        await editor.findByText("Invoice 1001");
        fireEvent.click(await editor.findByRole("button", { name: "Send a test" }));
        await editor.findByText(/Test file arrived/);
      }
      if (step === "arrives") await screen.findByRole("button", { name: "Add a pickup" });
      const fills = [...document.body.querySelectorAll("button, a")].filter(filled);
      expect(fills.map((b) => b.textContent), step).toEqual(["Use these changes"]);
      unmount();
    }
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

  it("offers Delete this flow only when the flow can be deleted, and deletes after the confirm", async () => {
    for (const fixture of [flow, { ...flow, publishedVersion: null, canDelete: false }]) {
      api.getFlow.mockResolvedValue(fixture);
      const plain = renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Rename this flow" }));
      expect(screen.getByRole("textbox", { name: "Flow name" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Delete this flow" })).toBeNull();
      plain.unmount();
    }

    api.getFlow.mockResolvedValue({ ...flow, publishedVersion: null, documentCount: 1, canDelete: true });
    api.deleteFlow.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rename this flow" }));
    const loads = api.getFlow.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Delete this flow" }));
    expect(screen.getByText("Delete this flow? Its documents go too. This can't be undone.")).toBeTruthy();
    // the confirm asks for a fresh count and waits for it before it can delete
    expect(screen.getByRole("button", { name: "Delete flow" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete flow" })).not.toBeDisabled());
    expect(api.getFlow.mock.calls.length).toBeGreaterThan(loads);
    fireEvent.click(screen.getByRole("button", { name: "Delete flow" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/flows"));
    expect(api.deleteFlow).toHaveBeenCalledWith("flow-1");
  });

  it("a refused delete says why and keeps the person on the flow", async () => {
    api.getFlow.mockResolvedValue({ ...flow, publishedVersion: null, documentCount: 0, canDelete: true });
    api.deleteFlow.mockRejectedValue(new ApiHttpError("refused", 409, { error: "flow_in_use" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rename this flow" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this flow" }));
    expect(screen.getByText("Delete this flow? This can't be undone.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete flow" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Delete flow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This flow can't be deleted: it has been put in use, or it has sent documents.");
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("button", { name: "Delete flow" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete this flow" }));
  });
});
