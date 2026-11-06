import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewFlowGuide } from "./NewFlowGuide";

const url = vi.hoisted(() => {
  let params = new URLSearchParams();
  const subs = new Set<() => void>();
  return {
    get: () => params,
    set(query: string) { params = new URLSearchParams(query); subs.forEach((s) => s()); },
    subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn); },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ replace: (to: string) => url.set(to.split("?")[1] ?? ""), push: vi.fn() }),
  };
});
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  createFlow: vi.fn(), getFlow: vi.fn(), uploadDocument: vi.fn(), getDocument: vi.fn(), retryDocumentRead: vi.fn(),
  saveFlowFields: vi.fn(), listOutputs: vi.fn(), createOutput: vi.fn(), updateOutput: vi.fn(),
  listDestinations: vi.fn(), testDestination: vi.fn(), previewOutput: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const fields = { fields: [{ key: "total", label: "Total", type: "money", meaning: null, required: false }], tables: [] };
const flow = { id: "f", name: "Receipts", fieldsConfirmed: true, fields, documentCount: 1, createdAt: "", automation: "review" };
const summary = (status: string) => ({
  id: "d", flowId: "f", flowName: "Receipts", fileName: "a.csv", status, statusReason: null,
  pageCount: 1, billingUnits: 1, failedChecks: 0, createdAt: "",
});
const read = { kindLabel: null, fields: [{ key: "total", label: "Total", value: "5", type: "money", meaning: null, confidence: 1, location: null, notOnPage: false, listed: false, edited: false }], tables: [], truncated: false };
const output = { id: "o", flowId: "f", name: "Receipts file", format: "csv", tableKey: null, destinationId: null, template: { root: { name: "document", nodeType: "object", children: [] } }, createdAt: "" };

const renderGuide = () =>
  render(<QueryClientProvider client={new QueryClient()}><NewFlowGuide /></QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  url.set("");
  api.listDestinations.mockResolvedValue([]);
  api.getFlow.mockResolvedValue(flow);
  api.listOutputs.mockResolvedValue([]);
});

describe("NewFlowGuide", () => {
  it("walks all six steps, keeping flow and doc in the URL", async () => {
    api.createFlow.mockResolvedValue({ ...flow, fieldsConfirmed: false });
    api.uploadDocument.mockResolvedValue(summary("received"));
    api.getDocument
      .mockResolvedValueOnce({ summary: summary("reading"), contentType: "text/csv", read, checks: [] })
      .mockResolvedValue({ summary: summary("needs_review"), contentType: "text/csv", read, checks: [] });
    api.saveFlowFields.mockResolvedValue(flow);
    api.createOutput.mockImplementation(async () => { api.listOutputs.mockResolvedValue([output]); return output; });
    renderGuide();

    fireEvent.change(screen.getByLabelText("Flow name"), { target: { value: "Receipts" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(url.get().get("flow")).toBe("f"));
    expect(screen.getByText("Step 2 of 6")).toBeTruthy();

    const file = new File(["a,b"], "a.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Choose a file"), { target: { files: [file] } });
    await waitFor(() => expect(url.get().get("doc")).toBe("d"));

    fireEvent.click(await screen.findByRole("button", { name: "Save fields" }, { timeout: 5000 }));
    expect(await screen.findByText("Step 4 of 6")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Receipts file" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateOutput).toHaveBeenCalled());

    expect(await screen.findByText("Step 5 of 6")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Your flow is ready")).toBeTruthy();
    expect(api.updateOutput).toHaveBeenCalledTimes(1);
    expect(url.get().get("flow")).toBe("f");
    expect(url.get().get("doc")).toBe("d");
  }, 30000);

  it("opens step 3 directly from the URL", async () => {
    url.set("flow=f&doc=d&step=3");
    api.getDocument.mockResolvedValue({ summary: summary("needs_review"), contentType: "text/csv", read, checks: [] });
    renderGuide();
    expect(screen.getByText("Step 3 of 6")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Save fields" })).toBeTruthy();
    expect(api.createFlow).not.toHaveBeenCalled();
  });

  it("saves the destination with the stored template", async () => {
    url.set("flow=f&doc=d&step=5");
    const template = { root: { name: "document", nodeType: "object", children: [{ name: "kept", nodeType: "value" }] } };
    api.listOutputs.mockResolvedValue([{ ...output, template }]);
    api.listDestinations.mockResolvedValue([{ id: "x", name: "Warehouse", protocol: "http", config: {}, hasCredentials: false, createdAt: "" }]);
    api.updateOutput.mockResolvedValue(output);
    renderGuide();
    const pick = await screen.findByLabelText("Send to");
    await screen.findByRole("option", { name: "Warehouse" });
    fireEvent.change(pick, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(api.updateOutput).toHaveBeenCalled());
    const body = api.updateOutput.mock.calls[0][2];
    expect(body.template).toEqual(template);
    expect(body.destinationId).toBe("x");
  });
});
