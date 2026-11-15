import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { PLAN_BY_ID, PUBLIC_LADDER } from "@/lib/plans";

vi.mock("@/components/marketing/MarketingNav", () => ({ MarketingNav: () => <nav /> }));

import RootPage from "./page";

afterEach(cleanup);

describe("landing page sells the document tool", () => {
  it("has the one H1, the derived offer line and the sign-up CTA", () => {
    const { container } = render(<RootPage />);
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("Any document in. Clean data out.");

    const body = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(body).toContain(
      `Free for ${PLAN_BY_ID.pilot.priceCadence} · ${PLAN_BY_ID.pilot.orderLimit} documents · from €${PLAN_BY_ID.starter.priceMonthly} a month after`,
    );
    const cta = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Start your free trial");
    expect(body).toContain("Free for 30 days · 20 documents · from €35 a month after");
    expect(cta?.getAttribute("href")).toBe("/sign-up");
    expect(body).toContain("Try it on your own documents");
  });

  it("no longer carries the ROI calculator or order-era copy", () => {
    const { container } = render(<RootPage />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/ROI|supplier-ready|Pilot/);
  });

  it("prints the price row and the offer from the plan table, and links each section where it says", () => {
    const { container } = render(<RootPage />);
    const page = within(container);
    const rows = within(page.getByRole("list", { name: "Plans" })).getAllByRole("listitem");
    const listed = PUBLIC_LADDER.filter((p) => !p.isCustom);
    expect(rows).toHaveLength(listed.length);
    expect(rows[0].textContent).toBe(`${PLAN_BY_ID.pilot.name}Free for ${PLAN_BY_ID.pilot.priceCadence}${PLAN_BY_ID.pilot.orderLimit} documents`);
    expect(rows[1].textContent).toBe("Starter€35 a month150 documents a month"); // one literal row, so a drift in the table is seen
    listed.slice(1).forEach((p, i) =>
      expect(rows[i + 1].textContent).toContain(`€${p.priceMonthly} a month${p.orderLimit!.toLocaleString("en-GB")} documents a month`));
    expect(container.textContent).not.toMatch(/Enterprise|Pilot|Growth|Operations|Distributor/);
    expect(page.getByText(/No card needed\./).textContent).toContain("Free for 30 days · 20 documents · from €35 a month after.");
    // Scoped to <main>: the footer (Task 2) carries a second "Talk to us" link.
    const href = (name: string) => within(page.getByRole("main")).getByRole("link", { name }).getAttribute("href");
    expect(href("See how it works")).toBe("/how-it-works");
    expect(href("Every format and method")).toBe("/formats");
    expect(href("API reference")).toBe("/help/api-reference");
    expect(href("See pricing, and what counts as a document")).toBe("/pricing");
    expect(href("Talk to us")).toBe("/book-demo");
    expect(page.getByRole("img", { name: /^An example: an invoice arrives as a PDF/ })).toBeTruthy();
  });
});
