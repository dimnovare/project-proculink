import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// THE THIRD WAY THESE PANELS CAN LIE, and the one the error-branch tests do not cover.
//
// Found by driving the real screen rather than jsdom: every one of these queries is
// `enabled: queryEnabled && …`, and `useQueriesEnabled` is false for the window in
// which Clerk has not finished loading. A DISABLED TanStack query is not loading and
// not errored — `isLoading` is false, `isError` is false, and `data` is `undefined`.
//
// So a chain written as
//
//     isLoading ? spinner : isError ? error : (data?.matches.length ?? 0) === 0 ? empty : rows
//
// falls straight through to EMPTY. The founder submits a PO number during that window
// and is told "No order in any workspace carries the PO number 4500012580" — a verdict
// about every customer's data, produced without one request leaving the browser. Same
// shape as the eight `isError`-unbranched surfaces fixed this month, arriving through a
// different door: not a failed fetch, an ABSENT one.
//
// The fix is to branch on `data === undefined` BEFORE the emptiness check, so an answer
// is only reported once there is one. These tests pin that for all three read panels.

import AdminPage from "./page";
import { JobFailuresPanel, ItemMappingTwinsPanel } from "./DiagnosticsPanels";
import type { AdminOverview } from "@/lib/api-client";

const getAdminOverview = vi.fn();
const getAdminOrganisations = vi.fn();
const findAdminOrdersByPo = vi.fn();
const getAdminJobFailures = vi.fn();
const getAdminItemMappingTwins = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));

// The whole point of this file: queries are NOT enabled.
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => false, useTenantQueriesEnabled: () => false }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    isApiMockMode: false,
    getAdminOverview: (...a: unknown[]) => getAdminOverview(...a),
    getAdminOrganisations: (...a: unknown[]) => getAdminOrganisations(...a),
    findAdminOrdersByPo: (...a: unknown[]) => findAdminOrdersByPo(...a),
    getAdminJobFailures: (...a: unknown[]) => getAdminJobFailures(...a),
    getAdminItemMappingTwins: (...a: unknown[]) => getAdminItemMappingTwins(...a),
  };
});

afterEach(() => {
  cleanup();
  getAdminOverview.mockReset();
  getAdminOrganisations.mockReset();
  findAdminOrdersByPo.mockReset();
  getAdminJobFailures.mockReset();
  getAdminItemMappingTwins.mockReset();
});

const OVERVIEW: AdminOverview = {
  mrr: 0,
  arr: 0,
  stripeMrr: null,
  reconciled: false,
  countsByAccountStatus: {},
  newOrgsThisMonth: 0,
  trialToPaidConversion: 0,
};

function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("admin — nothing reports an answer before it has asked", () => {
  it("the PO lookup does not declare the number absent while queries are disabled", () => {
    getAdminOverview.mockResolvedValue(OVERVIEW);
    getAdminOrganisations.mockResolvedValue([]);
    render(
      <QueryClientProvider client={client()}>
        <AdminPage />
      </QueryClientProvider>,
    );

    const panel = screen.getByTestId("admin-order-find");
    fireEvent.change(within(panel).getByRole("searchbox", { name: /po number/i }), {
      target: { value: "4500012580" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: /find order/i }));

    expect(findAdminOrdersByPo).not.toHaveBeenCalled();
    // The verdict must not be on screen — neither the empty state nor its sentence.
    expect(within(panel).queryByTestId("admin-order-find-empty")).toBeNull();
    expect(within(panel).queryByText(/no order in any workspace/i)).toBeNull();
    // And it must not silently show nothing either: say why there is no answer.
    expect(within(panel).getByTestId("admin-order-find-pending")).toBeTruthy();
  });

  it("the job-failures panel does not read as an all-clear while queries are disabled", () => {
    render(
      <QueryClientProvider client={client()}>
        <JobFailuresPanel />
      </QueryClientProvider>,
    );

    const panel = screen.getByTestId("admin-job-failures");
    fireEvent.click(within(panel).getByRole("button", { expanded: false }));

    expect(getAdminJobFailures).not.toHaveBeenCalled();
    expect(within(panel).queryByTestId("admin-job-failures-empty")).toBeNull();
    expect(within(panel).queryByText(/no failed jobs/i)).toBeNull();
  });

  it("the twins panel does not claim there are none while queries are disabled", () => {
    render(
      <QueryClientProvider client={client()}>
        <ItemMappingTwinsPanel />
      </QueryClientProvider>,
    );

    const panel = screen.getByTestId("admin-item-mapping-twins");
    fireEvent.click(within(panel).getByRole("button", { expanded: false }));

    expect(getAdminItemMappingTwins).not.toHaveBeenCalled();
    expect(within(panel).queryByTestId("admin-item-mapping-twins-empty")).toBeNull();
    expect(within(panel).queryByText(/no case-variant twins/i)).toBeNull();
  });
});
