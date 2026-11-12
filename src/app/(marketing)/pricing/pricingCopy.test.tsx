import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import PricingPage from "./page";
import { DOCUMENT_PLANS, PLAN_BY_ID, PUBLIC_LADDER } from "@/lib/plans";
import { DOCUMENT_SLIDER_MAX } from "./recommendPlan";

// /pricing on the document ladder. Every expectation is read off plans.ts.

afterEach(cleanup);

const fmt = (n: number) => n.toLocaleString("en-IE");

function renderPage() {
  const { container } = render(<PricingPage />);
  return { container, q: within(container) };
}

describe("/pricing document ladder", () => {
  it("renders one card per public plan with its price, document allowance and flow allowance", () => {
    const { container } = renderPage();
    const cards = Array.from(container.querySelectorAll("article.plk-price-card"));
    expect(cards.map((c) => c.querySelector(".plk-tier")!.textContent)).toEqual(PUBLIC_LADDER.map((p) => p.name));

    for (const plan of PUBLIC_LADDER.filter((p) => p.orderLimit != null)) {
      const card = cards.find((c) => c.querySelector(".plk-tier")!.textContent === plan.name)!.textContent!;
      expect(card, plan.id).toContain(`${fmt(plan.orderLimit!)} documents`);
      expect(card, plan.id).toContain(plan.flowLimit == null ? "unlimited flows" : `${fmt(plan.flowLimit)} flows`);
      if (plan.priceMonthly) expect(card, plan.id).toContain(`€${plan.priceMonthly}`);
      if (plan.overageEur != null) expect(card, plan.id).toContain(`€${plan.overageEur.toFixed(2)} per extra document`);
    }
    // No legacy plan is sold, and the old order-era copy is gone.
    const body = container.textContent ?? "";
    expect(body).not.toMatch(/most popular|supplier-ready|See all tiers/i);
  });

  it("shows each document plan's yearly price from plans.ts when the annual toggle is on", () => {
    const { container, q } = renderPage();
    fireEvent.click(q.getByRole("button", { name: /^Annual/ }));
    for (const plan of DOCUMENT_PLANS) {
      const card = Array.from(container.querySelectorAll("article.plk-price-card")).find(
        (c) => c.querySelector(".plk-tier")!.textContent === plan.name,
      )!;
      expect(card.textContent, plan.id).toContain(`€${fmt(plan.priceYearly!)}/yr`);
    }
  });

  it("recommends by documents a month: the cheapest plan that covers it, Enterprise above the largest", () => {
    const { q } = renderPage();
    const status = q.getByRole("status");
    const slider = q.getByLabelText("Documents per month") as HTMLInputElement;
    expect(slider.max).toBe(String(DOCUMENT_SLIDER_MAX));

    for (const plan of DOCUMENT_PLANS) {
      fireEvent.change(slider, { target: { value: String(plan.orderLimit) } });
      expect(within(status).getByText(plan.name), plan.id).toBeTruthy();
    }
    fireEvent.change(slider, { target: { value: slider.max } });
    expect(within(status).getByText(PLAN_BY_ID.enterprise.name)).toBeTruthy();
    expect(within(status).getByRole("link").textContent).toMatch(/Contact sales/);
  });
});
