import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import PricingPage from "./page";
import { LEGACY_PAID_PLANS } from "@/lib/plans";
import { FLOW_SENTENCE } from "@/components/marketing/sitePictures";

// The existing-customers FAQ names the hidden legacy plans in its answer (the question says
// "an older plan", so a new visitor is not shown names they never saw), and names them from
// the ladder: a typed list would keep naming a plan after it was renamed or removed.

afterEach(cleanup);

describe("/pricing existing-customers FAQ", () => {
  it("names every legacy paid plan in the answer, derived from plans.ts", () => {
    const { container } = render(<PricingPage />);
    within(container).getByText("I'm on an older plan. What changes?");
    const answer = within(container).getByText(/^If you are on .*, nothing changes until you change plan\./);
    expect(LEGACY_PAID_PLANS.length).toBeGreaterThan(0); // anti-vacuity
    for (const plan of LEGACY_PAID_PLANS) expect(answer.textContent, plan.id).toContain(plan.name);
  });

  it("says what a flow is under the lead and under the plans", () => {
    const { container } = render(<PricingPage />);
    expect(within(container).getAllByText(FLOW_SENTENCE)).toHaveLength(2);
  });
});
