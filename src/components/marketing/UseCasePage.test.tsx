import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { USE_CASES } from "./useCases";
import { UseCasePage } from "./UseCasePage";

describe("use-case pages", () => {
  it.each(USE_CASES.map((u) => [u.path, u] as const))("%s: one heading, the trial CTA, its limits, and only links to real pages", (path, page) => {
    const { container } = render(<UseCasePage page={page} />);
    const view = within(container);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(view.getAllByRole("link", { name: "Start your free trial" })[0]).toHaveAttribute("href", "/sign-up");
    const limits = view.getByRole("heading", { name: "What it does not do" }).parentElement!;
    for (const limit of page.limits) expect(limits.textContent).toContain(limit);
    const indexed = new Set(sitemap().map((e) => new URL(e.url).pathname));
    expect(indexed.has(path), "listed in the sitemap").toBe(true);
    for (const [, href] of page.links) expect(indexed.has(href), href).toBe(true);
  });
});
