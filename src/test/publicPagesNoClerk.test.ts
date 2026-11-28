// No sign-in code on the public pages. Clerk is ~195 kB of script, and it used to reach every public page
// through the root layout's provider and through shared chrome (the footer's language list imported a menu
// hook from the workspace switcher). It now loads only under the layouts that mount AppClerkProvider.
//
// This walks the import graph, static and dynamic, from every route file OUTSIDE those layouts, so a new
// public page is covered without being listed, and fails on any `@clerk/` import it reaches.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./appRoutes";
import { stripComments, syntaxFor } from "./sourceScan";

const APP = join(ROOT, "src", "app");
/** The only route trees allowed to load Clerk: each one's layout mounts AppClerkProvider. */
const CLERK_TREES = ["(app)", "sign-in", "sign-up", "onboarding", join("(marketing)", "welcome")].map((d) => join(APP, d));
const ROUTE_FILE = /^(page|layout|not-found|error|global-error|loading|template)\.(tsx?|mdx)$/;
const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", ".mdx", "/index.ts", "/index.tsx"];
const SPEC = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function routeFiles(dir: string, out: string[] = []): string[] {
  if (CLERK_TREES.includes(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (ROUTE_FILE.test(name)) out.push(p);
  }
  return out;
}

function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  return base && (EXTS.map((e) => base + e).find((p) => existsSync(p) && statSync(p).isFile()) ?? null);
}

/** Every `@clerk/` import reachable from the entries, as "importer -> package" with the path that led there. */
function clerkReach(entries: string[]) {
  const seen = new Set<string>();
  const hits: string[] = [];
  const queue = entries.map((e) => [e, relative(ROOT, e)] as const);
  while (queue.length) {
    const [file, trail] = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = stripComments(readFileSync(file, "utf8"), syntaxFor(file));
    for (const [, spec] of code.matchAll(SPEC)) {
      if (spec.startsWith("@clerk/")) hits.push(`${trail} -> ${spec}`);
      const next = resolve(spec, file);
      if (next) queue.push([next, `${trail} > ${relative(ROOT, next).split(sep).pop()}`]);
    }
  }
  return { seen, hits };
}

describe("public pages load no sign-in code", () => {
  const entries = routeFiles(APP);
  const { seen, hits } = clerkReach(entries);

  it("reaches no @clerk/ import from any route outside the Clerk layouts", () => {
    expect(hits).toEqual([]);
  });

  it("walked the real public tree, not an empty one", () => {
    const walked = [...seen].map((f) => relative(ROOT, f).split(sep).join("/"));
    expect(entries.length).toBeGreaterThan(30);
    for (const f of ["src/app/layout.tsx", "src/app/(home)/page.tsx", "src/app/not-found.tsx", "src/components/marketing/MarketingNav.tsx", "src/components/marketing/SiteFooter.tsx", "src/components/marketing/LanguageSwitcher.tsx"])
      expect(walked).toContain(f);
    // The Clerk trees are excluded, and the walker does see Clerk where it is.
    expect(walked.some((f) => f.startsWith("src/app/(app)/"))).toBe(false);
    expect(clerkReach([join(APP, "(app)", "layout.tsx")]).hits.length).toBeGreaterThan(0);
  });
});
