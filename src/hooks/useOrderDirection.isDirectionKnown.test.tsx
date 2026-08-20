// useOrderDirection — the hook must let callers tell a settled "outbound" from
// a failed read that FELL BACK to "outbound".
//
// Family: "a failed fetch renders as a settled answer" — see the guard block in
// src/components/bridge/workshop/AssignSupplierBanner.suppliersFetchFailed.test.tsx
// for the family rule and the greps that find new instances.
//
// The outbound default is a deliberate fallback (every existing org is
// outbound) and the fallback WORDING may stand — but before this change the
// hook exposed only `{ direction, labels }`, so no consumer could distinguish
// "the org said outbound" from "the request failed". `isDirectionKnown` is that
// missing signal.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = { getOrgSettings: vi.fn() };

vi.mock("@/hooks/useQueriesEnabled", () => ({
  useQueriesEnabled: () => true,
}));

vi.mock("@/lib/api-client", () => ({
  getOrgSettings: (...a: unknown[]) => api.getOrgSettings(...a),
}));

import { useOrderDirection } from "./useOrderDirection";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => useOrderDirection(), { wrapper }) };
}

beforeEach(() => {
  api.getOrgSettings.mockReset();
});

describe("useOrderDirection — settled vs failed", () => {
  it("a failed read keeps the outbound fallback but reports the direction as NOT known", async () => {
    api.getOrgSettings.mockRejectedValue(new Error("network down"));

    const { qc, result } = setup();

    await waitFor(() =>
      expect(qc.getQueryState(["org-settings"])?.status).toBe("error"),
    );

    // The fallback wording may stand…
    expect(result.current.direction).toBe("outbound");
    expect(result.current.labels.counterpartyNoun).toBe("Supplier");
    // …but the hook must say it is a fallback, not a settled server answer.
    expect(result.current.isDirectionKnown).toBe(false);
  });

  it("a settled read reports the direction as known", async () => {
    api.getOrgSettings.mockResolvedValue({ slug: "o", name: "O", direction: "inbound" });

    const { result } = setup();

    await waitFor(() => expect(result.current.isDirectionKnown).toBe(true));
    expect(result.current.direction).toBe("inbound");
    expect(result.current.labels.counterpartyNoun).toBe("Customer");
  });
});
