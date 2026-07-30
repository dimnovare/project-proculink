import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

import nextConfig from "../../next.config";
import { HELP_ARTICLES } from "@/lib/help-articles";
import { SECTION_GUIDES } from "@/lib/section-guides";
import { ROOT, listAppRoutes, matchesAny, normalizePath, isInternalPageLink } from "./appRoutes";

/**
 * Zero dead links.
 *
 * Every internal link we ship — in a help article, on a marketing page, in the
 * sidebar, in a hub tab bar, in the command palette, in a per-screen guide —
 * must land on a page that exists, or on a path we deliberately redirect. This
 * crawl reads the links out of the source instead of driving a browser so it
 * runs in CI in under a second and covers every article whether or not a test
 * happens to visit it.
 *
 * It is a REGRESSION gate: it passes today, and it is what stops a page removal
 * from quietly turning an article's "see X" into a 404.
 */

const APP_ROUTES = listAppRoutes();

/** Paths that resolve outside the App Router page tree. */
const NON_PAGE_PATHS = [
  "/sitemap.xml",
  "/robots.txt",
];

function walk(dir: string, test: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, test));
    else if (test(entry)) out.push(full);
  }
  return out;
}

/** Markdown `[text](/path)` plus JSX/HTML `href="/path"` and `router.push("/path")`. */
function extractLinks(source: string): string[] {
  const links: string[] = [];
  const patterns = [
    /\]\((\/[^)\s]*)\)/g,          // markdown link
    /href=["'`](\/[^"'`]*)["'`]/g, // JSX / HTML attribute
    /href:\s*["'`](\/[^"'`]*)["'`]/g,
    /router\.push\(["'`](\/[^"'`]*)["'`]\)/g,
    /route:\s*["'`](\/[^"'`]*)["'`]/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) links.push(m[1]);
  }
  return links;
}

async function redirectSources(): Promise<string[]> {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  // Host-conditional redirects (www → apex) are not path retirements.
  return redirects.filter((r) => !("has" in r && r.has)).map((r) => r.source);
}

async function resolves(path: string): Promise<boolean> {
  const clean = normalizePath(path);
  if (NON_PAGE_PATHS.includes(clean)) return true;
  if (matchesAny(clean, APP_ROUTES)) return true;
  return matchesAny(clean, await redirectSources());
}

async function assertAllResolve(entries: Array<{ from: string; href: string }>) {
  const dead: string[] = [];
  for (const { from, href } of entries) {
    if (!isInternalPageLink(href)) continue;
    if (!(await resolves(href))) dead.push(`${from} → ${href}`);
  }
  expect(dead, `dead internal links (would 404):\n  ${dead.join("\n  ")}`).toEqual([]);
}

describe("link crawl — nothing we ship points at a 404", () => {
  it("help centre articles link only to live pages", async () => {
    const helpDir = join(ROOT, "src", "app", "(marketing)", "help");
    const files = walk(helpDir, (f) => f.endsWith(".mdx") || f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(30); // the crawl is actually reading the articles

    const entries = files.flatMap((file) =>
      extractLinks(readFileSync(file, "utf8")).map((href) => ({
        from: relative(ROOT, file),
        href,
      })),
    );
    expect(entries.length).toBeGreaterThan(50);
    await assertAllResolve(entries);
  });

  it("every registered help article has a page", async () => {
    const dead: string[] = [];
    for (const article of HELP_ARTICLES) {
      if (!(await resolves(`/help/${article.slug}`))) dead.push(article.slug);
    }
    expect(dead, `help-articles.ts lists slugs with no page: ${dead.join(", ")}`).toEqual([]);
  });

  it("marketing pages link only to live pages", async () => {
    const entries = [
      join(ROOT, "src", "app", "(marketing)"),
      join(ROOT, "src", "app", "(home)"),
      join(ROOT, "src", "components", "marketing"),
    ].flatMap((dir) =>
      walk(dir, (f) => f.endsWith(".tsx") && !f.includes(".test.")).flatMap((file) =>
        extractLinks(readFileSync(file, "utf8")).map((href) => ({
          from: relative(ROOT, file),
          href,
        })),
      ),
    );
    expect(entries.length).toBeGreaterThan(20);
    await assertAllResolve(entries);
  });

  it("in-app navigation links only to live pages", async () => {
    const NAV_SOURCES = [
      "src/components/bridge/BridgeSidebar.tsx",
      "src/components/bridge/layout/HubTabs.tsx",
      "src/components/bridge/CommandPalette.tsx",
    ];
    const entries = NAV_SOURCES.flatMap((file) =>
      extractLinks(readFileSync(join(ROOT, file), "utf8")).map((href) => ({ from: file, href })),
    );
    expect(entries.length).toBeGreaterThan(10);
    await assertAllResolve(entries);
  });

  it("every per-screen guide describes a screen that exists", async () => {
    const dead: string[] = [];
    for (const guide of SECTION_GUIDES) {
      // `route` is an App Router pattern ("/inbox/[orderId]"), not a link.
      if (!matchesAny(guide.route.replace(/\[[^\]]+\]/g, "probe"), APP_ROUTES)) {
        dead.push(`route ${guide.route}`);
      }
      for (const link of [...guide.bullets, guide.firstStep]) {
        if (link.href && isInternalPageLink(link.href) && !(await resolves(link.href))) {
          dead.push(`${guide.route} bullet → ${link.href}`);
        }
      }
    }
    expect(dead, `section guides point at missing screens:\n  ${dead.join("\n  ")}`).toEqual([]);
  });
});
