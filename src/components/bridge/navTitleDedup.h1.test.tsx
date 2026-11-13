import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// Nav dedup (founder-approved mock 3, 2026-07): the active topbar tab IS the
// page name — pages stopped re-announcing it visually but MUST keep exactly one
// h1 (sr-only) so heading hierarchy and getByRole("heading") queries survive.
//
// This file renders the Deliveries page end-to-end (Overview and Orders went
// with the order screens on 2026-11-13). The remaining audited pages
// (exceptions, connectors, webhooks, invoices, ASNs) run their h1 through the SAME
// PageHeader `titleHidden` mechanism, whose contract — including the
// kept-visible variant, which used to be demonstrated here by the now-retired
// Drafts page — is pinned directly in layout/PageHeader.test.tsx.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/operations/log",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { firstName: "Dim" }, isLoaded: true }),
  useOrganization: () => ({ organization: null }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
// One order list feeds every page under test; the dashboard cases swap it.
// (Referenced only from inside the mock factory's functions, which run at query
// time — vi.mock hoisting means no top-level value may be read at factory time.)
let orders: OrderSummary[] = [];

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getOrders: () => Promise.resolve({ items: orders, totalCount: orders.length, page: 1, pageSize: 100 }),
    getOrdersSummary: () => Promise.resolve({ byStatus: {}, total: orders.length }),
    getSuppliers: () => Promise.resolve([]),
    getDashboardTopology: () => Promise.resolve({ buyers: [], suppliers: [], wires: [] }),
    // never settles — honest loading state
    getOnboardingStatus: () => new Promise(() => {}),
  },
  listConnections: () => Promise.resolve([]),
  getAuditLog: () => Promise.resolve([]),
  getBillingStatus: () => Promise.resolve({ plan: "growth", canAddSupplier: true, supplierLimit: 5 }),
}));

import { CrossingsLog } from "./CrossingsLog";

afterEach(() => {
  cleanup();
  orders = [];
});

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </QueryClientProvider>,
  );
}

/** Exactly one h1 whose text matches; sr-only unless `visible`. */
function expectSingleH1(text: string, opts: { visible?: boolean } = {}) {
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(text);
  if (opts.visible) {
    expect(headings[0]).not.toHaveClass("sr-only");
  } else {
    expect(headings[0]).toHaveClass("sr-only");
  }
}

describe("nav dedup — each audited page keeps exactly one h1", () => {
  it("Deliveries: sr-only h1", async () => {
    renderPage(<CrossingsLog />);
    await waitFor(() => expectSingleH1("Deliveries"));
  });
});
