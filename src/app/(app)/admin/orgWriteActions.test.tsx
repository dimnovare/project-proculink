import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// /admin — the two reversible WRITES that were curl-only, on the customers row.
//
//   POST /api/admin/organisations/{id}/account-status   un-freeze a Pilot workspace
//   POST /api/admin/organisations/{id}/retention        set/clear the blob-retention window
//
// ── THE RULE THE ACCOUNT-STATUS CONTROL HAS TO OBEY ──────────────────────────────
//
// Never offer an action the server will refuse. AdminController.SetOrganisationAccountStatus
// permits EXACTLY ONE transition and answers 400 to everything else:
//
//   requested must be `trialing`  · org must currently be `read_only`
//   org must have NO live Stripe subscription  · org must be on the Pilot plan
//
// A button that appears on every row and 400s on most of them is worse than no button:
// it teaches the founder that the admin area lies. So eligibility is computed from the
// row the table already holds, and the tests below check BOTH directions — the eligible
// row offers it, and each of the three refusal shapes does not.
//
// ── AND NEITHER WRITE FIRES ON ONE CLICK ─────────────────────────────────────────
//
// Un-freezing re-opens every ingest path for a workspace with no subscription behind it.
// Lowering a retention window hands the next sweep permission to delete stored files.
// Both are confirmed in a dialog that names the consequence; the row control opens the
// dialog and calls nothing.
//
// ── SUCCESS IS NOT ASSUMED ───────────────────────────────────────────────────────
//
// The account-status response reports the EFFECTIVE status after the canonical trial-window
// arbiter has had its say. `revertedByTrialWindow: true` means the org is frozen again. A
// green "un-frozen" banner on that response is the "unknown renders as success" defect with
// the server explicitly saying otherwise, so it is pinned here.

import AdminPage from "./page";
import type { AdminOverview, AdminOrganisation } from "@/lib/api-client";

const getAdminOverview = vi.fn();
const getAdminOrganisations = vi.fn();
const setOrgAccountStatus = vi.fn();
const setOrgRetention = vi.fn();

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
    setOrgAccountStatus: (...a: unknown[]) => setOrgAccountStatus(...a),
    setOrgRetention: (...a: unknown[]) => setOrgRetention(...a),
  };
});

afterEach(() => {
  cleanup();
  getAdminOverview.mockReset();
  getAdminOrganisations.mockReset();
  setOrgAccountStatus.mockReset();
  setOrgRetention.mockReset();
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

const ORG_ID = "11111111-1111-1111-1111-111111111111";

function org(over: Partial<AdminOrganisation> = {}): AdminOrganisation {
  return {
    id: ORG_ID,
    name: "Nordmark Tooling",
    slug: "nordmark-tooling",
    plan: "pilot",
    accountStatus: "read_only",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    mrrContribution: 0,
    createdAt: new Date("2026-06-01").toISOString(),
    lastOrderActivity: null,
    orderVolume30d: 0,
    supplierCount: 1,
    ...over,
  };
}

async function renderAdmin(rows: AdminOrganisation[]): Promise<HTMLElement> {
  getAdminOverview.mockResolvedValue(OVERVIEW);
  getAdminOrganisations.mockResolvedValue(rows);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AdminPage />
    </QueryClientProvider>,
  );
  await screen.findByText("Customers");
  // jsdom has no Tailwind, so the `hidden md:block` desktop table AND the
  // `md:hidden` mobile list BOTH mount. Every query below is scoped to the
  // desktop table so a duplicate never decides the result.
  return screen.getByTestId("admin-orgs-table");
}

describe("admin — the un-freeze control is offered only where the server accepts it", () => {
  it("floor: an eligible read_only Pilot row offers it", async () => {
    // Without this, every "it is absent" assertion below could pass because the
    // control was never built.
    const table = await renderAdmin([org()]);
    expect(within(table).getByRole("button", { name: /unfreeze/i })).toBeTruthy();
  });

  it("is absent on a trial_expired org — that one needs Adjust limits instead", async () => {
    const table = await renderAdmin([org({ accountStatus: "trial_expired" })]);
    expect(within(table).queryByRole("button", { name: /unfreeze/i })).toBeNull();
    expect(within(table).getByRole("button", { name: /adjust limits/i })).toBeTruthy();
  });

  it("is absent while a live Stripe subscription still owns the status", async () => {
    const table = await renderAdmin([org({ stripeSubscriptionId: "sub_live_1" })]);
    expect(within(table).queryByRole("button", { name: /unfreeze/i })).toBeNull();
  });

  it("is absent on a paid plan, whose status comes from Stripe", async () => {
    const table = await renderAdmin([org({ plan: "growth" })]);
    expect(within(table).queryByRole("button", { name: /unfreeze/i })).toBeNull();
  });
});

describe("admin — un-freezing is confirmed, and its consequence is named", () => {
  it("opens a dialog and calls nothing on the row click", async () => {
    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /unfreeze/i }));

    expect(await screen.findByTestId("admin-unfreeze-modal")).toBeTruthy();
    expect(setOrgAccountStatus).not.toHaveBeenCalled();
  });

  it("the dialog says that ingest re-opens with no subscription behind it", async () => {
    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /unfreeze/i }));

    const modal = await screen.findByTestId("admin-unfreeze-modal");
    expect(modal.textContent ?? "").toMatch(/no subscription/i);
    expect(modal.textContent ?? "").toMatch(/upload|ingest|accept orders/i);
  });

  it("fires the write only after the confirmation is given", async () => {
    setOrgAccountStatus.mockResolvedValue({
      id: ORG_ID,
      name: "Nordmark Tooling",
      plan: "pilot",
      previousAccountStatus: "read_only",
      requestedAccountStatus: "trialing",
      accountStatus: "trialing",
      revertedByTrialWindow: false,
      effectiveTrialEndsAt: new Date("2026-09-10").toISOString(),
      note: null,
    });

    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /unfreeze/i }));
    const modal = await screen.findByTestId("admin-unfreeze-modal");

    const confirm = within(modal).getByRole("button", { name: /^unfreeze workspace$/i });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(setOrgAccountStatus).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole("checkbox"));
    fireEvent.click(within(modal).getByRole("button", { name: /^unfreeze workspace$/i }));

    expect(setOrgAccountStatus).toHaveBeenCalledWith(ORG_ID, "trialing");
    const ok = await within(modal).findByRole("status");
    expect(ok.getAttribute("data-notice-tone")).toBe("success");
  });

  it("does NOT report success when the trial window re-froze the org immediately", async () => {
    setOrgAccountStatus.mockResolvedValue({
      id: ORG_ID,
      name: "Nordmark Tooling",
      plan: "pilot",
      previousAccountStatus: "read_only",
      requestedAccountStatus: "trialing",
      accountStatus: "trial_expired",
      revertedByTrialWindow: true,
      effectiveTrialEndsAt: new Date("2026-07-01").toISOString(),
      note: "The organisation was un-frozen, but its Pilot window has already ended.",
    });

    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /unfreeze/i }));
    const modal = await screen.findByTestId("admin-unfreeze-modal");
    fireEvent.click(within(modal).getByRole("checkbox"));
    fireEvent.click(within(modal).getByRole("button", { name: /^unfreeze workspace$/i }));

    const notice = await within(modal).findByRole("alert");
    expect(notice.getAttribute("data-notice-tone")).not.toBe("success");
    expect(notice.textContent ?? "").toMatch(/Pilot window has already ended/);
    // And it is not ALSO filed as a polite success somewhere on the same panel.
    expect(within(modal).queryByRole("status")).toBeNull();
    // The effective status the DATABASE holds, not the one that was requested.
    expect(modal.textContent ?? "").toMatch(/trial_expired|Trial expired/);
  });

  it("shows the server's refusal sentence rather than a generic failure", async () => {
    setOrgAccountStatus.mockRejectedValue(
      new Error("This organisation still has a live Stripe subscription."),
    );

    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /unfreeze/i }));
    const modal = await screen.findByTestId("admin-unfreeze-modal");
    fireEvent.click(within(modal).getByRole("checkbox"));
    fireEvent.click(within(modal).getByRole("button", { name: /^unfreeze workspace$/i }));

    const alert = await within(modal).findByRole("alert");
    expect(alert.getAttribute("data-notice-tone")).toBe("error");
    expect(alert).toHaveTextContent("This organisation still has a live Stripe subscription.");
  });
});

describe("admin — retention is confirmed in words that name the deletion", () => {
  it("opens a dialog and calls nothing on the row click", async () => {
    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /retention/i }));

    expect(await screen.findByTestId("admin-retention-modal")).toBeTruthy();
    expect(setOrgRetention).not.toHaveBeenCalled();
  });

  it("states that the next sweep permanently deletes stored files", async () => {
    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /retention/i }));

    const modal = await screen.findByTestId("admin-retention-modal");
    expect(modal.textContent ?? "").toMatch(/permanently delete/i);
    // It deletes the stored FILES of terminal orders — order rows and the audit
    // trail stay. Copy that implied the orders themselves vanish would be wrong
    // in the other direction.
    expect(modal.textContent ?? "").toMatch(/audit|order records|stay/i);
  });

  it("keeps Save disabled until the consequence is acknowledged", async () => {
    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /retention/i }));
    const modal = await screen.findByTestId("admin-retention-modal");

    fireEvent.change(within(modal).getByRole("spinbutton", { name: /retention days/i }), {
      target: { value: "30" },
    });

    const save = within(modal).getByRole("button", { name: /^set retention window$/i });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(save);
    expect(setOrgRetention).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole("checkbox", { name: /understand/i }));
    expect(
      within(modal).getByRole("button", { name: /^set retention window$/i }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("sends the days once confirmed", async () => {
    setOrgRetention.mockResolvedValue({
      id: ORG_ID,
      name: "Nordmark Tooling",
      retentionDays: 30,
      retentionEnabled: true,
    });

    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /retention/i }));
    const modal = await screen.findByTestId("admin-retention-modal");

    fireEvent.change(within(modal).getByRole("spinbutton", { name: /retention days/i }), {
      target: { value: "30" },
    });
    fireEvent.click(within(modal).getByRole("checkbox", { name: /understand/i }));
    fireEvent.click(within(modal).getByRole("button", { name: /^set retention window$/i }));

    expect(setOrgRetention).toHaveBeenCalledWith(ORG_ID, { retentionDays: 30 });
    const ok = await within(modal).findByRole("status");
    expect(ok.getAttribute("data-notice-tone")).toBe("success");
  });

  it("disabling retention sends clear, and says nothing will be deleted", async () => {
    setOrgRetention.mockResolvedValue({
      id: ORG_ID,
      name: "Nordmark Tooling",
      retentionDays: null,
      retentionEnabled: false,
    });

    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /retention/i }));
    const modal = await screen.findByTestId("admin-retention-modal");

    fireEvent.click(within(modal).getByRole("radio", { name: /turn retention off/i }));
    // Turning retention OFF deletes nothing, so it must not demand the
    // deletion acknowledgement that enabling it does.
    fireEvent.click(within(modal).getByRole("button", { name: /^turn retention off$/i }));

    expect(setOrgRetention).toHaveBeenCalledWith(ORG_ID, { clear: true });
  });

  it("shows the server's refusal sentence rather than a generic failure", async () => {
    setOrgRetention.mockRejectedValue(
      new Error("retentionDays must be at least 1. Use clear=true to disable retention."),
    );

    const table = await renderAdmin([org()]);
    fireEvent.click(within(table).getByRole("button", { name: /retention/i }));
    const modal = await screen.findByTestId("admin-retention-modal");

    fireEvent.change(within(modal).getByRole("spinbutton", { name: /retention days/i }), {
      target: { value: "30" },
    });
    fireEvent.click(within(modal).getByRole("checkbox", { name: /understand/i }));
    fireEvent.click(within(modal).getByRole("button", { name: /^set retention window$/i }));

    const alert = await within(modal).findByRole("alert");
    expect(alert.getAttribute("data-notice-tone")).toBe("error");
    expect(alert).toHaveTextContent("retentionDays must be at least 1.");
  });
});
