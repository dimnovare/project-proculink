import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { DocumentsHome } from "./DocumentsHome";

const listFlows = vi.fn();
vi.mock("@/lib/api/documents", () => ({
  listFlows: () => listFlows(),
  listDocuments: () =>
    Promise.resolve(
      [
        { id: "d1", status: "sent", fileName: "sent-one.pdf" },
        { id: "d2", status: "needs_review", fileName: "review-two.pdf" },
      ].map((d) => ({ flowId: "f1", flowName: "Invoices", statusReason: null, createdAt: "2026-11-01T00:00:00Z", ...d })),
    ),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentsHome />
    </QueryClientProvider>,
  );

describe("DocumentsHome", () => {
  it("lists recent documents and narrows to Needs you", async () => {
    listFlows.mockResolvedValue([{ id: "f1", name: "Invoices" }]);
    mount();
    const region = within(await screen.findByRole("region", { name: "Recent documents" }));
    expect((await region.findAllByText("sent-one.pdf")).length).toBeGreaterThan(0);
    expect(region.getAllByText("review-two.pdf").length).toBeGreaterThan(0);
    fireEvent.click(region.getByRole("button", { name: "Needs you" }));
    expect(region.queryAllByText("sent-one.pdf")).toHaveLength(0);
    expect(region.getAllByText("review-two.pdf").length).toBeGreaterThan(0);
  });

  it("says flows are off on the engine refusal", async () => {
    listFlows.mockRejectedValue(new ApiHttpError("no", 403, { error: "document_engine_not_enabled" }));
    mount();
    expect(await screen.findByText("Flows aren't switched on for this workspace yet.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Recent documents" })).toBeNull();
  });
});
