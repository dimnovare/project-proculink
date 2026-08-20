// Settings ▸ Organization — a failed org-settings read is not "outbound".
//
// Family: "a failed fetch renders as a settled answer" — see the guard block in
// src/components/bridge/workshop/AssignSupplierBanner.suppliersFetchFailed.test.tsx
// for the family rule and the greps that find new instances.
//
// THE DEFECT here: OrderDirectionSetting read
// `current = data?.direction ?? "outbound"`, so on a FAILED read the outbound
// radio rendered CHECKED and enabled — the screen asserted a saved choice it
// never fetched. Worse: `choose()` early-returns on `direction === current`, so
// an operator whose org is actually saved OUTBOUND, seeing it "checked", cannot
// re-save it — and an operator who clicks the checked option to confirm the
// (possibly wrong) claim gets a silent no-op as "already saved". Nothing on the
// screen said the read failed at all.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/settings",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));

const orgApi = { getOrgSettings: vi.fn() };

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getOrgSettings: (...a: unknown[]) => orgApi.getOrgSettings(...a),
    getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth", status: "active" }),
  };
});

import SettingsPage from "./page";

function renderOrgTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("Settings ▸ Organization — direction setting on a failed read", () => {
  it("failed read: shows an explicit failed state with retry, and no radio renders checked or enabled", async () => {
    orgApi.getOrgSettings.mockReset().mockRejectedValue(new Error("network down"));

    renderOrgTab();

    // The explicit failed state, with its way back.
    const failed = await screen.findByTestId("direction-load-failed");
    expect(within(failed).getByText(/couldn.t load/i)).toBeInTheDocument();
    expect(within(failed).getByRole("button", { name: /try again/i })).toBeInTheDocument();

    // The wrong claim: no radio may present itself as the saved answer, and no
    // enabled radio may accept a choice that would early-return as already-saved.
    expect(screen.queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    for (const radio of screen.queryAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });

  it("retry refetches: the saved answer then renders checked", async () => {
    orgApi.getOrgSettings
      .mockReset()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({ slug: "test-org", name: "Test Org", direction: "inbound" });

    renderOrgTab();

    const failed = await screen.findByTestId("direction-load-failed");
    fireEvent.click(within(failed).getByRole("button", { name: /try again/i }));

    const inbound = await screen.findByRole("radio", {
      name: /we receive purchase orders/i,
    });
    await waitFor(() => expect(inbound).toBeChecked());
    expect(screen.queryByTestId("direction-load-failed")).not.toBeInTheDocument();
  });

  // CONTROL — the settled path is unchanged and proves the assertions bite.
  it("control: a settled read renders the saved option checked with no failed state", async () => {
    orgApi.getOrgSettings
      .mockReset()
      .mockResolvedValue({ slug: "test-org", name: "Test Org", direction: "outbound" });

    renderOrgTab();

    const outbound = await screen.findByRole("radio", {
      name: /we send purchase orders/i,
    });
    await waitFor(() => expect(outbound).toBeChecked());
    expect(outbound).toBeEnabled();
    expect(screen.queryByTestId("direction-load-failed")).not.toBeInTheDocument();
  });
});
