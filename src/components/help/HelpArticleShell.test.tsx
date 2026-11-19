import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HELP_ARTICLES, getAdjacentArticles } from "@/lib/help-articles";
import { guidesForArticle } from "@/lib/guides";

let path = "/help";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
vi.mock("@/lib/analytics", () => ({ capture: () => {} }));

import HelpArticleShell from "./HelpArticleShell";
import { useMDXComponents } from "@/mdx-components";

const hrefs = (el: HTMLElement) => within(el).getAllByRole("link").map((a) => a.getAttribute("href"));

describe("the article template", () => {
  it("lists the page's own headings, its guides and its neighbours", async () => {
    const a = HELP_ARTICLES.find((x) => {
      const { prev, next } = getAdjacentArticles(x.slug);
      return guidesForArticle(x.slug).length > 0 && prev && next;
    });
    expect(a, "no article has guides and both neighbours").toBeTruthy();
    const { prev, next } = getAdjacentArticles(a!.slug);
    path = `/help/${a!.slug}`;
    render(
      <HelpArticleShell>
        <h2 id="a">First part</h2>
        <p>x</p>
        <h2 id="b">Second part</h2>
      </HelpArticleShell>,
    );
    const toc = await screen.findByRole("navigation", { name: "In this article" });
    expect(within(toc).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["First part", "#a"],
      ["Second part", "#b"],
    ]);
    expect(hrefs(screen.getByRole("region", { name: "Step-by-step guides" }))).toEqual(guidesForArticle(a!.slug).map((g) => g.href));
    expect(hrefs(screen.getByRole("navigation", { name: "Keep reading" }))).toEqual([`/help/${prev!.slug}`, `/help/${next!.slug}`]);
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).getByRole("link", { name: "Help centre" })).toHaveAttribute("href", "/help");
    expect(crumb.querySelector('[aria-current="page"]')).toHaveTextContent(a!.title);
    expect(screen.queryByText(/business day|every message/)).toBeNull();
  });

  it("prints one h1, the registry title, over a body that opens with its own `# Title`", () => {
    const a = HELP_ARTICLES[0];
    path = `/help/${a.slug}`;
    const BodyH1 = useMDXComponents({}).h1 as React.ComponentType<{ children?: React.ReactNode }>;
    const { container } = render(
      <HelpArticleShell>
        <BodyH1>{a.title}</BodyH1>
        <p>x</p>
      </HelpArticleShell>,
    );
    expect([...container.querySelectorAll("h1")].map((h) => h.textContent)).toEqual([a.title]);
  });

  it("shows no table of contents for one heading and no guides box for none", () => {
    const a = HELP_ARTICLES.find((x) => guidesForArticle(x.slug).length === 0);
    expect(a, "every article has a guide; pick another way to reach the empty branch").toBeTruthy();
    path = `/help/${a!.slug}`;
    render(
      <HelpArticleShell>
        <h2 id="only">Only part</h2>
      </HelpArticleShell>,
    );
    expect(screen.queryByRole("navigation", { name: "In this article" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Step-by-step guides" })).toBeNull();
  });
});
