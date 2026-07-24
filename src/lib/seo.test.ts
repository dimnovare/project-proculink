import { describe, it, expect } from "vitest";
import { pageMetadata, helpArticleMetadata, OG_IMAGE_PATH } from "./seo";

describe("pageMetadata", () => {
  const meta = pageMetadata({
    path: "/formats",
    title: "Formats & methods — ProcuLink",
    description: "Every way ProcuLink can import and deliver purchase orders.",
  });

  it("sets a self-referencing canonical", () => {
    expect(meta.alternates?.canonical).toBe("/formats");
  });

  it("mirrors title and description into Open Graph and Twitter", () => {
    expect(meta.openGraph?.title).toBe("Formats & methods — ProcuLink");
    expect(meta.openGraph?.description).toBe(
      "Every way ProcuLink can import and deliver purchase orders.",
    );
    expect(meta.twitter?.title).toBe("Formats & methods — ProcuLink");
    expect(meta.twitter?.description).toBe(
      "Every way ProcuLink can import and deliver purchase orders.",
    );
  });

  // Next.js REPLACES a parent's openGraph object when a child declares one, so
  // a page-level openGraph without images silently drops the root og:image
  // (verified on prod 2026-07-24: /formats served no og:image). Every page-level
  // block must therefore carry the image itself.
  it("always carries the share image and site name", () => {
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({ url: OG_IMAGE_PATH, width: 1200, height: 630 }),
    ]);
    expect(meta.twitter?.images).toEqual([OG_IMAGE_PATH]);
    expect(meta.openGraph?.siteName).toBe("ProcuLink");
    expect(meta.twitter?.card).toBe("summary_large_image");
  });

  it("sets og:url to the page path and defaults to type website", () => {
    expect(meta.openGraph).toMatchObject({ url: "/formats", type: "website" });
  });

  it("lets a page override only the social copy", () => {
    const m = pageMetadata({
      path: "/pricing",
      title: "Pricing — ProcuLink",
      description: "Long search-result description.",
      ogTitle: "Short social title",
      ogDescription: "Short social description.",
    });
    expect(m.title).toBe("Pricing — ProcuLink");
    expect(m.description).toBe("Long search-result description.");
    expect(m.openGraph?.title).toBe("Short social title");
    expect(m.openGraph?.description).toBe("Short social description.");
    expect(m.twitter?.title).toBe("Short social title");
  });

  it("marks noindex pages as noindex, nofollow", () => {
    const m = pageMetadata({
      path: "/welcome",
      title: "Welcome to ProcuLink",
      description: "Your workspace is ready.",
      noindex: true,
    });
    expect(m.robots).toEqual({ index: false, follow: false });
  });

  it("leaves indexable pages without a robots override", () => {
    expect(meta.robots).toBeUndefined();
  });

  it("rejects a path that is not a rooted, trailing-slash-free route", () => {
    expect(() => pageMetadata({ path: "formats", title: "t", description: "d" })).toThrow();
    expect(() => pageMetadata({ path: "/formats/", title: "t", description: "d" })).toThrow();
  });
});

describe("helpArticleMetadata", () => {
  const meta = helpArticleMetadata({
    slug: "first-upload",
    title: "Your first purchase order upload — ProcuLink Help",
    description: "Walk through uploading a purchase order file and getting it parsed.",
  });

  // Prod regression this guards: every help article inherited the /help layout's
  // canonical, so all 33 declared themselves duplicates of the help index.
  it("canonicalises to the article, not the help index", () => {
    expect(meta.alternates?.canonical).toBe("/help/first-upload");
    expect(meta.openGraph?.url).toBe("/help/first-upload");
  });

  it("is an Open Graph article", () => {
    expect(meta.openGraph).toMatchObject({ type: "article" });
  });

  it("keeps the article's own title in the share card", () => {
    expect(meta.openGraph?.title).toBe("Your first purchase order upload — ProcuLink Help");
  });

  it("rejects a slug that is not registered in the help article registry", () => {
    expect(() =>
      helpArticleMetadata({ slug: "not-an-article", title: "t", description: "d" }),
    ).toThrow(/not-an-article/);
  });
});
