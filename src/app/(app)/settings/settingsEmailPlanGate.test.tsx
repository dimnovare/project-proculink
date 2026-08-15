// The Email-intake tab's plan-gate banner: which tier it names, and what it claims
// about the reader's own plan.
//
// Two defects are pinned here.
//
// 1. The tier and the price were TYPED IN — `Upgrade to Growth (€149/mo)`. Growth really is
//    the cheapest tier that includes email ingestion (MINIMUM_PLAN.emailIngestion), and
//    €149/mo really is its price, so the sentence was correct and would stay correct only
//    for as long as neither of those two facts moved independently of this file. Both are
//    now read from the registries that own them — the gate table for the tier, the plan
//    ladder for its name and price.
//
// 2. The banner ASSERTED THE READER'S PLAN from a value it did not have. Its gate is
//    `!canEnable`, and `canEnable` is `!!billing && billing.plan !== "pilot"` — so it also
//    fires when the billing query is simply unresolved. That query is `retry: false`, so one
//    failed request was enough: a Distributor workspace was told "the Pilot plan doesn't
//    include it" and offered a €149 upgrade. The banner now only names a plan it was given.
//
// The control that matters is `the tier and price follow the ladder` below: it re-points the
// ladder and asserts the copy follows. Asserting the rendered text equals
// `PLAN_BY_ID[minimumPlanId("emailIngestion")]` proves nothing on its own, because that is
// "Growth"/"€149/mo" today and a hardcoded literal passes it.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  getBillingStatus: vi.fn(),
  /** When true, the plan ladder reports a renamed, re-priced Growth. */
  ladderRepointed: false,
  RENAMED: "Sprout",
  REPRICED: "€1/mo",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=email"),
  usePathname: () => "/settings",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));

// The ladder, optionally re-pointed. Kept behind a getter so a single test can flip it
// without a second test file: the factory runs once, at import, but the property is read on
// every render.
vi.mock("@/lib/plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plans")>();
  const repointed = {
    ...actual.PLAN_BY_ID,
    growth: { ...actual.PLAN_BY_ID.growth, name: h.RENAMED, billingPriceLabel: h.REPRICED },
  };
  return {
    ...actual,
    get PLAN_BY_ID() {
      return h.ladderRepointed ? repointed : actual.PLAN_BY_ID;
    },
  };
});

vi.mock("@/lib/api/inboundEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/inboundEmail")>();
  return { ...actual, getInboundAddresses: vi.fn().mockResolvedValue([]) };
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
    getBillingStatus: h.getBillingStatus,
    apiClient: { ...actual.apiClient, getSuppliers: vi.fn().mockResolvedValue([]) },
  };
});

import { PLAN_BY_ID } from "@/lib/plans";
import { minimumPlanId } from "@/lib/gatedCapabilities";
import SettingsPage from "./page";

const GATE = "email-plan-gate";

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

/** Renders, then waits for the tab body — so a negative assertion can never pass on an
 *  unrendered page. */
async function renderSettled() {
  renderSettings();
  await screen.findByText("Poll inbox for orders");
}

beforeEach(() => {
  h.ladderRepointed = false;
  h.getBillingStatus.mockReset();
});

afterEach(cleanup);

describe("Settings ▸ Email intake — the plan-gate banner", () => {
  it("names the tier the gate table names, at the price the ladder gives it", async () => {
    h.getBillingStatus.mockResolvedValue({ plan: "pilot", accountStatus: "trialing" });
    renderSettings();

    const banner = await screen.findByTestId(GATE);
    const unlock = PLAN_BY_ID[minimumPlanId("emailIngestion")];
    expect(banner.textContent).toContain(`Upgrade to ${unlock.name} (${unlock.billingPriceLabel})`);
    // Today that reads "Upgrade to Growth (€149/mo)". This assertion is satisfied by a
    // hardcoded literal too — see the next test, which is the one that isn't.
  });

  it("the tier and price FOLLOW the ladder — they are not literals that happen to agree", async () => {
    h.ladderRepointed = true;
    h.getBillingStatus.mockResolvedValue({ plan: "pilot", accountStatus: "trialing" });
    renderSettings();

    const banner = await screen.findByTestId(GATE);
    expect(banner.textContent).toContain(`Upgrade to ${h.RENAMED} (${h.REPRICED})`);
    expect(banner.textContent).not.toContain("Growth");
    expect(banner.textContent).not.toContain("€149");
  });

  it("a workspace whose plan could not be read is not told it is on Pilot", async () => {
    // `retry: false` on the billing query — one failed request and `billing` is undefined
    // for the rest of the page's life. Every plan reaches this, Distributor included.
    h.getBillingStatus.mockRejectedValue(new Error("billing service unavailable"));
    renderSettings();

    const banner = await screen.findByTestId(GATE);
    // The banner still appears — the switch really is unusable — it just stops naming a
    // plan it was never given, and stops selling a tier that may be a downgrade.
    expect(banner.textContent).toMatch(/couldn’t check which plan/i);
    expect(banner.textContent).not.toContain("Pilot");
    expect(banner.textContent).not.toContain("Upgrade to");
    expect(within(banner).queryByRole("link", { name: /upgrade/i })).toBeNull();
  });

  it("says nothing while the plan is still being fetched", async () => {
    // Neither sentence is known to be true yet, and the wrong one flashing on every load of
    // this tab is how the "you're on Pilot" claim would come back for a paying workspace.
    h.getBillingStatus.mockReturnValue(new Promise(() => {}));
    await renderSettled();

    expect(screen.queryByTestId(GATE)).toBeNull();
  });

  it("a paid workspace gets no gate banner at all", async () => {
    // The negative control for the test above: proves `queryByTestId(GATE)` can be null, so
    // "the banner did not say X" is a statement about the banner and not about an empty page.
    h.getBillingStatus.mockResolvedValue({ plan: "distributor", accountStatus: "active" });
    await renderSettled();

    expect(screen.queryByTestId(GATE)).toBeNull();
  });
});
