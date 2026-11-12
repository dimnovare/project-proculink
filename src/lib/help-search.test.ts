import { describe, it, expect } from "vitest";
import { buildHelpFuse, searchHelpArticles } from "@/lib/help-search";

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

  it("returns [] for gibberish", () => {
    expect(searchHelpArticles(fuse, "xqzvwk")).toEqual([]);
  });
});
