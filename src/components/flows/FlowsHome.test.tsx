import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { buildVisibleNav } from "@/components/bridge/BridgeSidebar";
import { FlowsHome } from "./FlowsHome";

const listFlows = vi.fn();
vi.mock("@/lib/api/documents", () => ({
  listFlows: () => listFlows(),
  listDocuments: () => Promise.resolve([]),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const hasFlows = (documentEngine: boolean) =>
  buildVisibleNav("Suppliers", true, documentEngine)
    .main.flatMap((s) => s.items)
    .some((i) => i.href === "/flows");

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

  it("shows the Flows menu item only when the engine is on", () => {
    expect(hasFlows(false)).toBe(false);
    expect(hasFlows(true)).toBe(true);
  });
});
