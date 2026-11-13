import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { FlowsHome } from "./FlowsHome";

const listFlows = vi.fn();
vi.mock("@/lib/api/documents", () => ({
  listFlows: () => listFlows(),
  listDocuments: () => Promise.resolve([]),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("FlowsHome", () => {
  it("says flows are off on the engine refusal, with no first-flow prompt", async () => {
    listFlows.mockRejectedValue(new ApiHttpError("no", 403, { error: "document_engine_not_enabled" }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FlowsHome />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Flows aren't switched on for this workspace yet.")).toBeTruthy();
    expect(screen.queryByText("Set up your first flow")).toBeNull();
  });

  it("no longer carries the recent-documents section", async () => {
    listFlows.mockResolvedValue([]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FlowsHome />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Set up your first flow")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Recent documents" })).toBeNull();
  });
});
