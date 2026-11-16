import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Flow } from "@/lib/api/documents";
import { FlowDraftProvider } from "./flowDraft";
import { changesLine, changesNotInUse, FlowOutputs } from "./FlowOutputs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({
  listOutputs: vi.fn(), listDestinations: vi.fn(), listLookups: vi.fn(), updateOutput: vi.fn(), deleteOutput: vi.fn(),
  previewOutput: vi.fn(), testOutput: vi.fn(), listDocumentPage: vi.fn(), createOutput: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const flow = {
  id: "flow-1", name: "Supplier invoices", fieldsConfirmed: true, documentCount: 1, createdAt: "", automation: "review",
  publishedVersion: 1, hasChanges: false, noCorrectionStreak: null,
  fields: { fields: [{ key: "invoice_number", label: "Invoice number", type: "text", meaning: null, required: false }, { key: "item", label: "Item", type: "text", meaning: null, required: false }], tables: [] },
} as Flow;
const leaf = (name: string, field: string) => ({ name, nodeType: "field", children: [], rule: { outputPath: name, canonicalField: field, fieldManipulators: [] } });
const invoiceCsv = {
  id: "out-1", flowId: "flow-1", name: "Invoice CSV", format: "csv", tableKey: null, destinationId: "dest-1", createdAt: "", sendWhen: null,
  template: { format: "csv", root: { name: "document", nodeType: "object", children: [leaf("Invoice", "invoice_number"), leaf("Item", "item")] } },
};

const mount = (f: Flow = flow) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FlowDraftProvider flowId="flow-1"><FlowOutputs flow={f} outputId="out-1" previewDocumentId="doc-1" /></FlowDraftProvider>
    </QueryClientProvider>,
  );
const waitingOne = { items: [{ id: "doc-9", fileName: "invoice-0999.pdf", failedAt: null }], totalCount: 1, page: 1, pageSize: 50, sampleCount: 0 };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.listOutputs.mockResolvedValue([invoiceCsv]);
  api.listDestinations.mockResolvedValue([{ id: "dest-1", name: "Accounting server", protocol: "sftp", config: { host: "sftp.example.test", directory: "/in" }, hasCredentials: true }]);
  api.listLookups.mockResolvedValue([]);
  api.updateOutput.mockImplementation(async (_f: string, id: string, body: object) => ({ ...invoiceCsv, ...body, id }));
  api.previewOutput.mockResolvedValue({ contentType: "text/csv", fileName: "invoice-1001.csv", content: "Invoice,Item\n1001,KS-100", lookupMisses: [] });
  api.testOutput.mockResolvedValue({ success: true, message: null });
  api.listDocumentPage.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 50, sampleCount: 0 });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("FlowOutputs", () => {
  it("editing an output saves a draft, no Save button", async () => {
    mount();
    const editor = within(await screen.findByRole("region", { name: "Edit the file Invoice CSV" }));
    fireEvent.click(editor.getByRole("button", { name: "Change the columns" }));
    fireEvent.change(editor.getByRole("textbox", { name: "Column name, Item" }), { target: { value: "Code" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await waitFor(() => expect(api.updateOutput).toHaveBeenCalledTimes(1));
    const [flowId, id, body] = api.updateOutput.mock.calls[0];
    expect([flowId, id]).toEqual(["flow-1", "out-1"]);
    expect(body.template.root.children[1].name).toBe("Code");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();  });

  it("send a test shows where it was pressed, and with nothing unpublished offers what was waiting", async () => {
    api.listDocumentPage.mockResolvedValue(waitingOne);
    mount();
    const region = await screen.findByRole("region", { name: "Edit the file Invoice CSV" });
    fireEvent.click(await within(region).findByRole("button", { name: "Send a test" }));
    await waitFor(() => expect(api.testOutput).toHaveBeenCalledTimes(1));
    expect(api.testOutput).toHaveBeenCalledWith("doc-1", expect.objectContaining({ destinationId: "dest-1", format: "csv" }));
    expect(await within(region).findByText(/Test file arrived/)).toBeTruthy();
    expect(await within(region).findByRole("button", { name: "Send it now" })).toBeTruthy();
  });

  it("after a test of unpublished changes, nothing waiting is offered to send", async () => {
    api.listDocumentPage.mockResolvedValue(waitingOne);
    mount({ ...flow, hasChanges: true });
    const region = await screen.findByRole("region", { name: "Edit the file Invoice CSV" });
    fireEvent.click(await within(region).findByRole("button", { name: "Send a test" }));
    expect(await within(region).findByText(/Test file arrived/)).toBeTruthy();
    expect(within(region).queryByRole("button", { name: "Send it now" })).toBeNull();
    expect(api.listDocumentPage).not.toHaveBeenCalled();
  });

  it("a file that differs from the live one counts its changes, and nothing is counted until both lists are in hand", async () => {
    const live = { ...invoiceCsv, name: "Invoices", layout: { title: "Old" } };
    expect(changesNotInUse(invoiceCsv as never, [live as never])).toBe(2);
    expect(changesNotInUse(invoiceCsv as never, [invoiceCsv as never])).toBe(0);
    expect(changesNotInUse(invoiceCsv as never, [])).toBe("new");
    expect(changesNotInUse(invoiceCsv as never, undefined)).toBeNull();
    // rendered: live list pending → no count line; answered → "2 changes not in use yet" in the row's link
    let resolveLive!: (l: unknown[]) => void;
    api.listOutputs.mockImplementation((_id: string, opts?: { published?: boolean }) =>
      opts?.published ? new Promise((r) => { resolveLive = r; }) : Promise.resolve([invoiceCsv]));
    mount({ ...flow, publishedVersion: 2, hasChanges: true });
    const list = await screen.findByRole("list");
    expect(within(list).queryByText(/not in use yet/i)).toBeNull();
    await act(async () => { resolveLive([live]); });
    expect(await within(list).findByText("2 changes not in use yet")).toBeInTheDocument();
  });

  it("an untouched file counts nothing, and no count is drawn while the live list is fetched again", async () => {
    expect(changesLine(0)).toBeNull();
    // What a save adds by itself: an empty layout, a column's default width, an empty list of steps.
    const resaved = { ...invoiceCsv, layout: {}, template: { ...invoiceCsv.template, root: { ...invoiceCsv.template.root,
      children: invoiceCsv.template.root.children.map((c) => ({ ...c, rule: { outputPath: c.rule.outputPath, canonicalField: c.rule.canonicalField, width: 40 } })) } } };
    expect(changesNotInUse(resaved as never, [{ ...invoiceCsv, layout: null } as never])).toBe(0);
    expect(changesNotInUse({ ...invoiceCsv, layout: { title: "Old", footer: "" } } as never, [{ ...invoiceCsv, layout: { title: "Old" } } as never])).toBe(0);
    const live = { ...invoiceCsv, name: "Invoices" };
    let again!: (l: unknown[]) => void;
    let calls = 0;
    api.listOutputs.mockImplementation((_id: string, opts?: { published?: boolean }) =>
      !opts?.published ? Promise.resolve([invoiceCsv]) : calls++ === 0 ? Promise.resolve([live]) : new Promise((r) => { again = r; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <FlowDraftProvider flowId="flow-1"><FlowOutputs flow={{ ...flow, publishedVersion: 2, hasChanges: true }} outputId="out-1" previewDocumentId="doc-1" /></FlowDraftProvider>
      </QueryClientProvider>,
    );
    const list = await screen.findByRole("list");
    expect(await within(list).findByText("1 change not in use yet")).toBeInTheDocument();
    act(() => { void client.invalidateQueries({ queryKey: ["outputs", "flow-1", "published"] }); });
    await waitFor(() => expect(within(list).queryByText(/not in use yet/i)).toBeNull());
    await act(async () => { again([invoiceCsv]); });
    expect(within(list).queryByText(/not in use yet/i)).toBeNull();
  });

  it("the file just made is the one shown, while the list is still being fetched again", async () => {
    const made = { ...invoiceCsv, id: "out-2", name: "Supplier invoices CSV", destinationId: null };
    api.createOutput.mockResolvedValue(made);
    mount();
    await screen.findByRole("region", { name: "Edit the file Invoice CSV" });
    api.listOutputs.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Make another file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    const region = await screen.findByRole("region", { name: "Edit the file Supplier invoices CSV" });
    expect(document.activeElement).toBe(within(region).getByRole("heading", { name: "Supplier invoices CSV" }));
    expect(screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent)).toEqual(["Supplier invoices CSVCSV, you download it"]);
    expect(screen.queryByText("No file yet.")).toBeNull();
  });

  it("the new file's heading takes focus when it appears on a later render, and only that once", async () => {
    const made = { ...invoiceCsv, id: "out-2", name: "Supplier invoices CSV", destinationId: null };
    api.createOutput.mockResolvedValue(made);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const at = (outputId: string) => (
      <QueryClientProvider client={client}>
        <FlowDraftProvider flowId="flow-1"><FlowOutputs flow={flow} outputId={outputId} previewDocumentId="doc-1" /></FlowDraftProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(at("out-1"));
    await screen.findByRole("region", { name: "Edit the file Invoice CSV" });
    let answer!: (l: unknown[]) => void;
    api.listOutputs.mockImplementation(() => new Promise((r) => { answer = r; }));
    // The new file is not in the list yet: its heading is drawn only once the held list answers.
    vi.spyOn(client, "setQueryData").mockImplementationOnce(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Make another file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    await screen.findByRole("region", { name: "Edit the file Invoice CSV" });
    await act(async () => { answer([invoiceCsv, made]); });
    const region = await screen.findByRole("region", { name: "Edit the file Supplier invoices CSV" });
    const heading = within(region).getByRole("heading", { name: "Supplier invoices CSV" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const rename = within(region).getByRole("button", { name: "Rename this file" });
    rename.focus();
    rerender(at("out-2"));
    rerender(at("out-2"));
    expect(document.activeElement).toBe(rename);
  });

  it("after a file is made, the file the person came from opens again from the list", async () => {
    const made = { ...invoiceCsv, id: "out-2", name: "Supplier invoices CSV", destinationId: null };
    api.createOutput.mockResolvedValue(made);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const at = (outputId: string) => (
      <QueryClientProvider client={client}>
        <FlowDraftProvider flowId="flow-1"><FlowOutputs flow={flow} outputId={outputId} previewDocumentId="doc-1" /></FlowDraftProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(at("out-1"));
    await screen.findByRole("region", { name: "Edit the file Invoice CSV" });
    api.listOutputs.mockResolvedValue([invoiceCsv, made]);
    fireEvent.click(screen.getByRole("button", { name: "Make another file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    await screen.findByRole("region", { name: "Edit the file Supplier invoices CSV" });
    rerender(at("out-2"));
    rerender(at("out-1"));
    expect(await screen.findByRole("region", { name: "Edit the file Invoice CSV" })).toBeTruthy();
    expect(screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent?.startsWith("Invoice CSV"))).toEqual([true]);
  });
});