import { describe, it, expect } from "vitest";
import { metadata as homeMetadata } from "@/app/(home)/layout";
import { metadata as rootMetadata } from "@/app/layout";
import { PUBLIC_LADDER } from "./plans";
import {
  breadcrumbStructuredData,
  SOFTWARE_STRUCTURED_DATA,
  WEBSITE_STRUCTURED_DATA,
  pageMetadata,
  helpArticleMetadata,
  OG_IMAGE,
  OG_IMAGE_PATH,
  SITE_DESCRIPTION,
  SITE_TAGLINE,
  SITE_TITLE,
} from "./seo";

describe("site title", () => {
  it("names the site once: the tab title, the home page and the share image all carry the tagline", () => {
    expect(SITE_TAGLINE).toBe("Any document in. Clean data out.");
    expect(SITE_TITLE).toBe("ProcuLink — Any document in. Clean data out.");
    expect(OG_IMAGE.alt).toBe(SITE_TITLE);
    // The root layout's own metadata: every page inherits it, so it carries the
    // share image and must not carry a canonical (each page would point at /).
    expect(rootMetadata.title).toBe(SITE_TITLE);
    expect(rootMetadata.openGraph?.images).toEqual([OG_IMAGE]);
    expect(rootMetadata.twitter?.images).toEqual([OG_IMAGE_PATH]);
    expect(rootMetadata.alternates?.canonical).toBeUndefined();
    expect(homeMetadata.title).toBe(SITE_TITLE);
    expect(homeMetadata.description).toBe(SITE_DESCRIPTION);
    expect(homeMetadata.openGraph?.title).toBe(SITE_TITLE);
    expect(JSON.stringify(homeMetadata)).not.toMatch(/connecting procurement/i);
  });
});

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
    expect((meta.twitter as { card?: string } | undefined)?.card).toBe("summary_large_image");
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
    slug: "intake-channels",
    title: "Ways to send documents in — ProcuLink Help",
    description: "Every way a document can reach a flow.",
  });

  // Prod regression this guards: every help article inherited the /help layout's
  // canonical, so all 33 declared themselves duplicates of the help index.
  it("canonicalises to the article, not the help index", () => {
    expect(meta.alternates?.canonical).toBe("/help/intake-channels");
    expect(meta.openGraph?.url).toBe("/help/intake-channels");
  });

  it("is an Open Graph article", () => {
    expect(meta.openGraph).toMatchObject({ type: "article" });
  });

  it("keeps the article's own title in the share card", () => {
    expect(meta.openGraph?.title).toBe("Ways to send documents in — ProcuLink Help");
  });

  it("rejects a slug that is not registered in the help article registry", () => {
    expect(() =>
      helpArticleMetadata({ slug: "not-an-article", title: "t", description: "d" }),
    ).toThrow(/not-an-article/);
  });
});

describe("structured data", () => {
  it("names the site ProcuLink, prices the product off the public ladder, and makes breadcrumb links absolute", () => {
    expect(WEBSITE_STRUCTURED_DATA).toMatchObject({ "@type": "WebSite", name: "ProcuLink", url: "https://proculink.eu" });
    const paid = PUBLIC_LADDER.map((p) => p.priceMonthly).filter((p): p is number => !!p);
    expect(paid.length, "anti-vacuity: the ladder has paid tiers").toBeGreaterThan(2);
    expect(SOFTWARE_STRUCTURED_DATA.offers).toMatchObject({
      priceCurrency: "EUR",
      lowPrice: Math.min(...paid),
      highPrice: Math.max(...paid),
      offerCount: paid.length,
    });
    // Nothing the site cannot show: no rating, no review count.
    expect(JSON.stringify(SOFTWARE_STRUCTURED_DATA)).not.toMatch(/"(aggregateRating|review)"/);
    expect(breadcrumbStructuredData([{ name: "Help centre", path: "/help" }, { name: "Checks", path: "/help/checks" }]).itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Help centre", item: "https://proculink.eu/help" },
      { "@type": "ListItem", position: 2, name: "Checks", item: "https://proculink.eu/help/checks" },
    ]);
  });
});
