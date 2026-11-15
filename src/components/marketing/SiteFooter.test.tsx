import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./SiteFooter";

describe("SiteFooter", () => {
  it("has three labelled link groups, the brand sentence, the company line, and the storage phrase as a link", () => {
    const { container } = render(<SiteFooter />);
    const footer = within(container).getByRole("contentinfo");
    const groups = {
      Product: ["How it works", "Formats", "Pricing", "Security", "Changelog"],
      Help: ["Help centre", "Step-by-step guides", "Support", "Talk to us"],
      Company: ["Privacy", "Terms", "Acceptable use", "Data processing addendum", "Subprocessors"],
    };
    for (const [name, links] of Object.entries(groups)) {
      const nav = within(footer).getByRole("navigation", { name });
      expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(links);
    }
    expect(footer.textContent).toContain("Any document in. Clean data out. ProcuLink reads your documents, lets you check them");
    expect(footer.textContent).toContain("© 2026 Diip Solutions OÜ, registry code 17527757, Tallinn, Estonia");
    expect(within(footer).getByRole("link", { name: "EU-region document storage" })).toHaveAttribute("href", "/security");
    expect(footer.textContent).not.toMatch(/missing link|connecting procurement| · /i);
  });
});
