import { describe, it, expect } from "vitest";
import { buildHelpFuse, buildSiteHelpFuse, searchHelpArticles } from "@/lib/help-search";
import { liveClientGuides } from "@/lib/guides";

describe("help search (shared Fuse index)", () => {
  const fuse = buildHelpFuse();

  it("returns [] for an empty or whitespace query", () => {
    expect(searchHelpArticles(fuse, "")).toEqual([]);
    expect(searchHelpArticles(fuse, "   ")).toEqual([]);
  });

  it("finds articles by curated keyword, not just title text", () => {
    // "IMAP" appears only in intake-channels' keywords; "ppk" only in destination-sign-in's —
    // the operator vocabulary the article titles miss.
    const imap = searchHelpArticles(fuse, "imap").map((a) => a.slug);
    expect(imap).toContain("intake-channels");

    const ppk = searchHelpArticles(fuse, "ppk").map((a) => a.slug);
    expect(ppk).toContain("destination-sign-in");
  });

  it("finds articles by title", () => {
    const out = searchHelpArticles(fuse, "ways to send documents in").map((a) => a.slug);
    expect(out[0]).toBe("intake-channels");
  });

  it("caps results at the given max", () => {
    // A broad term matching many articles must not exceed the slideover cap.
    expect(searchHelpArticles(fuse, "order", 6).length).toBeLessThanOrEqual(6);
    expect(searchHelpArticles(fuse, "order", 2).length).toBeLessThanOrEqual(2);
  });

  it("finds how files are written, and words no article has together", () => {
    expect(searchHelpArticles(fuse, "separator")[0]?.slug).toBe("outputs");
    // No article has both words in one field: the one with the most of them comes first.
    expect(searchHelpArticles(fuse, "excel semicolon")[0]?.slug).toBe("outputs");
  });

  it("returns [] for gibberish", () => {
    expect(searchHelpArticles(fuse, "xqzvwk")).toEqual([]);
  });
});

describe("help search over articles and guides", () => {
  it("finds every live guide by its own title", () => {
    const fuse = buildSiteHelpFuse();
    for (const g of liveClientGuides()) expect(searchHelpArticles(fuse, g.title, 6)[0]?.href, g.title).toBe(g.href);
    expect(searchHelpArticles(fuse, "imap", 6)[0]?.href).toBe("/help/intake-channels");
  });
});