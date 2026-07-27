import { describe, it, expect } from "vitest";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  HELP_ARTICLES,
  POPULAR_ARTICLE_SLUGS,
  getAdjacentArticles,
  getArticleBySlug,
  resolveArticles,
} from "@/lib/help-articles";

describe("HELP_ARTICLES registry shape", () => {
  it("has unique slugs", () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("no longer contains the deleted delivery-config article", () => {
    expect(getArticleBySlug("delivery-config")).toBeUndefined();
  });

  it("every article has a category with meta, a positive readMin, and keywords", () => {
    for (const a of HELP_ARTICLES) {
      expect(CATEGORY_ORDER, `category of ${a.slug}`).toContain(a.category);
      expect(CATEGORY_META[a.category], `meta for ${a.category}`).toBeDefined();
      expect(a.readMin, `readMin of ${a.slug}`).toBeGreaterThan(0);
      expect(a.keywords.length, `keywords of ${a.slug}`).toBeGreaterThan(0);
      for (const k of a.keywords) {
        expect(k.trim().length, `keyword "${k}" on ${a.slug}`).toBeGreaterThan(0);
      }
    }
  });

  it("array order follows the category learning path", () => {
    // Registry order drives the prev/next pager; categories must appear in
    // CATEGORY_ORDER sequence (articles of the same category stay adjacent).
    const indices = HELP_ARTICLES.map((a) => CATEGORY_ORDER.indexOf(a.category));
    for (let i = 1; i < indices.length; i++) {
      expect(
        indices[i],
        `${HELP_ARTICLES[i].slug} is out of learning-path order`,
      ).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });

  it("Billing soft tint no longer duplicates Getting started", () => {
    expect(CATEGORY_META.Billing.soft).not.toBe(CATEGORY_META["Getting started"].soft);
  });
});

describe("resolveArticles", () => {
  it("resolves known slugs in order", () => {
    const out = resolveArticles(["item-codes", "billing-faq"]);
    expect(out.map((a) => a.slug)).toEqual(["item-codes", "billing-faq"]);
  });

  it("silently skips slugs without a published article", () => {
    const out = resolveArticles(["not-written-yet", "item-codes", "another-future-article"]);
    expect(out.map((a) => a.slug)).toEqual(["item-codes"]);
  });

  it("caps at max AFTER skipping unknowns (forward-compatible curation)", () => {
    const out = resolveArticles(
      ["not-written-yet", "item-codes", "delivery-setup", "billing-faq", "troubleshooting"],
      3,
    );
    expect(out.map((a) => a.slug)).toEqual(["item-codes", "delivery-setup", "billing-faq"]);
  });

  it("returns [] for undefined or empty input", () => {
    expect(resolveArticles(undefined)).toEqual([]);
    expect(resolveArticles([])).toEqual([]);
  });

  it("popular curation resolves to at least 3 published articles", () => {
    // The slideover's no-guide fallback shows the top 3; the curated list may
    // name unwritten articles, but at least 3 must already be real.
    expect(resolveArticles(POPULAR_ARTICLE_SLUGS, 3)).toHaveLength(3);
  });
});

describe("getAdjacentArticles", () => {
  it("first article has no prev, last has no next", () => {
    const first = HELP_ARTICLES[0];
    const last = HELP_ARTICLES[HELP_ARTICLES.length - 1];
    expect(getAdjacentArticles(first.slug).prev).toBeUndefined();
    expect(getAdjacentArticles(last.slug).next).toBeUndefined();
  });

  it("returns {} for an unknown slug", () => {
    expect(getAdjacentArticles("nope")).toEqual({});
  });
});

describe("per-tool video wiring (offer⇔works)", () => {
  const TOOL_VIDEO_PREFIX = "https://assets.proculink.eu/marketing/tools/";
  const withVideo = HELP_ARTICLES.filter((a) => a.videoUrl);

  it("wires at least one per-tool video", () => {
    expect(withVideo.length).toBeGreaterThan(0);
  });

  it("every videoUrl is a hosted assets.proculink.eu/marketing/tools/ mp4", () => {
    for (const a of withVideo) {
      expect(
        a.videoUrl!.startsWith(TOOL_VIDEO_PREFIX),
        `${a.slug} videoUrl must start with ${TOOL_VIDEO_PREFIX}`,
      ).toBe(true);
      expect(a.videoUrl!.endsWith(".mp4"), `${a.slug} videoUrl must end with .mp4`).toBe(true);
    }
  });

  it("every videoUrl also carries a poster on the same host", () => {
    for (const a of withVideo) {
      expect(a.videoPosterUrl, `${a.slug} must carry a poster`).toBeTruthy();
      expect(a.videoPosterUrl!.startsWith(TOOL_VIDEO_PREFIX)).toBe(true);
    }
  });

  it("no two articles share a videoUrl (one article = at most one video)", () => {
    const urls = withVideo.map((a) => a.videoUrl!);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
