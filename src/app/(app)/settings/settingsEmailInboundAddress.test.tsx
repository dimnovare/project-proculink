// The Email-intake tab must surface the org's hosted inbound address
// ({slug}@orders.proculink.eu) — the zero-setup intake path — not only the
// API-keys tab. Founder request 2026-07-24: "if easy, we should do and provide
// instructions". The address renders from GET /api/settings/organisation's
// slug; the IMAP polling form stays present below it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=email"),
  usePathname: () => "/settings",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getOrgSettings: vi.fn().mockResolvedValue({ slug: "test-org", name: "Test Org" }),
    getEmailSettings: vi.fn().mockResolvedValue({
      enabled: false,
      host: "",
      port: 993,
      useSsl: true,
      username: "",
      folder: "INBOX",
      defaultSupplierId: null,
      hasPassword: false,
      passwordDisplay: null,
      lastPolledAt: null,
      updatedAt: null,
    }),
    getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth", status: "active" }),
    apiClient: { ...actual.apiClient, getSuppliers: vi.fn().mockResolvedValue([]) },
  };
});

import SettingsPage from "./page";

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("Settings — Email intake tab surfaces the inbound address", () => {
  it("renders the hosted inbound address built from the org slug", async () => {
    renderSettings();
    expect(await screen.findByText("test-org@orders.proculink.eu")).toBeInTheDocument();
    expect(screen.getByText("Your inbound email address")).toBeInTheDocument();
  });

  it("keeps the IMAP polling form on the same tab", async () => {
    renderSettings();
    expect(await screen.findByText("Poll inbox for orders")).toBeInTheDocument();
  });
});
