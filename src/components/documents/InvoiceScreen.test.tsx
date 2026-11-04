import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The real in-memory mock client (ord-005 is the seeded invoice), not a hand-built fixture.
// USE_MOCK is read once at module load, so the env has to be set before any import runs.
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_USE_MOCK", "true");
});
afterAll(() => vi.unstubAllEnvs());

const queries = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/hooks/useQueriesEnabled", () => ({
  useQueriesEnabled: () => queries.enabled,
  useTenantQueriesEnabled: () => queries.enabled,
}));
// pdf.js cannot run in jsdom; the pane around it is what is under test.
vi.mock("@/components/bridge/document/SourceDocumentBody", () => ({
  SourceDocumentBody: () => <div data-testid="original-body" />,
}));

import { apiClient } from "@/lib/api-client";
import { InvoiceScreen } from "./InvoiceScreen";

afterEach(() => {
  vi.restoreAllMocks();
  queries.enabled = true;
});

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <InvoiceScreen orderId="ord-005" />
    </QueryClientProvider>,
  );
}

async function seededInvoice() {
  const order = await apiClient.getOrderById("ord-005");
  if (!order) throw new Error("mock ord-005 missing");
  return order;
}

describe("InvoiceScreen", () => {
  it("shows the original beside the read data and lists the open check", async () => {
    renderScreen();
    expect(await screen.findByTestId("original-body")).toBeInTheDocument();
    expect(await screen.findByLabelText("IBAN")).toHaveValue("DE89370400440532013000");
    expect(await screen.findByText("Net plus VAT does not equal the total.")).toBeInTheDocument();
    expect(screen.getByLabelText("Total")).toHaveAttribute("aria-invalid", "true");
  });

  it("waits for the query instead of claiming the document could not load", () => {
    queries.enabled = false;
    renderScreen();
    expect(screen.getByLabelText("Opening the invoice…")).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load this document/)).toBeNull();
  });

  it("Send transforms then delivers", async () => {
    const base = await seededInvoice();
    const transform = vi.spyOn(apiClient, "transformOrder").mockResolvedValue({ artifactId: "a1", format: "csv", createdAt: base.createdAt });
    const deliver = vi.spyOn(apiClient, "redeliverOrder").mockResolvedValue();
    // The server's side of the round trip: ready → ready_to_deliver (with its file) → delivered.
    vi.spyOn(apiClient, "getOrderById").mockImplementation(async () => ({
      ...base,
      status: deliver.mock.calls.length ? "delivered" : transform.mock.calls.length ? "ready_to_deliver" : "ready",
      artifacts: transform.mock.calls.length ? [{ id: "a1", format: "csv", fileKey: "k/a1.csv", createdAt: base.createdAt }] : [],
    }));

    renderScreen();
    const send = await screen.findByRole("button", { name: "Send invoice" });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);

    await waitFor(() => expect(deliver).toHaveBeenCalledWith("ord-005"));
    expect(transform).toHaveBeenCalledWith("ord-005");
    expect(transform.mock.invocationCallOrder[0]).toBeLessThan(deliver.mock.invocationCallOrder[0]);
  });

  it("unrouted invoice links to choose where invoices go instead of offering Send", async () => {
    const base = await seededInvoice();
    vi.spyOn(apiClient, "getOrderById").mockResolvedValue({ ...base, status: "unrouted" });

    renderScreen();
    const link = await screen.findByRole("link", { name: "Choose where invoices go" });
    expect(link).toHaveAttribute("href", "/settings?tab=org");
    expect(screen.queryByRole("button", { name: "Send invoice" })).toBeNull();
  });

  // Both are statuses /transform or /redeliver accept, so only the problem gate keeps Send shut:
  // a rejected invoice would be refused again, an unconfirmed one could be paid twice.
  it.each(["rejected_by_supplier", "delivery_unconfirmed"] as const)("Send stays disabled on %s", async (status) => {
    const base = await seededInvoice();
    vi.spyOn(apiClient, "getOrderById").mockResolvedValue({ ...base, status });

    renderScreen();
    expect(await screen.findByTestId("order-problem-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send invoice" })).toBeDisabled();
  });
});
