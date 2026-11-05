// "Hold this order for review" on upload: ticking it sends holdForReview with the upload, so the
// order is never auto-delivered. Harness mirrors UploadWorkbench.singlePrimaryAction.test.tsx.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Supplier } from "@/types/procurement";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/upload",
  useSearchParams: () => new URLSearchParams(),
}));

const api = { getSuppliers: vi.fn(), getOrders: vi.fn(), detectFormat: vi.fn(), uploadPurchaseOrder: vi.fn() };

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  ApiHttpError: class ApiHttpError extends Error {},
  getBillingStatus: () => Promise.resolve({ canProcessOrders: true, isTrialExpired: false, plan: "growth" }),
  getOrgSettings: () => Promise.resolve({ direction: "outbound" }),
  apiClient: {
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    detectFormat: (...a: unknown[]) => api.detectFormat(...a),
    uploadPurchaseOrder: (...a: unknown[]) => api.uploadPurchaseOrder(...a),
  },
}));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/hooks/useOnboardingStatus", () => ({ useOnboardingStatus: () => ({ data: undefined }) }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
  usePracticeOrderEmail: () => "",
}));

import { UploadWorkbench } from "./UploadWorkbench";

const SUPPLIER = { id: "sup-1", name: "BoltWorks BV", code: "BOLT", status: "active" } as Supplier;

async function mountWithFile() {
  api.getSuppliers.mockResolvedValue([SUPPLIER]);
  api.getOrders.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 });
  api.detectFormat.mockReturnValue(new Promise(() => {}));
  api.uploadPurchaseOrder.mockClear();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UploadWorkbench />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    if (!document.body.textContent?.includes(SUPPLIER.name)) throw new Error("suppliers not loaded");
  });
  const file = new File(["po,qty\nA-1,2\n"], "po.csv", { type: "text/csv" });
  await act(async () => {
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } });
  });
  return file;
}

function send() {
  fireEvent.click(screen.getAllByRole("button").find((b) => /upload & review/i.test(b.textContent ?? ""))!);
}

afterEach(cleanup);

describe("upload: hold this order for review", () => {
  it("upload sends holdForReview when ticked", async () => {
    const file = await mountWithFile();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hold this order for review" }));
    send();
    await waitFor(() => expect(api.uploadPurchaseOrder).toHaveBeenCalled());
    expect(api.uploadPurchaseOrder).toHaveBeenCalledWith(file, "sup-1", { holdForReview: true });
  });

});
