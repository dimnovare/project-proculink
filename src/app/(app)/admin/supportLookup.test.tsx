import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// /admin — the PO-number support lookup (GET /api/admin/orders/find).
//
// THE GAP THIS PINS. AdminController exposes eleven endpoints; /admin called four
// (overview, organisations, invoices, limits — src/lib/api/billing.ts). The newest of
// the other seven, `GET /api/admin/orders/find`, is the single most-used support tool
// there is: a customer emails "PO 4500012580 never arrived" and the founder has no way,
// from any screen, to learn WHICH workspace owns that PO. It was reachable only by curl.
//
// Two things are asserted beyond "a box exists":
//
//  1. A FAILED LOOKUP IS NOT AN EMPTY ONE. `isError` unbranched is the exact defect
//     family fixed across eight surfaces this month — a rejected fetch rendering as
//     "no results" tells the founder the PO does not exist in any workspace, which is
//     the opposite of what happened. The error must announce itself (role="alert") and
//     offer a retry.
//
//  2. THE COPY DOES NOT OVERPROMISE. The founder holds no membership in a customer's
//     organisation, so there is no order screen to open from here. The result must say
//     so rather than implying a drill-down that does not exist.

import AdminPage from "./page";
import type { AdminOverview, AdminOrganisation } from "@/lib/api-client";

const getAdminOverview = vi.fn();
const getAdminOrganisations = vi.fn();
const findAdminOrdersByPo = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    isApiMockMode: false,
    getAdminOverview: (...a: unknown[]) => getAdminOverview(...a),
    getAdminOrganisations: (...a: unknown[]) => getAdminOrganisations(...a),
    findAdminOrdersByPo: (...a: unknown[]) => findAdminOrdersByPo(...a),
  };
});

afterEach(() => {
  cleanup();
  getAdminOverview.mockReset();
  getAdminOrganisations.mockReset();
  findAdminOrdersByPo.mockReset();
});

const OVERVIEW: AdminOverview = {
  mrr: 548,
  arr: 6576,
  stripeMrr: 548,
  reconciled: true,
  countsByAccountStatus: { active: 2, trialing: 1 },
  newOrgsThisMonth: 1,
  trialToPaidConversion: 0.5,
};

function org(over: Partial<AdminOrganisation> = {}): AdminOrganisation {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Nordmark Industries",
    slug: "nordmark-industries",
    plan: "growth",
    accountStatus: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    mrrContribution: 149,
    createdAt: new Date("2026-06-01").toISOString(),
    lastOrderActivity: new Date("2026-08-20").toISOString(),
    orderVolume30d: 31,
    supplierCount: 4,
    ...over,
  };
}

async function renderAdmin(orgs: AdminOrganisation[] = [org()]): Promise<void> {
  getAdminOverview.mockResolvedValue(OVERVIEW);
  getAdminOrganisations.mockResolvedValue(orgs);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AdminPage />
    </QueryClientProvider>,
  );
  await screen.findByText("Customers");
}

/** The lookup form, scoped so nothing here can match an unrelated input elsewhere. */
function lookup(): HTMLElement {
  return screen.getByTestId("admin-order-find");
}

async function search(po: string): Promise<void> {
  const box = within(lookup()).getByRole("searchbox", { name: /po number/i });
  fireEvent.change(box, { target: { value: po } });
  fireEvent.click(within(lookup()).getByRole("button", { name: /find order/i }));
}

describe("admin — the PO-number lookup exists and is the first thing on the page", () => {
  it("renders a PO search box", async () => {
    await renderAdmin();
    expect(within(lookup()).getByRole("searchbox", { name: /po number/i })).toBeTruthy();
  });

  it("puts the lookup ahead of the revenue cards in document order", async () => {
    // "Customer just emailed me" is the entry point, so it leads. If it drifts below
    // the KPI strip this fails rather than being noticed by nobody.
    await renderAdmin();
    // "MRR" appears three times — the KPI card, the desktop column header and the
    // mobile card (jsdom mounts both breakpoint trees). EVERY one must follow the
    // lookup, which is a stronger statement than picking one of them.
    const mrrNodes = screen.getAllByText("MRR");
    expect(mrrNodes.length).toBeGreaterThan(0);
    for (const node of mrrNodes) {
      expect(lookup().compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("does not call the API before a PO number is submitted", async () => {
    await renderAdmin();
    expect(findAdminOrdersByPo).not.toHaveBeenCalled();
  });
});

describe("admin — a lookup result names the owning workspace", () => {
  it("shows the org, order id, status and supplier for a match", async () => {
    await renderAdmin();
    findAdminOrdersByPo.mockResolvedValue({
      count: 1,
      capped: false,
      matches: [
        {
          orgId: "11111111-1111-1111-1111-111111111111",
          orgName: "Nordmark Industries",
          orgSlug: "nordmark-industries",
          orderId: "aaaaaaaa-0000-0000-0000-000000000001",
          status: "delivery_failed",
          supplierName: "Westmark Components",
          poNumber: "4500012580",
          createdAt: new Date("2026-08-18T09:00:00Z").toISOString(),
          updatedAt: new Date("2026-08-19T11:30:00Z").toISOString(),
        },
      ],
    });

    await search("4500012580");

    const panel = lookup();
    expect(await within(panel).findByText("Nordmark Industries")).toBeTruthy();
    expect(within(panel).getByText("nordmark-industries")).toBeTruthy();
    expect(within(panel).getByText(/aaaaaaaa-0000-0000-0000-000000000001/)).toBeTruthy();
    expect(within(panel).getByText("Westmark Components")).toBeTruthy();
    expect(findAdminOrdersByPo).toHaveBeenCalledWith("4500012580");
  });

  it("says plainly that there is no order screen to open from here", async () => {
    // The founder is not a member of the customer's organisation. A result that
    // looked like a link into the order would be a promise the product cannot keep.
    await renderAdmin();
    findAdminOrdersByPo.mockResolvedValue({
      count: 1,
      capped: false,
      matches: [
        {
          orgId: "11111111-1111-1111-1111-111111111111",
          orgName: "Nordmark Industries",
          orgSlug: "nordmark-industries",
          orderId: "aaaaaaaa-0000-0000-0000-000000000001",
          status: "delivered",
          supplierName: null,
          poNumber: "4500012580",
          createdAt: new Date("2026-08-18T09:00:00Z").toISOString(),
          updatedAt: new Date("2026-08-18T09:05:00Z").toISOString(),
        },
      ],
    });

    await search("4500012580");

    const panel = lookup();
    await within(panel).findByText("Nordmark Industries");
    expect(within(panel).getByTestId("admin-order-find-limit").textContent ?? "").toMatch(
      /not a member|no membership|cannot open/i,
    );
  });

  it("says when the result was capped instead of implying it is the whole set", async () => {
    await renderAdmin();
    findAdminOrdersByPo.mockResolvedValue({
      count: 20,
      capped: true,
      matches: Array.from({ length: 20 }, (_, i) => ({
        orgId: "11111111-1111-1111-1111-111111111111",
        orgName: "Nordmark Industries",
        orgSlug: "nordmark-industries",
        orderId: `aaaaaaaa-0000-0000-0000-00000000000${i % 10}`,
        status: "delivered",
        supplierName: null,
        poNumber: "4500012580",
        createdAt: new Date("2026-08-18T09:00:00Z").toISOString(),
        updatedAt: new Date("2026-08-18T09:05:00Z").toISOString(),
      })),
    });

    await search("4500012580");

    expect(await within(lookup()).findByText(/more matched|first 20|capped/i)).toBeTruthy();
  });

  it("reports a genuinely empty result as empty", async () => {
    await renderAdmin();
    findAdminOrdersByPo.mockResolvedValue({ count: 0, capped: false, matches: [] });

    await search("NOPE-1");

    expect(await within(lookup()).findByText(/no order/i)).toBeTruthy();
    // Floor: the empty state is not the error state wearing different words.
    expect(within(lookup()).queryByRole("alert")).toBeNull();
  });
});

describe("admin — a failed lookup is never rendered as 'no results'", () => {
  it("announces the failure and offers a retry", async () => {
    await renderAdmin();
    findAdminOrdersByPo.mockRejectedValue(new Error("admin/orders/find: 503"));

    await search("4500012580");

    const alert = await within(lookup()).findByRole("alert");
    expect(alert.getAttribute("data-notice-tone")).toBe("error");
    expect(within(lookup()).getByRole("button", { name: /retry/i })).toBeTruthy();
    // The whole point: it must NOT claim the PO is absent from every workspace.
    expect(within(lookup()).queryByText(/no order in any workspace/i)).toBeNull();
  });

  it("retry re-issues the same lookup", async () => {
    await renderAdmin();
    findAdminOrdersByPo.mockRejectedValue(new Error("admin/orders/find: 503"));

    await search("4500012580");
    await within(lookup()).findByRole("alert");
    expect(findAdminOrdersByPo).toHaveBeenCalledTimes(1);

    findAdminOrdersByPo.mockResolvedValue({ count: 0, capped: false, matches: [] });
    fireEvent.click(within(lookup()).getByRole("button", { name: /retry/i }));

    expect(await within(lookup()).findByText(/no order/i)).toBeTruthy();
    expect(findAdminOrdersByPo).toHaveBeenLastCalledWith("4500012580");
  });
});
