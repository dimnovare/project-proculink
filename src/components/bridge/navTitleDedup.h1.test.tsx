import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// Nav dedup (founder-approved mock 3, 2026-07): the active topbar tab IS the
// page name — pages stopped re-announcing it visually but MUST keep exactly one
// h1 (sr-only) so heading hierarchy and getByRole("heading") queries survive.
//
// This file renders a representative slice of the audited pages end-to-end:
// Overview, Orders, Suppliers, Connections, Deliveries, System status and
// Format reference. The remaining audited pages (buyers, mappings, exceptions,
// connectors, webhooks, invoices, ASNs) run their h1 through the SAME
// PageHeader `titleHidden` mechanism, whose contract — including the
// kept-visible variant, which used to be demonstrated here by the now-retired
// Drafts page — is pinned directly in layout/PageHeader.test.tsx.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/bridge",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { firstName: "Dim" }, isLoaded: true }),
  useOrganization: () => ({ organization: null }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
}));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    direction: "outbound",
    labels: {
      counterpartyNoun: "Supplier",
      counterpartyPlural: "Suppliers",
      railHeader: "Buyer → Supplier",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent to supplier",
      deliveredLabel: "Delivered to supplier",
      unknownBuyer: "Unknown buyer",
    },
  }),
}));

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
  getOpsHealth: () => new Promise(() => {}),
  getDeadLetterOrders: () => Promise.resolve([]),
  requeueDelivery: vi.fn(),
}));

import { BridgeDashboard } from "./BridgeDashboard";
import { InboxView } from "./InboxView";
import { SupplierDockList } from "./SupplierDockList";
import { CrossingsLog } from "./CrossingsLog";
import { ConnectionsList } from "@/components/connections/ConnectionsList";
import OperationsHealthPage from "@/app/(app)/operations/health/page";
import StandardsPage from "@/app/(app)/library/standards/page";

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

function blockedOrder(): OrderSummary {
  return {
    id: "ord-1",
    poNumber: "PO-1001",
    supplierName: "Nordmark",
    buyerName: "Heinrich Industries GmbH",
    orderDate: "2026-07-01T09:00:00Z",
    status: "pending_review" as OrderSummary["status"],
    lineCount: 3,
    unresolvedCount: 2,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "pdf",
    createdAt: "2026-07-16T09:00:00Z",
  };
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
  it("Overview: sr-only h1 + context line greeting", async () => {
    renderPage(<BridgeDashboard />);
    expectSingleH1("Overview");
    // Context line greeting renders after mount (client-clock guard).
    expect(await screen.findByText(/^Good (morning|afternoon|evening), Dim$/)).toBeInTheDocument();
  });

  it("Overview context line: 0 blockers reads All clear with no jump link", async () => {
    renderPage(<BridgeDashboard />);
    expect(await screen.findByText("All clear")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Jump to blockers/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/0 blockers/)).not.toBeInTheDocument();
  });

  it("Overview context line: a blocked order yields the count + jump link to #needs-you", async () => {
    orders = [blockedOrder()];
    renderPage(<BridgeDashboard />);
    expect(await screen.findByText("1 blocker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Jump to blockers/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.getElementById("needs-you")).not.toBeNull();
    });
  });

  it("Orders: sr-only h1", async () => {
    renderPage(<InboxView />);
    await waitFor(() => expectSingleH1("Orders"));
  });

  it("Suppliers: sr-only h1", async () => {
    renderPage(<SupplierDockList />);
    await waitFor(() => expectSingleH1("Suppliers"));
  });

  it("Connections: sr-only h1", async () => {
    renderPage(<ConnectionsList />);
    await waitFor(() => expectSingleH1("Connections"));
  });

  it("Deliveries: sr-only h1", async () => {
    renderPage(<CrossingsLog />);
    await waitFor(() => expectSingleH1("Deliveries"));
  });

  it("System status: sr-only h1", () => {
    renderPage(<OperationsHealthPage />);
    expectSingleH1("System status");
  });

  it("Format reference: sr-only h1", () => {
    renderPage(<StandardsPage />);
    expectSingleH1("Format reference");
  });

});
