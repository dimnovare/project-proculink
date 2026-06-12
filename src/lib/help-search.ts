import Fuse from "fuse.js";
import { HELP_ARTICLES, type HelpArticle } from "./help-articles";

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

/** Search the shared index, capped (slideover shows at most 6 results). */
export function searchHelpArticles(
  fuse: Fuse<HelpArticle>,
  query: string,
  max = 6,
): HelpArticle[] {
  const q = query.trim();
  if (!q) return [];
  return fuse
    .search(q)
    .slice(0, max)
    .map((r) => r.item);
}
