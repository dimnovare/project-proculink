import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { DOCUMENT_PLANS } from "@/lib/plans";
import { PlanTable } from "./PlanTable";

describe("PlanTable (billing help article)", () => {
  it("prints one row per plan from plans.ts, prices with thousands separators", () => {
    const { container } = render(<PlanTable />);
    const rows = within(container).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(DOCUMENT_PLANS.length + 1); // the trial, then the paid plans
    const big = DOCUMENT_PLANS.find((p) => p.priceYearly! >= 1000);
    expect(big, "anti-vacuity: a yearly price of four digits").toBeTruthy();
    const row = rows.find((r) => within(r).queryByRole("rowheader", { name: big!.name }))!;
    expect(row.textContent).toContain(`€${big!.priceYearly!.toLocaleString("en-GB")} a year`);
    expect(row.textContent).not.toMatch(/€\d{4}/);
  });
});
