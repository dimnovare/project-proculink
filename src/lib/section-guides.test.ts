import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listAppRoutes, ROOT } from "@/test/appRoutes";
import { SECTION_GUIDES, NO_SCREEN_HELP, matchGuide } from "@/lib/section-guides";
import { helpPageHrefs } from "@/components/help/helpPages";
import { POPULAR_ARTICLE_SLUGS } from "@/lib/help-articles";

describe("screen help", () => {
  it("every app page has help or says why it has none, and nothing names a page that is gone", () => {
    const pages = listAppRoutes(join(ROOT, "src", "app", "(app)")).sort();
    expect(pages.length, "the walk found no app pages, so this would prove nothing").toBeGreaterThanOrEqual(15);
    const named = [...SECTION_GUIDES.map((g) => g.route), ...Object.keys(NO_SCREEN_HELP)].sort();
    expect(named).toEqual(pages);
    expect(new Set(SECTION_GUIDES.map((g) => g.route)).size).toBe(SECTION_GUIDES.length);
    expect(Object.values(NO_SCREEN_HELP).every((why) => why.trim().length > 0)).toBe(true);
  });

  it("each screen offers three tasks and a start, and every page the panel can open exists", () => {
    const openable = new Set(helpPageHrefs());
    const file = (href: string) => join(ROOT, "src", "app", "(marketing)", ...href.split("/").filter(Boolean), "page.mdx");
    expect(openable.size).toBeGreaterThanOrEqual(30);
    for (const href of openable) expect(existsSync(file(href)), href).toBe(true);
    for (const g of SECTION_GUIDES) {
      expect(g.tasks, g.route).toHaveLength(3);
      expect(g.screen.trim() && g.startHere.trim(), g.route).toBeTruthy();
      for (const t of g.tasks) expect(openable.has(t.href), `${g.route} → ${t.href}`).toBe(true);
    }
    for (const slug of POPULAR_ARTICLE_SLUGS.slice(0, 3)) expect(openable.has(`/help/${slug}`)).toBe(true);
  });

  it("finds the screen's help by pattern, and nothing for an address it does not know", () => {
    expect(matchGuide("/documents")?.screen).toBe("Documents");
    // The help names the tabs the screen draws.
    expect(matchGuide("/documents")?.tasks[2].line).toBe("Look under Finished or All, or search by name or number.");
    expect(matchGuide("/flows/new")?.screen).toBe("New flow");
    expect(matchGuide("/flows/f-1")?.screen).toBe("A flow");
    expect(matchGuide("/flows/f-1/documents/d-9?x=1#y")?.screen).toBe("A document");
    expect(matchGuide("/settings/")?.screen).toBe("Settings");
    for (const p of ["/archive", "/flows/f-1/extra", "/documents/nothing-here", "/", "", null]) expect(matchGuide(p)).toBeNull();
  });
});
