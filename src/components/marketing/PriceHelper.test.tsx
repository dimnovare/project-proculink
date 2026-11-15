import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DOCUMENT_PLANS, yearlyMonthlyEquivalent } from "@/lib/plans";
import { PRICE_STOPS, PriceHelper } from "./PriceHelper";

const fmt = (n: number) => n.toLocaleString("en-GB");
const setup = () => {
  const { container } = render(<PriceHelper />);
  const helper = within(within(container).getByTestId("price-helper"));
  const slider = helper.getByLabelText("About how many documents a month?") as HTMLInputElement;
  const go = (n: number) => fireEvent.change(slider, { target: { value: String(PRICE_STOPS.indexOf(n)) } });
  const said = () => helper.getByTestId("price-answer").textContent;
  const column = (id: string) => container.querySelector(`article[data-plans="${id}"]`)!;
  return { helper, slider, go, said, column, container };
};

describe("PriceHelper", () => {
  it("names the cheapest plan at each stop, marks only that column, and never prices Enterprise", () => {
    const { slider, go, said, column, container } = setup();
    expect(PRICE_STOPS.at(-1)).toBe(2 * Math.max(...DOCUMENT_PLANS.map((p) => p.orderLimit!)));
    for (const p of DOCUMENT_PLANS) expect(PRICE_STOPS, p.id).toContain(p.orderLimit);
    expect(slider.getAttribute("aria-valuetext")).toBe("200 documents a month");
    expect(said()).toBe("About 200 a month: Starter is cheapest, about €47 with extra documents.From about 290 a month, Pro costs the same, with no extra documents.");
    go(300);
    expect(said()).toBe("300 a month fits in Pro.From about 850 a month, Business costs the same, with no extra documents.");
    expect(container.querySelectorAll("[data-cheapest]")).toHaveLength(1);
    expect(column("pro").hasAttribute("data-cheapest")).toBe(true);
    expect(within(column("pro") as HTMLElement).getByText("Cheapest for your volume")).toBeTruthy();
    expect(within(column("starter") as HTMLElement).queryByText("Cheapest for your volume")).toBeNull();
    go(7_500);
    expect(said()).toBe("About 7,500 a month: Scale, about €599 with extra documents.For more, talk to us about Enterprise.");
    expect(container.textContent).not.toMatch(/Enterprise[^.]*€|€[\d,]+[^.]*Enterprise/);
  });

  it("the annual toggle changes every price, every note and the answer", () => {
    const { helper, said, column } = setup();
    const annual = helper.getByRole("button", { name: "Annual, 2 months free" });
    for (const p of DOCUMENT_PLANS) {
      const text = column(p.id).textContent!;
      expect(text, p.id).toContain(`€${p.priceMonthly}a month`);
      expect(text, p.id).toContain(`Or €${fmt(p.priceYearly!)} a year`);
      expect(text, p.id).toContain(`${fmt(p.orderLimit!)} documents a month`);
      expect(text, p.id).toContain(p.flowLimit == null ? "Unlimited flows" : `${p.flowLimit} flows`);
      expect(text, p.id).toContain(`Each extra document €${p.overageEur!.toFixed(2)}`);
      expect(within(column(p.id) as HTMLElement).getByRole("link", { name: `Choose ${p.name}` })).toHaveAttribute("href", p.cta.href);
    }
    fireEvent.click(annual);
    expect(annual).toHaveAttribute("aria-pressed", "true");
    for (const p of DOCUMENT_PLANS) {
      const text = column(p.id).textContent!;
      expect(text, p.id).toContain(`€${yearlyMonthlyEquivalent(p)}a month`);
      expect(text, p.id).toContain(`Billed once a year, €${fmt(p.priceYearly!)}`);
      expect(text, p.id).not.toContain("Or €");
    }
    expect(said()).toBe("About 200 a month: Starter is cheapest, about €41 with extra documents.From about 270 a month, Pro costs less.");
  });
});
