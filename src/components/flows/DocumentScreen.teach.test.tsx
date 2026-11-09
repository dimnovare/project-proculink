import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { DocumentScreen } from "./DocumentScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  getDocument: vi.fn(), getDocumentHistory: vi.fn(), fetchDocumentSource: vi.fn(), getFlow: vi.fn(), teachDocument: vi.fn(),
  listOutputs: vi.fn(), listDestinations: vi.fn(), listDeliveries: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

beforeAll(() => {
  // jsdom has no object URLs, pointer events, pointer capture or layout.
  URL.createObjectURL = () => "blob:x";
  URL.revokeObjectURL = () => {};
  window.PointerEvent ??= class extends MouseEvent {} as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 }) as DOMRect;
});

const detail = (fileName: string, senderLabel: string | null = null) => ({
  summary: {
    id: "d", flowId: "f", flowName: "Receipts", fileName, status: "needs_review", statusReason: null,
    pageCount: null, billingUnits: 1, failedChecks: 0, createdAt: "", source: "upload", sourceRef: null,
  },
  contentType: "text/csv", senderLabel,
  read: {
    kindLabel: null, tables: [], truncated: false,
    fields: [{ key: "total", label: "Total", value: "5", type: "text", meaning: null, confidence: 0.9, location: null, notOnPage: false, listed: true, edited: false }],
  },
  checks: [],
});
const blobOf = (text: string) => {
  const b = new Blob([text]);
  b.arrayBuffer = async () => new TextEncoder().encode(text).buffer as ArrayBuffer; // jsdom Blob lacks arrayBuffer
  return b;
};

let qc: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient();
  api.getDocument.mockResolvedValue(detail("a.csv"));
  api.getDocumentHistory.mockResolvedValue([]);
  api.getFlow.mockResolvedValue({ id: "f", fieldsConfirmed: true, fields: { fields: [{ key: "total", label: "Total" }], tables: [] } });
  api.listOutputs.mockResolvedValue([]);
  api.listDestinations.mockResolvedValue([]);
  api.listDeliveries.mockResolvedValue([]);
  api.fetchDocumentSource.mockResolvedValue(blobOf("Item,Total\nBolt,5"));
});

const renderScreen = () => render(<QueryClientProvider client={qc}><DocumentScreen flowId="f" documentId="d" /></QueryClientProvider>);
const choose = async (field: string) => {
  fireEvent.change(await screen.findByLabelText("Field to point to"), { target: { value: field } });
};

describe("DocumentScreen teach", () => {
  it("pointing at a cell teaches the field for the sender", async () => {
    api.teachDocument.mockResolvedValue(detail("a.csv", "shop.example"));
    renderScreen();
    await choose("total");
    fireEvent.click(screen.getByRole("button", { name: "Point to it" }));
    expect(screen.getByText("Click the cell that holds Total.")).toBeTruthy();
    fireEvent.click(await screen.findByLabelText("Use cell B2"));
    await waitFor(() => expect(api.teachDocument).toHaveBeenCalledWith("d", { key: "total", address: "cell:r2c2", value: "5" }));
    expect(await screen.findByText("Saved. Next time a document from shop.example comes in, we'll look there for Total.")).toBeTruthy();
  });

  it("a box with no text asks for the value", async () => {
    api.getDocument.mockResolvedValue(detail("a.png"));
    api.fetchDocumentSource.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
    api.teachDocument.mockRejectedValueOnce(new ApiHttpError("no", 422, { error: "no_text_in_area" })).mockResolvedValue(detail("a.png"));
    renderScreen();
    await choose("total");
    fireEvent.click(screen.getByRole("button", { name: "Point to it" }));
    const area = await screen.findByLabelText("Draw a box on page 1");
    fireEvent.pointerDown(area, { clientX: 20, clientY: 10 });
    fireEvent.pointerUp(area, { clientX: 120, clientY: 60 });
    expect(await screen.findByText(/We couldn't find text there/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What it says"), { target: { value: "INV-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.teachDocument).toHaveBeenLastCalledWith("d", { key: "total", page: 1, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, value: "INV-9" }));
    expect(await screen.findByText("Saved. We'll look there for Total in every document in this flow.")).toBeTruthy();
  });

  it("a new field is taught by name", async () => {
    api.teachDocument.mockResolvedValue(detail("a.csv"));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderScreen();
    await choose("");
    fireEvent.change(screen.getByLabelText("New field name"), { target: { value: "Delivery note" } });
    fireEvent.click(screen.getByRole("button", { name: "Point to it" }));
    fireEvent.click(await screen.findByLabelText("Use cell B2"));
    await waitFor(() => expect(api.teachDocument).toHaveBeenCalledWith("d", { newLabel: "Delivery note", address: "cell:r2c2", value: "5" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["flow", "f"] }));
  });
});
