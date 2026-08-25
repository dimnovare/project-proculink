// The Email-intake tab must surface the org's inbound address — the zero-setup
// intake path — not only the API-keys tab. Founder request 2026-07-24: "if easy,
// we should do and provide instructions".
//
// CHANGED 2026-08-13. The address used to be built in the browser from the org
// slug (`{slug}@orders.proculink.eu`). The backend now ISSUES addresses
// (GET /api/settings/inbound-email) and the slug address is a legacy row with a
// 90-day expiry, so a browser-derived string was showing a soon-to-die address
// as if it were permanent. This test now pins that the tab renders the SERVER'S
// address, which is what makes rotation and revocation visible at all.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getBillingStatus = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=email"),
  usePathname: () => "/settings",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));

vi.mock("@/lib/api/inboundEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/inboundEmail")>();
  return {
    ...actual,
    getInboundAddresses: vi.fn().mockResolvedValue([
      {
        id: "addr-1",
        kind: "primary",
        label: "Primary",
        address: "a1b2c3d4e5f6@orders.proculink.eu",
        prefix: "a1b2",
        isActive: true,
        createdAt: "2026-08-01T00:00:00Z",
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      },
    ]),
  };
});

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
    getBillingStatus: () => getBillingStatus(),
    apiClient: { ...actual.apiClient, getSuppliers: vi.fn().mockResolvedValue([]) },
  };
});

import SettingsPage from "./page";
import { minimumPlanId } from "@/lib/gatedCapabilities";
import { PLANS } from "@/lib/plans";

// Tiers DERIVED from the registries, never typed: a literal plan name here is how a re-tiered
// gate keeps passing against stale copy.
const EMAIL_MINIMUM = minimumPlanId("emailIngestion");
const PLAN_BELOW = PLANS[PLANS.findIndex((p) => p.id === EMAIL_MINIMUM) - 1];

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Default: the cheapest plan that really includes email intake, derived from the gate table.
  getBillingStatus.mockResolvedValue({ plan: EMAIL_MINIMUM, status: "active" });
});

afterEach(cleanup);

describe("Settings — Email intake tab surfaces the inbound address", () => {
  it("renders the address the server issued", async () => {
    renderSettings();
    expect(await screen.findByText("a1b2c3d4e5f6@orders.proculink.eu")).toBeInTheDocument();
    expect(screen.getByText("Your inbound email address")).toBeInTheDocument();
  });

  // The slug is still fetched for the REST endpoint row on the API-keys tab, so a
  // regression could quietly reinstate the derived address. Pin its absence.
  it("does not render an address derived from the org slug", async () => {
    renderSettings();
    await screen.findByText("a1b2c3d4e5f6@orders.proculink.eu");
    expect(screen.queryByText("test-org@orders.proculink.eu")).not.toBeInTheDocument();
  });

  it("keeps the IMAP polling form on the same tab", async () => {
    renderSettings();
    expect(await screen.findByText("Poll inbox for orders")).toBeInTheDocument();
  });
});

describe("Settings — the no-setup import promise is plan-gated", () => {
  // Hosted inbound mail is gated on the backend at `emailIngestion` while the address is minted
  // for every org — and a refused message is silent: no bounce, nothing shown in the app. So
  // "imported automatically" may only render once billing CONFIRMS the plan includes it.

  it("keeps the promise when the plan is confirmed to include email intake", async () => {
    renderSettings();
    expect(await screen.findByText(/imported automatically/i)).toBeInTheDocument();
  });

  it("drops the promise on the tier below the gate and discloses the refusal instead", async () => {
    getBillingStatus.mockResolvedValue({ plan: PLAN_BELOW.id, status: "active" });
    renderSettings();

    // The section's own disclosure renders, with the consequence.
    expect(await screen.findByTestId("inbound-address-plan-gate")).toBeInTheDocument();
    expect(screen.queryByText(/imported automatically/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/needs no setup/i)).not.toBeInTheDocument();
    // The address is still shown — it exists; only the promise about it was false.
    expect(await screen.findByText("a1b2c3d4e5f6@orders.proculink.eu")).toBeInTheDocument();
  });

  it("makes no automatic-import claim when the billing read failed", async () => {
    getBillingStatus.mockRejectedValue(new Error("boom"));
    renderSettings();

    await screen.findByText("a1b2c3d4e5f6@orders.proculink.eu");
    expect(screen.queryByText(/imported automatically/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/needs no setup/i)).not.toBeInTheDocument();
    // …and no refusal either: an unread plan is not a plan that excludes it.
    expect(screen.queryByTestId("inbound-address-plan-gate")).not.toBeInTheDocument();
  });
});
