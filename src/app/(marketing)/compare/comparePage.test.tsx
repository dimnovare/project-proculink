import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COMPARE_ROWS } from "@/components/marketing/compareRows";
import { PUBLIC_LADDER } from "@/lib/plans";
import ComparePage, { metadata } from "./page";

describe("/compare", () => {
  it("compares four kinds of tool in a real table, names no other product, and quotes the cheapest paid price from plans.ts", () => {
    const { container } = render(<ComparePage />);
    const table = within(container.querySelector("table")!);
    expect(table.getAllByRole("columnheader").slice(1).map((h) => h.textContent)).toEqual([
      "ProcuLink",
      "Template-based PDF parsers",
      "General AI extraction tools",
      "Typing it by hand",
    ]);
    expect(COMPARE_ROWS.length).toBeGreaterThanOrEqual(8);
    expect(table.getAllByRole("rowheader").map((h) => h.textContent)).toEqual(COMPARE_ROWS.map((r) => r.name));

    const copy = `${container.textContent} ${String(metadata.title)} ${metadata.description}`;
    expect(copy).not.toMatch(/docparser|nanonets|rossum|parseur|klippa|mindee/i);

    const cheapest = Math.min(...PUBLIC_LADDER.filter((p) => p.isCheckout && p.priceMonthly).map((p) => p.priceMonthly!));
    expect(table.getByText(new RegExp(`^From €${cheapest} a month`))).toBeTruthy();
  });
});
