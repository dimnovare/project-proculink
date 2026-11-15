import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ChangelogPage from "./page";

// ENTRIES is module-private (a page file may export only what Next allows), so the
// expected versions and dates are read from the source, the same list the page renders.
const src = readFileSync(join(__dirname, "page.tsx"), "utf8").replace(/\r\n/g, "\n");
const versions = [...src.matchAll(/^ {4}version: "([^"]+)",$/gm)].map((m) => m[1]);
const dates = [...src.matchAll(/^ {4}date: "([^"]+)",$/gm)].map((m) => m[1]);

describe("changelog", () => {
  it("shows the newest entry and keeps the earlier ones closed", () => {
    expect(versions.length).toBeGreaterThan(5);
    const { container } = render(<ChangelogPage />);

    const newest = container.querySelector("article")!;
    expect(newest.querySelector("h2")?.textContent).toBe(versions[0]);
    expect(newest).toHaveTextContent("Latest");

    const details = container.querySelector("details")!;
    expect(details).not.toBeNull();
    expect(details.hasAttribute("open")).toBe(false);

    const monthYear = (d: string) => d.split(" ").slice(-2);
    const [fromMonth, fromYear] = monthYear(dates[dates.length - 1]);
    const [toMonth, toYear] = monthYear(dates[1]);
    const range = fromYear === toYear ? `${fromMonth} to ${toMonth} ${toYear}` : `${fromMonth} ${fromYear} to ${toMonth} ${toYear}`;
    expect(within(details).getByText(/^Earlier versions \(/).textContent).toBe(`Earlier versions (${range})`);
    expect(details.querySelectorAll("article").length).toBe(versions.length - 1);
  });
});
