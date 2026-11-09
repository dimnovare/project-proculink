import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OutputEditor } from "./OutputEditor";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const viewer = vi.hoisted(() => vi.fn((_: unknown) => <div data-testid="pdf-view" />));
vi.mock("@/components/bridge/document/PdfDocumentView", () => ({ PdfDocumentView: viewer }));

const api = vi.hoisted(() => ({
  listDestinations: vi.fn(), listLookups: vi.fn(), updateOutput: vi.fn(), createOutput: vi.fn(), previewOutput: vi.fn(),
  uploadOutputLogo: vi.fn(), deleteOutputLogo: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const flow = { id: "f", fields: { fields: [], tables: [] } };
const output = { id: "o", flowId: "f", name: "Letter", format: "pdf", tableKey: null, destinationId: null, createdAt: "", sendWhen: null,
  template: { root: { name: "document", nodeType: "object", children: [] } } };

beforeEach(() => {
  vi.clearAllMocks();
  api.listDestinations.mockResolvedValue([]);
  api.listLookups.mockResolvedValue([]);
  api.uploadOutputLogo.mockResolvedValue(undefined);
});

const renderEditor = () =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <OutputEditor flow={flow as never} output={output as never} previewDocumentId="d" onSaved={() => {}} onCancel={() => {}} />
  </QueryClientProvider>);

describe("OutputEditor pdf", () => {
  it("uploads the chosen logo", async () => {
    renderEditor();
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Add a logo"), { target: { files: [file] } });
    await waitFor(() => expect(api.uploadOutputLogo).toHaveBeenCalledWith("f", "o", file));
  });

  it("shows a pdf preview in the viewer, not a <pre>", async () => {
    api.previewOutput.mockResolvedValue({ contentType: "application/pdf", fileName: "a.pdf", content: "", base64: "JVBERi0=", lookupMisses: [] });
    const { container } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByTestId("pdf-view");
    expect(viewer.mock.calls[0][0]).toMatchObject({ regionLabel: "Preview" });
    expect(container.querySelector("pre")).toBeNull();
  });
});
