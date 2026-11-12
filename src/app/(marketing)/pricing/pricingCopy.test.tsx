import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import PricingPage from "./page";
import { PLAN_BY_ID, recommendPlanByOrders } from "@/lib/plans";
import { MAX_SELF_SERVE_SUPPLIERS, recommendPlan } from "./recommendPlan";

// /pricing after the pilot-stage copy pass (2026-11-04). Each block pins one decision
// so it cannot quietly revert:
//   • no "Most popular" badge — nothing measures popularity;
//   • the hero says what plans are priced on, not "nothing else";
//   • the getting-started FAQ is present AND the billing FAQ survived it;
//   • the recommender asks for suppliers as well as orders, and the supplier count
//     really moves the answer;
//   • the Pilot card routes to the supported pilot programme.

afterEach(cleanup);

function renderPage() {
  const { container } = render(<PricingPage />);
  return { container, q: within(container) };
}

describe("/pricing pilot-stage copy", () => {
  it("carries no 'Most popular' badge — not on Operations, not as the recommender's fallback", () => {
    const { container } = renderPage();
    expect(container.textContent ?? "").not.toMatch(/most popular/i);
    // The only badge left is the recommender's, on exactly one card.
    expect(within(container).getAllByText("Recommended for you")).toHaveLength(1);
  });

  it("leads with what plans are priced on, not 'nothing else'", () => {
    const { q, container } = renderPage();
    expect(q.getByRole("heading", { level: 1 }).textContent).toBe(
      "Start FREE. Pay when the workflow proves useful.",
    );
    const body = container.textContent ?? "";
    expect(body).not.toMatch(/Pay for orders processed, nothing else/i);
    expect(body).toMatch(/documents you process each month and the suppliers you send orders to, with no per-seat pricing/);
  });

  it("adds the five getting-started questions and keeps every billing question", () => {
    const { q } = renderPage();
    const questions = [
      "Do I need an ERP or integration to start?",
      "Does my supplier need to take part?",
      "Can I use a test or anonymised order?",
      "Will ProcuLink send anything automatically during the Pilot?",
      "What happens when my item code doesn't match the supplier's?",
      // billing — must survive
      "What counts as a document?",
      "What happens after the Pilot?",
      "Do you charge for failed documents?",
      "What if I go over my monthly allowance?",
      "Can I change plans later?",
      "What happens if I cancel?",
      "Where is my data stored?",
    ];
    for (const question of questions) {
      expect(q.getByRole("button", { name: question }), question).toBeTruthy();
    }
  });

  it("never promises PDF or Excel OUTPUT in the new answers", () => {
    const { container } = renderPage();
    const body = container.textContent ?? "";
    expect(body).not.toMatch(/download (?:a|the|your) (?:PDF|Excel)/i);
    expect(body).not.toMatch(/(?:PDF|Excel) (?:output|file you send)/i);
  });

  it("says test uploads count toward the allowance — only the built-in sample is free", () => {
    const { container } = renderPage();
    expect(container.textContent ?? "").toMatch(
      /count toward your document allowance — only the built-in sample order doesn't/,
    );
  });

  it("asks for suppliers too, and the supplier count really changes the recommendation", () => {
    const { q } = renderPage();
    const status = q.getByRole("status");
    const suppliers = q.getByLabelText("Suppliers you send orders to") as HTMLInputElement;
    expect(suppliers.max).toBe(String(MAX_SELF_SERVE_SUPPLIERS + 1));

    // Default: one supplier, so the answer is the volume answer.
    const orders = Number((q.getByLabelText("Documents per month") as HTMLInputElement).value);
    const byVolume = recommendPlanByOrders(orders);
    expect(within(status).getByText(byVolume.name)).toBeTruthy();

    // One supplier past the volume answer's allowance moves the recommendation up.
    const tooMany = (byVolume.supplierLimit ?? 0) + 1;
    fireEvent.change(suppliers, { target: { value: String(tooMany) } });
    const forced = recommendPlan(orders, tooMany);
    expect(forced.id).not.toBe(byVolume.id);
    expect(within(status).getByText(forced.name)).toBeTruthy();
    // …and says why, with numbers read off the ladder.
    expect(status.textContent).toContain(
      `${byVolume.name} covers your volume but includes ${byVolume.supplierLimit} suppliers.`,
    );

    // Past every self-serve allowance: Enterprise.
    fireEvent.change(suppliers, { target: { value: String(MAX_SELF_SERVE_SUPPLIERS + 1) } });
    expect(within(status).getByText(PLAN_BY_ID.enterprise.name)).toBeTruthy();
    expect(within(status).getByRole("link").textContent).toMatch(/Contact sales/);
  });

  it("routes the Pilot card to the supported pilot programme", () => {
    const { container } = renderPage();
    const link = Array.from(container.querySelectorAll('a[href="/pilot"]')).find((a) =>
      /Apply for a FREE supported pilot/.test(a.textContent ?? ""),
    );
    expect(link, "Pilot card link to /pilot").toBeTruthy();
    expect(within(container).getByRole("link", { name: new RegExp(PLAN_BY_ID.pilot.cta.label) })).toBeTruthy();
  });
});
