// Settings ▸ Email intake — a failed supplier fetch is not "No suppliers yet".
//
// Family: "a failed fetch renders as a settled answer" — see the guard block in
// src/components/bridge/workshop/AssignSupplierBanner.suppliersFetchFailed.test.tsx
// for the family rule and the greps that find new instances.
//
// THE DEFECT here: the suppliers query (`retry: false`, default `= []`, no
// `isError`) fed two claims on a failed fetch:
//   1. The "Default supplier" field printed "No suppliers yet — add one first →",
//      sending an operator with real suppliers off to create a duplicate.
//   2. The "Poll inbox for orders" toggle's disabled predicate
//      (`suppliers.length === 0 && !form.enabled`) treated the failure as zero
//      suppliers and PERMANENTLY disabled the toggle (retry: false — one failed
//      request decided the rest of the page's life).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EmailSettings } from "@/types/procurement";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=email"),
  usePathname: () => "/settings",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));

vi.mock("@/lib/api/inboundEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/inboundEmail")>();
  return { ...actual, getInboundAddresses: vi.fn().mockResolvedValue([]) };
});

const BASE_SETTINGS: EmailSettings = {
  enabled: false,
  host: "imap.company.test",
  port: 993,
  useSsl: true,
  username: "orders@company.test",
  folder: "INBOX",
  defaultSupplierId: null,
  hasPassword: true,
  passwordDisplay: null,
  lastPolledAt: null,
  updatedAt: "2026-08-01T10:00:00Z",
};

const suppliersApi = { getSuppliers: vi.fn() };

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getOrgSettings: vi.fn().mockResolvedValue({ slug: "test-org", name: "Test Org", direction: "outbound" }),
    getEmailSettings: vi.fn(),
    getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth", status: "active" }),
    apiClient: {
      ...actual.apiClient,
      getSuppliers: (...a: unknown[]) => suppliersApi.getSuppliers(...a),
    },
  };
});

import { getEmailSettings } from "@/lib/api-client";
import SettingsPage from "./page";

function renderEmailTab() {
  vi.mocked(getEmailSettings).mockResolvedValue({ ...BASE_SETTINGS });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("Settings ▸ Email — a failed supplier fetch is not zero suppliers", () => {
  it("failed fetch: names the failure with a retry, never 'No suppliers yet', and does not disable the polling toggle", async () => {
    suppliersApi.getSuppliers.mockReset().mockRejectedValue(new Error("network down"));

    renderEmailTab();

    // The error branch, with its way back.
    const failure = await screen.findByTestId("default-supplier-load-failed");
    expect(within(failure).getByText(/couldn.t load/i)).toBeInTheDocument();
    expect(within(failure).getByRole("button", { name: /try again/i })).toBeInTheDocument();

    // The wrong claim must be absent: the org may have plenty of suppliers.
    expect(screen.queryByText(/No suppliers yet/i)).not.toBeInTheDocument();

    // And the toggle must not treat the failure as zero suppliers. (Its other
    // disabling reason, the billing gate, is satisfied: billing is Growth.)
    const toggle = screen.getByRole("switch", { name: "Poll inbox for orders" });
    expect(toggle).not.toBeDisabled();
  });

  it("retry refetches: once the list loads, the real select appears", async () => {
    suppliersApi.getSuppliers
      .mockReset()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue([{ id: "sup-1", name: "Nordmark GmbH" }]);

    renderEmailTab();

    const failure = await screen.findByTestId("default-supplier-load-failed");
    fireEvent.click(within(failure).getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("option", { name: "Nordmark GmbH" })).toBeInTheDocument();
    expect(screen.queryByTestId("default-supplier-load-failed")).not.toBeInTheDocument();
  });

  // CONTROL — the happy paths are unchanged and prove the assertions bite.
  it("control: a resolved list renders the select, a settled empty list still says 'No suppliers yet'", async () => {
    suppliersApi.getSuppliers.mockReset().mockResolvedValue([{ id: "sup-1", name: "Nordmark GmbH" }]);
    renderEmailTab();
    expect(await screen.findByRole("option", { name: "Nordmark GmbH" })).toBeInTheDocument();
    expect(screen.queryByTestId("default-supplier-load-failed")).not.toBeInTheDocument();
    cleanup();

    suppliersApi.getSuppliers.mockReset().mockResolvedValue([]);
    renderEmailTab();
    expect(await screen.findByText(/No suppliers yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("default-supplier-load-failed")).not.toBeInTheDocument();
    // A genuinely supplier-less org still cannot enable polling.
    expect(screen.getByRole("switch", { name: "Poll inbox for orders" })).toBeDisabled();
  });
});
