import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PLAN_BY_ID } from "@/lib/plans";

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
      `Free for 14 days · ${PLAN_BY_ID.pilot.orderLimit} documents · from €${PLAN_BY_ID.starter.priceMonthly} a month after`,
    );
    const cta = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Start your free trial");
    expect(cta?.getAttribute("href")).toBe("/sign-up");
  });

  it("no longer carries the ROI calculator or order-era copy", () => {
    const { container } = render(<RootPage />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/ROI|supplier-ready|Pilot/);
  });
});
