import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import PricingPage from "./page";
import { LEGACY_PAID_PLANS } from "@/lib/plans";

// The existing-customers FAQ names the hidden legacy plans, and names them from the ladder: a
// typed list would keep naming a plan after it was renamed or removed.

afterEach(cleanup);

describe("/pricing existing-customers FAQ", () => {
  it("names every legacy paid plan, derived from plans.ts", () => {
    const { container } = render(<PricingPage />);
    const button = within(container).getByRole("button", { name: /^I.m on .*\. What changes\?$/ });
    expect(LEGACY_PAID_PLANS.length).toBeGreaterThan(0); // anti-vacuity
    for (const plan of LEGACY_PAID_PLANS) expect(button.textContent, plan.id).toContain(plan.name);
  });
});
