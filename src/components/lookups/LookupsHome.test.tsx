import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LookupsHome } from "./LookupsHome";

vi.mock("@/lib/api/documents", () => ({
  listLookups: async () => [
    { id: "a", name: "Item codes", count: 1, updatedAt: "" },
    { id: "b", name: "Units", count: 2, updatedAt: "" },
  ],
  createLookup: vi.fn(),
}));
vi.mock("@/hooks/useDocumentEngine", () => ({
  useDocumentEngine: () => "on",
  flowsQuery: { queryKey: ["flows"], queryFn: async () => [] },
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("LookupsHome", () => {
  it("says '1 row', not '1 rows'", async () => {
    render(<QueryClientProvider client={new QueryClient()}><LookupsHome /></QueryClientProvider>);
    expect(await screen.findByText("1 row")).toBeTruthy();
    expect(screen.getByText("2 rows")).toBeTruthy();
  });
});
