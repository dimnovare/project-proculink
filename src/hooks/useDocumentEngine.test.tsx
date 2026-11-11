import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiHttpError } from "@/lib/api/core";

const listFlows = vi.fn();
vi.mock("@/lib/api/documents", () => ({ listFlows: () => listFlows() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

import { useDocumentEngine } from "./useDocumentEngine";

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useDocumentEngine(), { wrapper }) };
};

describe("useDocumentEngine", () => {
  it("stays on when a later refetch fails with a non-refusal error", async () => {
    listFlows.mockResolvedValueOnce([]);
    const { result, client } = setup();
    await waitFor(() => expect(result.current).toBe("on"));
    listFlows.mockRejectedValueOnce(new ApiHttpError("boom", 500, { error: "server_error" }));
    await client.refetchQueries({ queryKey: ["flows"] });
    expect(client.getQueryState(["flows"])?.status).toBe("error");
    expect(result.current).toBe("on");
  });

  it("reads off on the explicit refusal", async () => {
    listFlows.mockRejectedValueOnce(new ApiHttpError("no", 403, { error: "document_engine_not_enabled" }));
    const { result } = setup();
    await waitFor(() => expect(result.current).toBe("off"));
  });
});
