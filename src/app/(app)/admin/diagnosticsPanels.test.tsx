import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// /admin — the two read-only diagnostics endpoints that were curl-only.
//
//   GET /api/admin/job-failures        recent Hangfire failures
//   GET /api/admin/item-mapping-twins  learned mappings differing only in CASE
//
// Both are DIAGNOSTICS, not a dashboard: they open collapsed and cost nothing until
// someone asks for them (the query must not fire while the panel is shut).
//
// THE TRAP EACH ONE CARRIES, and why the assertions look the way they do:
//
//   • job-failures is DEFENSIVELY EMPTY on the backend. When the Hangfire monitoring
//     API is unavailable AdminController catches, logs a warning, and returns
//     `{ totalFailed: 0, shown: 0, failures: [] }` — a 200 that is indistinguishable
//     from a healthy worker. So "no failures" here must NOT be worded as proof the
//     worker is fine, and a rejected FETCH must not land in the same empty state.
//
//   • item-mapping-twins is read-only by design; the panel must not offer a merge it
//     cannot perform, and must carry the server's own note saying so.

import AdminPage from "./page";
import type { AdminOverview, AdminOrganisation } from "@/lib/api-client";

const getAdminOverview = vi.fn();
const getAdminOrganisations = vi.fn();
const getAdminJobFailures = vi.fn();
const getAdminItemMappingTwins = vi.fn();

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
    getAdminJobFailures: (...a: unknown[]) => getAdminJobFailures(...a),
    getAdminItemMappingTwins: (...a: unknown[]) => getAdminItemMappingTwins(...a),
  };
});

afterEach(() => {
  cleanup();
  getAdminOverview.mockReset();
  getAdminOrganisations.mockReset();
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

const ORG: AdminOrganisation = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Nordmark Industries",
  slug: "nordmark-industries",
  plan: "growth",
  accountStatus: "active",
  stripeCustomerId: null,
  stripeSubscriptionId: "sub_1",
  mrrContribution: 149,
  createdAt: new Date("2026-06-01").toISOString(),
  lastOrderActivity: null,
  orderVolume30d: 0,
  supplierCount: 1,
};

async function renderAdmin(): Promise<void> {
  getAdminOverview.mockResolvedValue(OVERVIEW);
  getAdminOrganisations.mockResolvedValue([ORG]);
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

function panel(id: "admin-job-failures" | "admin-item-mapping-twins"): HTMLElement {
  return screen.getByTestId(id);
}

/** Opens a collapsed diagnostics panel by its disclosure button. */
function open(id: "admin-job-failures" | "admin-item-mapping-twins"): void {
  const p = panel(id);
  fireEvent.click(within(p).getByRole("button", { expanded: false }));
}

describe("admin — job failures", () => {
  it("is collapsed by default and fetches nothing until opened", async () => {
    await renderAdmin();
    expect(within(panel("admin-job-failures")).getByRole("button", { expanded: false })).toBeTruthy();
    expect(getAdminJobFailures).not.toHaveBeenCalled();
  });

  it("lists the method, exception and reason of each failure once opened", async () => {
    await renderAdmin();
    getAdminJobFailures.mockResolvedValue({
      totalFailed: 2,
      shown: 1,
      failures: [
        {
          id: "job-91",
          job: "ParseOrderJob.RunAsync",
          exceptionType: "System.TimeoutException",
          exceptionMessage: "The operation has timed out.",
          reason: "Job failed on attempt 3",
          failedAt: new Date("2026-08-20T07:04:00Z").toISOString(),
        },
      ],
    });

    open("admin-job-failures");

    const p = panel("admin-job-failures");
    expect(await within(p).findByText("ParseOrderJob.RunAsync")).toBeTruthy();
    expect(within(p).getByText("System.TimeoutException")).toBeTruthy();
    expect(within(p).getByText(/The operation has timed out\./)).toBeTruthy();
    expect(within(p).getByText(/Job failed on attempt 3/)).toBeTruthy();
  });

  it("does not present an empty list as proof the worker is healthy", async () => {
    // The backend returns an empty list when the Hangfire job store is UNREACHABLE.
    // Copy that reads "no failures — all good" would be a claim the response cannot
    // support, on the one panel whose job is to notice a broken worker.
    await renderAdmin();
    getAdminJobFailures.mockResolvedValue({ totalFailed: 0, shown: 0, failures: [] });

    open("admin-job-failures");

    const p = panel("admin-job-failures");
    const empty = await within(p).findByTestId("admin-job-failures-empty");
    expect(empty.textContent ?? "").toMatch(/unreachable|unavailable|not proof|cannot tell/i);
  });

  it("renders a distinct, announced error — not an empty list — when the fetch fails", async () => {
    await renderAdmin();
    getAdminJobFailures.mockRejectedValue(new Error("admin/job-failures: 502"));

    open("admin-job-failures");

    const p = panel("admin-job-failures");
    const alert = await within(p).findByRole("alert");
    expect(alert.getAttribute("data-notice-tone")).toBe("error");
    expect(within(p).getByRole("button", { name: /retry/i })).toBeTruthy();
    expect(within(p).queryByTestId("admin-job-failures-empty")).toBeNull();
  });
});

describe("admin — case-variant item mapping twins", () => {
  it("is collapsed by default and fetches nothing until opened", async () => {
    await renderAdmin();
    expect(within(panel("admin-item-mapping-twins")).getByRole("button", { expanded: false })).toBeTruthy();
    expect(getAdminItemMappingTwins).not.toHaveBeenCalled();
  });

  it("lists each group's folded code and spellings, and repeats the server's read-only note", async () => {
    await renderAdmin();
    getAdminItemMappingTwins.mockResolvedValue({
      totalGroups: 1,
      note: "Read-only. Merging or deleting a twin changes a customer's item codes.",
      groups: [
        {
          organisationId: "11111111-1111-1111-1111-111111111111",
          supplierId: "22222222-2222-2222-2222-222222222222",
          foldedCode: "blt-m8",
          rowCount: 2,
          spellings: ["BLT-M8", "blt-m8"],
        },
      ],
    });

    open("admin-item-mapping-twins");

    const p = panel("admin-item-mapping-twins");
    expect(await within(p).findByText("blt-m8")).toBeTruthy();
    expect(within(p).getByText(/BLT-M8/)).toBeTruthy();
    expect(within(p).getByText(/Read-only\./)).toBeTruthy();
    // Read-only means read-only: no merge/delete control may appear here.
    expect(within(p).queryByRole("button", { name: /merge|delete/i })).toBeNull();
  });

  it("renders a distinct, announced error — not 'no twins' — when the fetch fails", async () => {
    await renderAdmin();
    getAdminItemMappingTwins.mockRejectedValue(new Error("admin/item-mapping-twins: 500"));

    open("admin-item-mapping-twins");

    const p = panel("admin-item-mapping-twins");
    const alert = await within(p).findByRole("alert");
    expect(alert.getAttribute("data-notice-tone")).toBe("error");
    expect(within(p).getByRole("button", { name: /retry/i })).toBeTruthy();
    expect(within(p).queryByTestId("admin-item-mapping-twins-empty")).toBeNull();
  });
});
