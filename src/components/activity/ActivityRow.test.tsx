import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { ActivityEvent } from "@/lib/api/documents";
import { activityView } from "@/lib/activityRows";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { ActivityRow } from "./ActivityRow";

const { sendDocument } = vi.hoisted(() => ({ sendDocument: vi.fn() }));
vi.mock("@/lib/api/documents", () => ({ sendDocument }));

const failed: ActivityEvent = {
  id: "evt-4", ts: "2026-06-01T09:12:00Z", action: "document.delivery_failed", documentId: "doc-4", flowId: "flow-2",
  documentName: "invoice-1003.csv", flowName: "Supplier invoices", source: null, actorId: "user_member_a",
  startedAt: "2026-06-01T09:10:00Z", poNumber: null,
  payload: { destination: "Accounting inbox", destinationId: "dest-1", protocol: "email", error: "The mailbox refused the message.", responseCode: 550, attempts: 3, output: "Invoice CSV", file: "invoice-1003.csv", version: 2 },
};

const renderRow = (qc = new QueryClient()) => {
  const view = activityView(failed, { who: "Alex Example", destinationName: () => null });
  render(
    <QueryClientProvider client={qc}>
      <ul><ActivityRow event={failed} view={view} who="Alex Example" open onToggle={() => {}} /></ul>
    </QueryClientProvider>,
  );
};

beforeEach(() => vi.clearAllMocks());

describe("ActivityRow", () => {
  it("Send again sends once and says what happened", async () => {
    let resolve!: (v: unknown) => void;
    sendDocument.mockReturnValue(new Promise((r) => { resolve = r; }));
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderRow(qc);
    const button = screen.getByRole("button", { name: "Send again" });
    fireEvent.click(button); // a double click: two presses before the answer
    fireEvent.click(button);
    await waitFor(() => expect(sendDocument).toHaveBeenCalled());
    expect(sendDocument.mock.calls).toEqual([["doc-4"]]);
    resolve([]);
    expect(await screen.findByText("Sending again. A new row shows the result.")).toBeInTheDocument();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["activity"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["documents"] });
    const fix = screen.getAllByRole("link", { name: "Fix the destination" });
    expect(fix).toHaveLength(1);
    expect(fix[0]).toHaveAttribute("href", "/settings?tab=destinations&open=dest-1");
  });

  it("a refusal stays beside the button", async () => {
    const err = new ApiHttpError("no", 409, { error: "not_ready" });
    sendDocument.mockRejectedValue(err);
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    expect(await screen.findByText(documentRefusalMessage(err))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send again" })).toBeEnabled();
  });
});
