import Fuse from "fuse.js";
import { HELP_ARTICLES, type HelpArticle } from "./help-articles";
import { liveClientGuides } from "./guides";

/**
 * Shared help-article search index — used by BOTH the /help center page and
 * the in-app help slideover so the two surfaces always agree on results.
 *
 * Weighted keys: title dominates, blurb next, curated keywords cover the
 * operator vocabulary MDX prose doesn't surface (e.g. "IMAP", "test-fire",
 * "429"), category is a light tie-breaker.
 */
export function buildHelpFuse(
  articles: HelpArticle[] = HELP_ARTICLES,
): Fuse<HelpArticle> {
  return new Fuse(articles, {
    keys: [
      { name: "title", weight: 0.5 },
      { name: "blurb", weight: 0.3 },
      { name: "keywords", weight: 0.15 },
      { name: "category", weight: 0.05 },
    ],
    threshold: 0.4,
  });
}

/** One row of the help home's search: an article or a live public guide. */
export interface HelpHit {
  kind: "article" | "guide";
  title: string;
  blurb: string;
  href: string;
  minutes?: number;
  keywords: string[];
}

/** The help home's index: articles and live public guides together. The panel keeps its article index. */
export function buildSiteHelpFuse(): Fuse<HelpHit> {
  const hits: HelpHit[] = [
    ...HELP_ARTICLES.map((a): HelpHit => ({ kind: "article", title: a.title, blurb: a.blurb, href: `/help/${a.slug}`, minutes: a.readMin, keywords: a.keywords })),
    ...liveClientGuides().map((g): HelpHit => ({ kind: "guide", title: g.title, blurb: g.blurb, href: g.href, minutes: g.minutes, keywords: [] })),
  ];
  return new Fuse(hits, {
    keys: [
      { name: "title", weight: 0.5 },
      { name: "blurb", weight: 0.35 },
      { name: "keywords", weight: 0.15 },
    ],
    threshold: 0.4,
  });
}

/** Search a shared index, capped (slideover shows at most 6 results). */
export function searchHelpArticles<T>(fuse: Fuse<T>, query: string, max = 6): T[] {
  const q = query.trim();
  if (!q) return [];
  return fuse
    .search(q)
    .slice(0, max)
    .map((r) => r.item);
}
