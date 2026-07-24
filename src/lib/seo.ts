import type { Metadata } from "next";
import { HELP_ARTICLES } from "./help-articles";

/**
 * Per-page SEO metadata for the public marketing surface.
 *
 * Two Next.js inheritance rules make a shared builder necessary rather than
 * merely tidy:
 *
 *  1. A child page inherits the parent layout's `alternates.canonical`
 *     verbatim. The /help layout declared `canonical: "/help"`, so every help
 *     article told search engines it was a duplicate of the help index
 *     (confirmed on prod 2026-07-24 — /help/first-upload served
 *     `<link rel="canonical" href="https://proculink.eu/help">`).
 *
 *  2. A page-level `openGraph` REPLACES the root layout's block instead of
 *     merging into it. Pages that declared their own openGraph without an image
 *     therefore served no og:image at all (confirmed on prod: /formats).
 *
 * So every page states its own canonical, and every openGraph block it emits is
 * complete — image, site name, type and url included.
 */

export const SITE_URL = "https://proculink.eu";
export const OG_IMAGE_PATH = "/og-image.png";

const OG_IMAGE = {
  url: OG_IMAGE_PATH,
  width: 1200,
  height: 630,
  alt: "ProcuLink — connecting procurement",
};

export interface PageSeo {
  /** Route path, rooted and without a trailing slash: "/pricing". */
  path: string;
  /** `<title>` — unique per page. */
  title: string;
  /** Meta description — unique per page, written for a search result. */
  description: string;
  /** Shorter share-card title. Defaults to `title`. */
  ogTitle?: string;
  /** Shorter share-card description. Defaults to `description`. */
  ogDescription?: string;
  /** Open Graph object type. Help articles use "article". */
  type?: "website" | "article";
  /** Keep the page out of search results (and out of the sitemap). */
  noindex?: boolean;
}

export function pageMetadata({
  path,
  title,
  description,
  ogTitle,
  ogDescription,
  type = "website",
  noindex,
}: PageSeo): Metadata {
  if (!path.startsWith("/") || (path.length > 1 && path.endsWith("/"))) {
    throw new Error(`SEO path must be rooted and trailing-slash-free: "${path}"`);
  }

  const socialTitle = ogTitle ?? title;
  const socialDescription = ogDescription ?? description;

  return {
    title,
    description,
    alternates: { canonical: path },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type,
      title: socialTitle,
      description: socialDescription,
      url: path,
      siteName: "ProcuLink",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: socialDescription,
      images: [OG_IMAGE_PATH],
    },
  };
}

export interface HelpArticleSeo extends Omit<PageSeo, "path" | "type"> {
  /** Registry slug — must exist in HELP_ARTICLES so the sitemap stays in step. */
  slug: string;
}

export function helpArticleMetadata({ slug, ...rest }: HelpArticleSeo): Metadata {
  if (!HELP_ARTICLES.some((article) => article.slug === slug)) {
    throw new Error(`No help article registered for slug "${slug}"`);
  }
  return pageMetadata({ ...rest, path: `/help/${slug}`, type: "article" });
}
