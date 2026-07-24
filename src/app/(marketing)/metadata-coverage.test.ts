import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import sitemap from "../sitemap";

/**
 * SEO coverage gate for the public marketing surface.
 *
 * Every public page must carry its OWN title, description, self-canonical and
 * Open Graph block. Inheriting them from a parent layout is not enough: Next.js
 * hands a child page the parent's `alternates.canonical` and `openGraph`
 * verbatim, which is how all 33 help articles ended up canonicalising to /help
 * (verified on prod 2026-07-24).
 *
 * The gate is source-text based on purpose — page.mdx cannot be imported by
 * vitest without the MDX pipeline, and a client-component page carries its
 * metadata in the sibling layout.
 */

// jsdom serves `import.meta.url` as an http URL, so resolve from the vitest cwd
// (the package root) instead. Route groups add no path segment, so both trees
// start at the site root.
const APP_DIR = join(process.cwd(), "src", "app");
const PUBLIC_GROUPS = ["(home)", "(marketing)"];
const SITE_URL = "https://proculink.eu";

interface MarketingPage {
  /** Route path, e.g. "/help/first-upload". */
  route: string;
  /** File that is expected to export the metadata (page or sibling layout). */
  metadataFile: string;
  source: string;
}

function collect(dir: string, route: string, out: MarketingPage[]): MarketingPage[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const pageFile = ["page.tsx", "page.mdx"]
    .map((f) => join(dir, f))
    .find((f) => existsSync(f));

  if (pageFile) {
    const pageSource = readFileSync(pageFile, "utf8");
    const declaresMetadata = /export (const metadata|function generateMetadata|async function generateMetadata)/.test(pageSource);
    const layoutFile = join(dir, "layout.tsx");
    const metadataFile = declaresMetadata ? pageFile : layoutFile;
    out.push({
      route: route === "" ? "/" : route,
      metadataFile,
      source: existsSync(metadataFile) ? readFileSync(metadataFile, "utf8") : "",
    });
  }

  for (const entry of entries) {
    // Route groups "(x)" contribute no path segment; the marketing tree has none.
    if (entry.isDirectory()) collect(join(dir, entry.name), `${route}/${entry.name}`, out);
  }
  return out;
}

const PAGES = PUBLIC_GROUPS.reduce<MarketingPage[]>(
  (out, group) => collect(join(APP_DIR, group), "", out),
  [],
);

/** The route each page's metadata call declares, or null when it declares none. */
function declaredRoute(page: MarketingPage): string | null {
  const slug = page.source.match(/slug:\s*"([^"]+)"/);
  if (slug && /helpArticleMetadata\(/.test(page.source)) return `/help/${slug[1]}`;
  const path = page.source.match(/path:\s*"([^"]+)"/);
  return path ? path[1] : null;
}

describe("marketing SEO metadata", () => {
  it("finds the whole public marketing surface", () => {
    // Sanity floor: the tree is ~50 pages; a collector that silently walked the
    // wrong directory would make every assertion below vacuously pass.
    expect(PAGES.length).toBeGreaterThan(40);
    expect(PAGES.map((p) => p.route)).toContain("/");
    expect(PAGES.map((p) => p.route)).toContain("/help/first-upload");
    expect(PAGES.map((p) => p.route)).toContain("/pricing");
  });

  it.each(PAGES.map((p) => [p.route, p] as const))(
    "%s declares its own metadata through the shared SEO helper",
    (_route, page) => {
      expect(existsSync(page.metadataFile), `${page.metadataFile} is missing`).toBe(true);
      expect(/pageMetadata\(|helpArticleMetadata\(/.test(page.source)).toBe(true);
    },
  );

  it.each(PAGES.map((p) => [p.route, p] as const))(
    "%s canonicalises to itself",
    (route, page) => {
      expect(declaredRoute(page)).toBe(route);
    },
  );

  it("gives every page a unique canonical", () => {
    const routes = PAGES.map((p) => declaredRoute(p));
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("keeps the sitemap and the indexable pages in step", () => {
    const sitemapRoutes = new Set(
      sitemap().map((entry) => entry.url.replace(SITE_URL, "") || "/"),
    );
    const indexable = PAGES.filter((p) => !/noindex:\s*true/.test(p.source)).map((p) => p.route);
    const noindexed = PAGES.filter((p) => /noindex:\s*true/.test(p.source)).map((p) => p.route);

    for (const route of indexable) {
      expect(sitemapRoutes.has(route), `${route} is indexable but absent from the sitemap`).toBe(true);
    }
    for (const route of noindexed) {
      expect(sitemapRoutes.has(route), `${route} is noindex but listed in the sitemap`).toBe(false);
    }
    // The landing page lives outside (marketing); everything else in the sitemap
    // must be a real marketing route.
    const known = new Set([...PAGES.map((p) => p.route), "/"]);
    for (const route of sitemapRoutes) {
      expect(known.has(route), `${route} is in the sitemap but has no page`).toBe(true);
    }
  });
});
