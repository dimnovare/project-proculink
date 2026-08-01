// WP-27 — the practice order must carry an address, or it cannot be delivered.
//
// The whole point of the packet is that a brand-new account reaches a DELIVERED
// supplier-ready file without a real supplier's cooperation. That only works if the
// sample-order request tells the backend where to email the finished file: the
// backend seeds the practice supplier's `email` delivery setup from that address, and
// with no address it seeds nothing and the run dead-ends at "no delivery is set up" —
// exactly the pre-WP-27 behaviour this packet exists to remove.
//
// Also pinned: the destination no longer carries `?sample=1`. The practice framing is
// driven by the order's own IsSample flag (see workshop/__tests__/practiceFraming).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const push = vi.fn();
const runSampleOrder = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null }) }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/sentry-context", () => ({ captureException: vi.fn() }));
vi.mock("@/hooks/useOnboardingStatus", () => ({
  invalidateOnboardingStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/api-client", () => ({
  isApiMockMode: true,
  apiClient: { runSampleOrder: (...a: unknown[]) => runSampleOrder(...a) },
}));

import { useSampleOrder } from "./useSampleOrder";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  runSampleOrder.mockResolvedValue({ orderId: "ord-sample-9", isSample: true, deliveryConfigured: true });
});

describe("useSampleOrder", () => {
  it("passes the delivery address through to the sample-order endpoint", async () => {
    const { result } = renderHook(() => useSampleOrder("/bridge"), { wrapper });

    act(() => result.current.runSample("maria@northgate.example"));

    await waitFor(() => expect(runSampleOrder).toHaveBeenCalled());
    expect(runSampleOrder).toHaveBeenCalledWith("maria@northgate.example");
  });

  it("routes to the order WITHOUT a ?sample=1 parameter", async () => {
    const { result } = renderHook(() => useSampleOrder("/bridge"), { wrapper });

    act(() => result.current.runSample("maria@northgate.example"));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith("/inbox/ord-sample-9");
    expect(push.mock.calls[0][0]).not.toContain("sample=1");
  });

  it("still starts a practice order when no address is available", async () => {
    // Degraded but honest: without an address the backend seeds no delivery setup and
    // says so via deliveryConfigured=false. The run must not be blocked.
    const { result } = renderHook(() => useSampleOrder("/upload"), { wrapper });

    act(() => result.current.runSample());

    await waitFor(() => expect(runSampleOrder).toHaveBeenCalled());
    expect(runSampleOrder).toHaveBeenCalledWith(undefined);
  });
});
