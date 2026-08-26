// The first screen a new organisation sees, and the five requests it used to
// throw away.
//
// THE DEFECT THIS PINS. Clerk mints the session token before the organisation
// claim is attached. On a brand-new workspace's first paint of /bridge, every
// tenant-scoped query fires inside that window, reaches the backend with no
// org_id, and comes back 500 `System.UnauthorizedAccessException: Organisation
// not resolved`. Reproduced on every production smoke run since 2026-08-18 —
// four events each, across /api/orders, /api/orders/summary,
// /api/onboarding/status, /api/settings/organisation and /api/dashboard/topology
// — and every one of those runs reported SUCCESS, because <AutoActivateOrg>
// calls setActive and invalidates the cache, so the page a human ends up looking
// at is correct. The 500s are the doomed first attempts.
//
// This file drives the REAL useTenantQueriesEnabled through a mocked Clerk, so
// what is under test is the gate itself and not a stub of it. The dashboard's own
// hooks — useOnboardingStatus (/api/onboarding/status) and useOrderDirection
// (/api/settings/organisation) — are left REAL for the same reason: those two
// endpoints are on the observed list, and mocking them out would have quietly
// excused the very requests this test exists to catch.
//
// The absence assertions are paired with a control that renders the same
// dashboard with an organisation active and demands every one of those calls
// actually goes out. Without it, a dashboard that fetched nothing under any
// condition would pass.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/bridge",
  useSearchParams: () => new URLSearchParams(),
}));

// ── Clerk: the one knob this file turns ──────────────────────────────────────
// `activeOrgId === null` + one membership IS the activation window: signed in,
// token minted, organisation claim not attached yet, <AutoActivateOrg> about to
// call setActive.
let activeOrgId: string | null = null;
let membershipCount = 1;

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: null, isLoaded: true }),
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: activeOrgId }),
  useOrganizationList: () => ({
    isLoaded: true,
    userMemberships: {
      isLoading: false,
      isError: false,
      count: membershipCount,
      data: Array.from({ length: membershipCount }, (_, i) => ({
        organization: { id: `org_${i}` },
      })),
    },
  }),
}));

const api = {
  getOrders: vi.fn(),
  getOrdersSummary: vi.fn(),
  getSuppliers: vi.fn(),
  getDashboardTopology: vi.fn(),
  getOnboardingStatus: vi.fn(),
  redeliverOrder: vi.fn(),
  transformOrder: vi.fn(),
};
const getOrgSettings = vi.fn();

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  isQaBypass: false,
  getOrgSettings: (...a: unknown[]) => getOrgSettings(...a),
  apiClient: {
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => api.getOrdersSummary(...a),
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getDashboardTopology: (...a: unknown[]) => api.getDashboardTopology(...a),
    getOnboardingStatus: (...a: unknown[]) => api.getOnboardingStatus(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
  },
}));

vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
}));

import { BridgeDashboard } from "./BridgeDashboard";

let seq = 0;
function order(): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-450000000${seq}`,
    supplierName: "ProcuLink Sample Supplier",
    buyerName: "Example Tyre Co",
    orderDate: "2026-08-01T09:00:00Z",
    status: "pending_review",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "pdf",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
  } as OrderSummary;
}

function mockApi() {
  api.getOrders.mockResolvedValue({ items: [order()], totalCount: 1, page: 1, pageSize: 25 });
  api.getOrdersSummary.mockResolvedValue({ byStatus: { pending_review: 1 }, total: 1 });
  api.getSuppliers.mockResolvedValue([]);
  api.getDashboardTopology.mockResolvedValue({ buyers: [], suppliers: [], wires: [] });
  api.getOnboardingStatus.mockResolvedValue({
    hasSupplier: true,
    hasUpload: true,
    hasResolvedMapping: true,
    hasDelivery: true,
  });
  getOrgSettings.mockResolvedValue({ direction: "outbound", slug: "test-org", name: "Test Org" });
}

function renderDashboard() {
  mockApi();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfirmProvider>
        <BridgeDashboard />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

/** Let every mount effect and query-scheduler tick land before asserting an absence. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The five endpoints the production smoke runs caught answering 500. */
function observedFiveHundreds() {
  return {
    "/api/orders": api.getOrders,
    "/api/orders/summary": api.getOrdersSummary,
    "/api/onboarding/status": api.getOnboardingStatus,
    "/api/settings/organisation": getOrgSettings,
    "/api/dashboard/topology": api.getDashboardTopology,
  };
}

beforeEach(() => {
  seq = 0;
  activeOrgId = null;
  membershipCount = 1;
  Object.values(api).forEach((f) => f.mockReset());
  getOrgSettings.mockReset();
});
afterEach(cleanup);

describe("the dashboard waits for the organisation claim before asking for anything", () => {
  it("sends none of the five requests while activation is still pending", async () => {
    activeOrgId = null;
    membershipCount = 1;
    const { container } = renderDashboard();
    await settle();

    // Anti-vacuity: the dashboard really mounted and painted its stat cards, so
    // "no calls" below is a decision the gate made, not the absence of a
    // component. Scoped with within() — jsdom has no Tailwind, so BOTH the
    // desktop and the mobile tree render and an unscoped query sees each twice.
    expect(
      within(container).getAllByText(/Suppliers/i).length,
      "the dashboard did not render, so this test proves nothing",
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll("[data-stat-card]").length,
      "the dashboard did not render its stat cards, so this test proves nothing",
    ).toBeGreaterThan(0);

    for (const [endpoint, fn] of Object.entries(observedFiveHundreds())) {
      expect(
        fn,
        `${endpoint} fired before the organisation claim existed — that request 500s ` +
          "with 'Organisation not resolved'",
      ).not.toHaveBeenCalled();
    }
  });

  it("sends nothing while a second membership is waiting to be activated either", async () => {
    activeOrgId = null;
    membershipCount = 3;
    renderDashboard();
    await settle();

    for (const fn of Object.values(observedFiveHundreds())) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  // The control. Everything the three tests above claim is withheld must actually
  // go out once there is an organisation to scope it to — otherwise "no calls" is
  // satisfied by a dashboard that never fetches at all.
  it("sends all five once an organisation is active", async () => {
    activeOrgId = "org_live";
    renderDashboard();

    await waitFor(() => {
      for (const [endpoint, fn] of Object.entries(observedFiveHundreds())) {
        expect(fn, `${endpoint} never fired even with an organisation active`).toHaveBeenCalled();
      }
    });
  });

  // The legacy sub-keyed tenant: no Clerk organisation, no claim, ever. The
  // backend resolves them from their own Clerk user id
  // (TenantResolutionMiddleware branch 2). A gate that waited for a claim they
  // will never have would leave this workspace permanently blank.
  it("sends all five for a user with no Clerk organisation at all", async () => {
    activeOrgId = null;
    membershipCount = 0;
    renderDashboard();

    await waitFor(() => {
      for (const [endpoint, fn] of Object.entries(observedFiveHundreds())) {
        expect(
          fn,
          `${endpoint} was withheld from a legacy sub-keyed org — that workspace never loads`,
        ).toHaveBeenCalled();
      }
    });
  });
});
