import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/settings",
}));
vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));

const api = { updateOrgSettings: vi.fn() };

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getOrgSettings: vi.fn().mockResolvedValue({ direction: "outbound", invoiceDestinationSupplierId: null }),
    updateOrgSettings: (...a: unknown[]) => api.updateOrgSettings(...a),
    getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth", status: "active" }),
    apiClient: { ...actual.apiClient, getSuppliers: vi.fn().mockResolvedValue([{ id: "sup-1", name: "Nordic Fasteners" }]) },
  };
});

import SettingsPage from "./page";

afterEach(cleanup);

describe("Settings ▸ Organisation — where invoices go", () => {
  it("choosing where invoices go saves the supplier id", async () => {
    api.updateOrgSettings.mockReset().mockResolvedValue({ direction: "outbound" });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SettingsPage />
      </QueryClientProvider>,
    );
    await screen.findByRole("option", { name: "Nordic Fasteners" });
    fireEvent.change(screen.getByLabelText("Where invoices go"), { target: { value: "sup-1" } });
    await waitFor(() => expect(api.updateOrgSettings).toHaveBeenCalledWith({ invoiceDestinationSupplierId: "sup-1" }));
  });
});
