import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AUTOMATIC_DELIVERY_LABEL, REVIEW_BEFORE_DELIVERY_LABEL } from "@/lib/deliveryMode";
import { DOCUMENT_UNIT_SENTENCE, ENTERPRISE_FLOOR_EUR, PLAN_BY_ID, PUBLIC_LADDER } from "@/lib/plans";
import PricingPage from "./page";

describe("/pricing", () => {
  it("is a static page whose first HTML already holds the plans and the 200-document answer", () => {
    expect(readFileSync(join(__dirname, "page.tsx"), "utf8")).not.toMatch(/^\s*["']use client["']/m);
    const html = renderToStaticMarkup(<PricingPage />);
    expect(html).toContain("Start free. Pay for the documents you process.");
    expect(html).toContain(DOCUMENT_UNIT_SENTENCE);
    expect(html).toContain("About 200 a month: Starter is cheapest, about €47 with extra documents.");
    const ids = new Set([...html.matchAll(/data-plans="([^"]+)"/g)].flatMap((m) => m[1].split(" ")));
    expect(ids).toEqual(new Set(PUBLIC_LADDER.map((p) => p.id)));
    const pilot = PLAN_BY_ID.pilot;
    expect(html).toContain(`${pilot.orderLimit} documents, ${pilot.flowLimit} flows, no credit card.`);
    expect(PLAN_BY_ID.enterprise.priceCadence.replace(/\D/g, "")).toBe(String(ENTERPRISE_FLOOR_EUR));
    expect(html).toContain(`From €${ENTERPRISE_FLOOR_EUR.toLocaleString("en-GB")} a month.`);
    expect(html).not.toMatch(/→|·|Recommended plan|plk-price-card|per extra document|most popular|supplier-ready|See all tiers|Custom suppliers|ERP connectors/i);
  });

  it("asks nine questions in the board's order, the first open, with the trial and mode words from the code", () => {
    const { container } = render(<PricingPage />);
    const items = Array.from(container.querySelectorAll("details"));
    expect(items.map((d) => d.querySelector("summary")!.textContent!.trim())).toEqual([
      "Do I need an integration to start?",
      "Do the people who send me documents need to change anything?",
      "Can I try it with a test or anonymised document?",
      "Will anything be sent automatically during the trial?",
      "What happens when the trial ends?",
      "Can I change plans later?",
      "What happens if I cancel?",
      "Where is my data stored?",
      expect.stringMatching(/^I.m on .+\. What changes\?$/),
    ]);
    expect(items.map((d) => d.open)).toEqual([true, false, false, false, false, false, false, false, false]);
    expect(items[2].textContent).toContain(`it counts towards your ${PLAN_BY_ID.pilot.orderLimit} trial documents.`);
    expect(items[2].textContent).not.toMatch(/\bone of your\b/);
    expect(items[3].textContent).toContain(REVIEW_BEFORE_DELIVERY_LABEL);
    expect(items[3].textContent).toContain(AUTOMATIC_DELIVERY_LABEL);
    expect(items[5].textContent).toContain("we prorate the difference");
    expect(within(items[6] as HTMLElement).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(within(items[7] as HTMLElement).getByRole("link", { name: "Security page" })).toHaveAttribute("href", "/security");
  });
});
