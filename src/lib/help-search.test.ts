import { describe, it, expect } from "vitest";
import { buildSiteHelpFuse, searchHelpArticles } from "@/lib/help-search";
import { liveClientGuides } from "@/lib/guides";

describe("help search (shared Fuse index)", () => {
  const fuse = buildSiteHelpFuse();

  it("returns [] for an empty or whitespace query", () => {
    expect(searchHelpArticles(fuse, "")).toEqual([]);
    expect(searchHelpArticles(fuse, "   ")).toEqual([]);
  });

  it("finds articles by curated keyword, not just title text", () => {
    // "IMAP" appears only in intake-channels' keywords; "ppk" only in destination-sign-in's —
    // the operator vocabulary the article titles miss.
    const imap = searchHelpArticles(fuse, "imap").map((a) => a.href);
    expect(imap).toContain("/help/intake-channels");

    const ppk = searchHelpArticles(fuse, "ppk").map((a) => a.href);
    expect(ppk).toContain("/help/destination-sign-in");
  });

  it("finds articles by title", () => {
    const out = searchHelpArticles(fuse, "ways to send documents in").map((a) => a.href);
    expect(out[0]).toBe("/help/intake-channels");
  });

  it("caps results at the given max", () => {
    // A broad term matching many articles must not exceed the slideover cap.
    expect(searchHelpArticles(fuse, "order", 6).length).toBeLessThanOrEqual(6);
    expect(searchHelpArticles(fuse, "order", 2).length).toBeLessThanOrEqual(2);
  });

  it("finds how files are written, and words no article has together", () => {
    expect(searchHelpArticles(fuse, "separator")[0]?.href).toBe("/help/outputs");
    expect(searchHelpArticles(fuse, "excel semicolon")[0]?.href).toBe("/help/outputs");
    // The whole phrase finds nothing (no field holds both words): the article with the most of them comes first.
    expect(searchHelpArticles(fuse, "comma decimal")[0]?.href).toBe("/help/outputs");
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

  it("finds the e-invoice guide by the names of the formats and networks, on the help home and in the panel", () => {
    // One index serves both: the panel searched articles only, so it never listed this guide (N-12).
    const fuse = buildSiteHelpFuse();
    for (const q of ["peppol", "ksef", "e-invoice", "xrechnung", "zugferd"])
      expect(searchHelpArticles(fuse, q, 6).map((h) => h.href), q).toContain("/help/guides/send-e-invoices");
  });
});