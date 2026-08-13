import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PLANS, PLAN_IDS, planDisplayName, planName } from "@/lib/plans";
import { planGateRequiredPlan } from "@/lib/planGate";

// Every tier the ladder sells must have a name a customer can read.
//
// THE DEFECT THIS PINS, verbatim. `src/app/(app)/settings/page.tsx` kept its own map:
//
//   const PLAN_LABELS: Record<string, string> = {
//     pilot: "Pilot plan", growth: "Growth plan", operations: "Operations plan",
//     integration: "Integration plan", enterprise: "Enterprise",
//   };
//   const planLabel = billing ? (PLAN_LABELS[billing.plan] ?? billing.plan) : "…";
//
// Five of six. Distributor is a live self-serve tier with live Stripe monthly and yearly
// prices, so a real org paying €1,499/month opened its own Settings and read
// `Acme · distributor` — the raw lowercase wire value, in the page header.
//
// Adding the missing row would have fixed that org and left the mechanism intact for the
// seventh tier. The labels are derived from `PLANS` instead, which already owns the ladder,
// and the two other producers (topbar, sidebar) — which were capitalising the first letter
// of the wire value and agreeing with the ladder only by coincidence — now derive too.

const PLAN_TABLE = PLANS.map((p) => [p.id, p.name] as const);

describe("the ladder being swept is real", () => {
  it("has every tier the product sells, Distributor included", () => {
    // Anti-vacuity: every sweep below iterates PLANS, and a sweep over a short list passes
    // for the tiers it does not contain. Distributor is named because its absence from a
    // list exactly like this one is the defect.
    expect(PLANS.length).toBe(6);
    expect(PLANS.map((p) => p.id)).toContain("distributor");
    expect(PLAN_IDS.length).toBe(PLANS.length);
  });

  it("orders PLAN_IDS longest-first, which planGate's alternation depends on", () => {
    const lengths = PLAN_IDS.map((id) => id.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });
});

describe("planDisplayName covers every tier", () => {
  it.each(PLAN_TABLE)("%s renders as a name, not as its id", (id, name) => {
    const label = planDisplayName(id);
    expect(label).toBe(`${name} plan`);
    // The failure mode itself, stated directly: the id must never reach a reader.
    expect(label).not.toBe(id);
    expect(label).not.toMatch(/^[a-z]+$/);
  });

  it("names Distributor, the tier the hand-kept map missed", () => {
    expect(planDisplayName("distributor")).toBe("Distributor plan");
    expect(planName("distributor")).toBe("Distributor");
  });

  it("returns an unknown id unchanged rather than inventing a tier", () => {
    // Unreachable through `BillingPlan`; live only if the backend ships a tier this ladder
    // has not got. Showing the raw value is honest there — naming it would not be.
    expect(planDisplayName("hypothetical")).toBe("hypothetical");
  });
});

describe("planGate names tiers from the same ladder", () => {
  it.each(PLAN_TABLE)("reads %s out of a plan-gate 403", (id, name) => {
    expect(planGateRequiredPlan(`cxml_output_requires_${id}`)).toBe(name);
  });

  it("refuses to present a token it cannot name", () => {
    expect(planGateRequiredPlan("cxml_output_requires_hypothetical")).toBeNull();
    expect(planGateRequiredPlan("something went wrong")).toBeNull();
  });
});

// ── On the screen ────────────────────────────────────────────────────────────

const getBillingStatus = vi.fn();

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, getBillingStatus: () => getBillingStatus() };
});

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Acme Procurement" } }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
}));

afterEach(() => {
  cleanup();
  getBillingStatus.mockReset();
});

async function renderSettingsHeaderFor(plan: string): Promise<string> {
  getBillingStatus.mockResolvedValue({
    plan,
    accountStatus: "active",
    ordersThisMonth: 0,
    orderLimit: 2500,
    supplierCount: 0,
    supplierLimit: 30,
    isTrialExpired: false,
    isOrderLimitReached: false,
    isReadOnly: false,
    trialEndsAt: null,
  });
  const { default: SettingsPage } = await import("@/app/(app)/settings/page");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
  const heading = await screen.findByRole("heading", { name: "Settings", level: 1 });
  const sub = heading.parentElement?.querySelector("p");
  if (!sub) throw new Error("Settings header rendered no subtitle");
  return sub.textContent ?? "";
}

describe("the Settings header, for a Distributor org", () => {
  it("names the plan instead of printing its id", async () => {
    const sub = await renderSettingsHeaderFor("distributor");
    expect(sub, "the header printed the raw wire value").not.toContain("· distributor");
    expect(sub).toBe("Acme Procurement · Distributor plan");
  });

  it("still names the tiers that always worked", async () => {
    // Anti-vacuity for the assertion above: it would pass against a header that had stopped
    // showing a plan at all.
    expect(await renderSettingsHeaderFor("growth")).toBe("Acme Procurement · Growth plan");
    cleanup();
    expect(await renderSettingsHeaderFor("enterprise")).toBe("Acme Procurement · Enterprise plan");
  });
});
