import { describe, it, expect } from "vitest";
import { buildHelpFuse, searchHelpArticles } from "@/lib/help-search";

describe("help search (shared Fuse index)", () => {
  const fuse = buildHelpFuse();

  it("returns [] for an empty or whitespace query", () => {
    expect(searchHelpArticles(fuse, "")).toEqual([]);
    expect(searchHelpArticles(fuse, "   ")).toEqual([]);
  });

  it("finds articles by curated keyword, not just title text", () => {
    // "IMAP" appears in email-polling's keywords/title; "test-fire" only in
    // delivery-setup's keywords — the operator vocabulary the MDX titles miss.
    const imap = searchHelpArticles(fuse, "imap").map((a) => a.slug);
    expect(imap).toContain("email-polling");

    const testFire = searchHelpArticles(fuse, "test-fire").map((a) => a.slug);
    expect(testFire).toContain("delivery-setup");
  });

  it("finds articles by title", () => {
    const out = searchHelpArticles(fuse, "first purchase order upload").map((a) => a.slug);
    expect(out[0]).toBe("first-upload");
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
