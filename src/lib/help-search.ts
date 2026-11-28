import Fuse from "fuse.js";
import { HELP_ARTICLES, type HelpArticle } from "./help-articles";
import { liveClientGuides } from "./guides";

/** One row of the help home's search: an article or a live public guide. */
export interface HelpHit {
  kind: "article" | "guide";
  title: string;
  blurb: string;
  href: string;
  minutes?: number;
  keywords: string[];
}

/** An article as a row of the help home. */
export const articleHit = (a: HelpArticle): HelpHit => ({ kind: "article", title: a.title, blurb: a.blurb, href: `/help/${a.slug}`, minutes: a.readMin, keywords: a.keywords });

/** The help home's and the in-app panel's index: articles and live public guides together. */
export function buildSiteHelpFuse(): Fuse<HelpHit> {
  const hits: HelpHit[] = [
    ...HELP_ARTICLES.map(articleHit),
    ...liveClientGuides().map((g): HelpHit => ({ kind: "guide", title: g.title, blurb: g.blurb, href: g.href, minutes: g.minutes, keywords: g.keywords ?? [] })),
  ];
  return new Fuse(hits, {
    keys: [
      { name: "title", weight: 0.5 },
      { name: "blurb", weight: 0.35 },
      { name: "keywords", weight: 0.15 },
    ],
    threshold: 0.4,
    includeScore: true,
  });
}

/** A search row's second line: an article's reading time, or that it is a guide. */
export const hitMeta = (hit: HelpHit) =>
  hit.kind === "article"
    ? `${hit.minutes} minute read`
    : `Step-by-step guide${hit.minutes != null ? `, about ${hit.minutes} minutes` : ""}`;

/** Search a shared index, capped (slideover shows at most 6 results). */
export function searchHelpArticles<T>(fuse: Fuse<T>, query: string, max = 6): T[] {
  const q = query.trim();
  if (!q) return [];
  const whole = fuse.search(q);
  const words = q.split(/\s+/);
  if (whole.length > 0 || words.length < 2) return whole.slice(0, max).map((r) => r.item);
  // No article has the words together ("excel semicolon"): rank by how many of them it has, then by how well.
  const hits = new Map<T, { n: number; score: number }>();
  for (const w of words) {
    for (const r of fuse.search(w)) {
      const h = hits.get(r.item) ?? { n: 0, score: 0 };
      hits.set(r.item, { n: h.n + 1, score: h.score + (r.score ?? 1) });
    }
  }
  return [...hits].sort(([, a], [, b]) => b.n - a.n || a.score / a.n - b.score / b.n).slice(0, max).map(([item]) => item);
}
