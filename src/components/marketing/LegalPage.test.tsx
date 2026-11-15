import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PrivacyPage from "@/app/(marketing)/privacy/page";
import DpaPage from "@/app/(marketing)/dpa/page";

describe("LegalPage", () => {
  it("lists every heading of the page under On this page, in order, and links each to its heading", () => {
    render(<PrivacyPage />);
    const body = screen.getByTestId("legal-body");
    const heads = within(body).getAllByRole("heading", { level: 2 });
    expect(heads.length).toBe(12);
    const navs = screen.getAllByRole("navigation", { name: "On this page" });
    expect(navs.length).toBe(2);
    for (const nav of navs) {
      const links = within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
      expect(links).toEqual(heads.map((h) => [h.textContent, "#" + h.id]));
    }
    const ids = heads.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks the open page and keeps every heading a sibling of the next", () => {
    const { unmount } = render(<PrivacyPage />);
    const related = screen.getByRole("navigation", { name: "Related legal pages" });
    const links = within(related).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Privacy", "Terms", "Acceptable use", "Data processing addendum", "Subprocessors"]);
    expect(within(related).getByRole("link", { name: "Privacy" })).toHaveAttribute("aria-current", "page");
    for (const a of links.slice(1)) expect(a).not.toHaveAttribute("aria-current");
    unmount();

    render(<DpaPage />);
    const body = screen.getByTestId("legal-body");
    const heads = within(body).getAllByRole("heading", { level: 2 });
    expect(heads.length).toBeGreaterThan(5);
    for (const h of heads) expect(h.parentElement).toBe(body);
  });
});
