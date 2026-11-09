import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DraftReview } from "./DraftReview";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({ listDestinations: vi.fn(), createOutput: vi.fn(), testOutput: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const flow = { id: "f", fields: { fields: [{ key: "po", label: "PO" }, { key: "ship", label: "Ship" }], tables: [] } };
const template = {
  format: "json",
  root: { name: "document", nodeType: "object", children: [
    { name: "OrderNumber", nodeType: "field", children: [], rule: { outputPath: "OrderNumber", canonicalField: "po" } },
  ] },
};
const draft = {
  name: "Docs", format: "json", tableKey: null, template, notes: [], truncated: false,
  leaves: [{ path: "OrderNumber", fieldKey: "po", by: "docs", confidence: null, required: true, cite: { where: "page 2", quote: "OrderNumber is required" } }],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listDestinations.mockResolvedValue([{ id: "d1", name: "Their API", protocol: "http", config: {}, hasCredentials: false, createdAt: "" }]);
  api.testOutput.mockResolvedValue({ success: true, message: null, responseCode: 200 });
});

describe("DraftReview from documentation", () => {
  it("create waits for a passing test of this exact draft", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DraftReview flow={flow as never} draft={draft as never} requireTest previewDocumentId="doc" onCreated={() => {}} onRestart={() => {}} />
      </QueryClientProvider>);
    expect(screen.getByText("From the documentation, page 2: “OrderNumber is required”")).toBeTruthy();
    expect(screen.getByText("Required")).toBeTruthy();
    const create = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    await screen.findByRole("option", { name: "Their API" });
    fireEvent.change(screen.getByLabelText("Send to"), { target: { value: "d1" } });
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Send a test" }));
    await screen.findByText("Test sent. You can create the output now.");
    expect(create.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Value for OrderNumber"), { target: { value: "ship" } });
    await waitFor(() => expect(create.disabled).toBe(true));
  });
});
