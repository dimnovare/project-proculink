import type { Metadata } from "next";
import { HELP_ARTICLES } from "./help-articles";
import { GUIDES } from "./guides";
import { LEGAL_ENTITY } from "./legal-entity";
import { PUBLIC_LADDER } from "./plans";

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

export const SITE_TAGLINE = "Any document in. Clean data out.";
export const SITE_TITLE = `ProcuLink — ${SITE_TAGLINE}`;
export const SITE_DESCRIPTION =
  "ProcuLink reads the invoices, orders and other documents you receive, shows you what it read beside the original, and sends the data on in the format your system needs.";

export const OG_IMAGE = {
  url: OG_IMAGE_PATH,
  width: 1200,
  height: 630,
  alt: SITE_TITLE,
};

/** Open Graph and Twitter fields for one page. No canonical: that is `pageMetadata`'s job (the root layout must not set one). */
export function socialMetadata({
  title,
  description,
  path,
  type = "website",
}: {
  title: string;
  description: string;
  path?: string;
  type?: "website" | "article";
}): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type,
      title,
      description,
      ...(path ? { url: path } : {}),
      siteName: "ProcuLink",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE_PATH],
    },
  };
}

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

  return {
    title,
    description,
    alternates: { canonical: path },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
    ...socialMetadata({ title: ogTitle ?? title, description: ogDescription ?? description, path, type }),
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

export interface GuideSeo extends Omit<PageSeo, "path" | "type"> {
  /** Registry slug — must exist in GUIDES with status "live". */
  slug: string;
}

/**
 * Metadata for a step-by-step guide.
 *
 * The canonical path comes from the registry entry, not from the caller, so a
 * guide's URL, its index listing, and its sitemap row can never drift apart.
 * Admin guides are forced `noindex` and are never emitted in the sitemap — the
 * route already refuses to render for non-admins; this stops a crawler that
 * somehow reaches the URL from indexing the title.
 */
export function guideMetadata({ slug, ...rest }: GuideSeo): Metadata {
  const guide = GUIDES.find((g) => g.slug === slug);
  if (!guide) throw new Error(`No guide registered for slug "${slug}"`);
  if (guide.status !== "live") {
    throw new Error(`Guide "${slug}" is registered as "planned" — set status: "live" to publish it`);
  }
  return pageMetadata({
    ...rest,
    path: guide.href,
    type: "article",
    noindex: rest.noindex ?? guide.audience === "admin",
  });
}

// ── Structured data (schema.org JSON-LD) ─────────────────────────────────────
// Only facts the page already shows. No rating, review or customer count: there is none to cite.

const PUBLISHER = { "@type": "Organization", name: LEGAL_ENTITY.legalName, url: SITE_URL } as const;

/** Names the site "ProcuLink" in search results; without it the Organization block offers the legal name. */
export const WEBSITE_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: LEGAL_ENTITY.productName,
  url: SITE_URL,
  publisher: PUBLISHER,
} as const;

const PAID_PRICES = PUBLIC_LADDER.map((p) => p.priceMonthly).filter((p): p is number => p != null && p > 0);

/** The product and its public price range, read off the ladder `/pricing` renders. */
export const SOFTWARE_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: LEGAL_ENTITY.productName,
  url: SITE_URL,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: SITE_DESCRIPTION,
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "EUR",
    lowPrice: Math.min(...PAID_PRICES),
    highPrice: Math.max(...PAID_PRICES),
    offerCount: PAID_PRICES.length,
    url: `${SITE_URL}/pricing`,
  },
  publisher: PUBLISHER,
} as const;

/** The visible breadcrumb trail as a BreadcrumbList. Paths are rooted: "/help". */
export function breadcrumbStructuredData(trail: readonly { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: `${SITE_URL}${t.path}` })),
  };
}
