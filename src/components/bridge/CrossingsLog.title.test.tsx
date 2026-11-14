import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// The Activity page names itself. Since plan 14 every page shows a visible
// title through PageHeader, so the page keeps exactly one h1 and it is not
// visually hidden.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/operations/log",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { firstName: "Alex" }, isLoaded: true }),
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
  },
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

/** Exactly one h1 whose text matches, and it is not visually hidden. */
function expectSingleH1(text: string) {
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(text);
  expect(headings[0]).not.toHaveClass("sr-only");
}

describe("the Activity page names itself", () => {
  it("Activity: visible h1", async () => {
    renderPage(<CrossingsLog />);
    await waitFor(() => expectSingleH1("Activity"));
  });
});
