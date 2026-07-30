// Shared route inventory for the retirement + link-crawl gates.
//
// Not a test file (no `.test.` in the name) so vitest treats it as a helper.
// It walks src/app the way the App Router does — route groups "(x)" contribute
// no URL segment, `[param]` matches one segment, `[[...catchAll]]` matches the
// rest — and turns the file tree into the set of URLs the site actually serves.
// Both gates then answer one question with it: "does this link land somewhere?"

import { readdirSync, existsSync } from "fs";
import { join } from "path";

// jsdom reports import.meta.url as an http URL, so resolve from the vitest cwd
// (the package root) like the other source-scanning tests in this repo do.
export const ROOT = process.cwd();
const APP_DIR = join(ROOT, "src", "app");

const PAGE_FILES = ["page.tsx", "page.mdx"];

/**
 * Every route the App Router serves, as a URL pattern:
 *   "/library/suppliers"      static
 *   "/inbox/[orderId]"        one dynamic segment
 *   "/sign-in/[[...sign-in]]" optional catch-all
 */
export function listAppRoutes(dir: string = APP_DIR, route = ""): string[] {
  const found: string[] = [];
  if (PAGE_FILES.some((f) => existsSync(join(dir, f)))) {
    found.push(route === "" ? "/" : route);
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Private folders (_x) and route groups ((x)) add no URL segment.
    if (entry.name.startsWith("_")) continue;
    const segment = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
    found.push(...listAppRoutes(join(dir, entry.name), route + segment));
  }
  return found;
}

/** Turn a route pattern or a redirect `source` into a matcher for real paths. */
function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      // App Router optional catch-all: /sign-in/[[...sign-in]] also matches /sign-in
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:/.*)?";
      if (/^\[\.\.\..+\]$/.test(segment)) return "/.+";
      if (/^\[.+\]$/.test(segment)) return "/[^/]+";
      // Next.js redirect source syntax: /upload/preview/:orderId
      if (/^:.+\*$/.test(segment)) return "(?:/.*)?";
      if (/^:.+$/.test(segment)) return "/[^/]+";
      return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
    })
    .join("");
  return new RegExp(`^${body || "/"}$`);
}

/** Does `path` (no query, no hash) resolve to one of `patterns`? */
export function matchesAny(path: string, patterns: string[]): boolean {
  const clean = normalizePath(path);
  return patterns.some((p) => patternToRegExp(p).test(clean));
}

/** Strip query, hash and a trailing slash so "/help/x?y=1#z" compares as "/help/x". */
export function normalizePath(href: string): string {
  const path = href.split("#")[0].split("?")[0];
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path === "" ? "/" : path;
}

/** In-app links only: skip mailto:, tel:, external URLs, anchors and asset paths. */
export function isInternalPageLink(href: string): boolean {
  if (!href.startsWith("/")) return false;
  if (href.startsWith("//")) return false; // protocol-relative external
  const path = normalizePath(href);
  // Files served from /public (images, video posters, the OG image, …) and the
  // API origin are not App Router pages.
  if (/\.[a-z0-9]{2,5}$/i.test(path)) return false;
  if (path.startsWith("/api/")) return false;
  return true;
}
