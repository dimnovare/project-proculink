// PAGE TITLE GUARD — every authenticated route names itself in the browser tab.
//
// A Next.js page with no `metadata` export inherits the ROOT layout's title, so
// it renders as "ProcuLink — Connecting Procurement". That is correct for the
// marketing home page and useless everywhere else: an operator working an order
// with Settings, Suppliers and Deliveries open sees four identical tabs and has
// to click each one to find out where they are. Found on production 2026-08-06:
// 16 of 22 routes under src/app/(app) had no title of their own.
//
// A route earns a title from exactly one of two places, and this guard accepts
// both because both really work in the App Router:
//
//   1. `export const metadata` (or `generateMetadata`) in its own page.tsx —
//      only possible when the page is a Server Component.
//   2. the same export in the nearest ANCESTOR layout.tsx — the escape hatch for
//      a `"use client"` page, which cannot export metadata at all (Next.js
//      errors: "You are attempting to export "metadata" from a component marked
//      with "use client""). A sibling layout.tsx is a Server Component even when
//      the page it wraps is not.
//
// Resolution here mirrors Next.js: page beats layout, nearer layout beats
// further layout, and the walk stops at the (app) group boundary — the root
// layout is what we are trying NOT to fall back to, so it does not count as an
// owner.
//
// The titles themselves are not free-form. Navigation labels are a closed
// vocabulary (scripts/check-vocabulary.mjs --nouns), and a browser tab is
// user-facing copy, so a tab title has to be the same word the nav already
// teaches. src/lib/pageTitles.ts derives them from HUB_TABS for every route the
// hub strip covers; the second describe block below is what stops a title from
// drifting away from its tab label after a rename.

import { readdirSync, existsSync, readFileSync } from "fs";
import { join, sep } from "path";
import { describe, it, expect } from "vitest";
import { HUB_TABS } from "@/components/bridge/layout/HubTabs";
import {
  appPageTitle,
  APP_PAGE_TITLES,
  HUB_TAB_TITLES,
  OFF_HUB_TITLES,
  TITLE_SUFFIX,
  LABEL_PINNED_TO_A_DIFFERENT_TITLE,
} from "@/lib/pageTitles";

const ROOT = process.cwd();
const APP_DIR = join(ROOT, "src", "app", "(app)");

/** The root layout's title. Inheriting it IS the defect. */
const GENERIC_TITLE = "ProcuLink — Connecting Procurement";

/** What Next.js treats as a page here — `pageExtensions` covers .mdx too. */
const PAGE_FILES = ["page.tsx", "page.mdx"] as const;

interface AppRoute {
  /** URL pattern, e.g. "/library/suppliers/[id]". */
  route: string;
  /** Absolute directory holding the page file. */
  dir: string;
}

/**
 * Every page under src/app/(app), as a route pattern. Route groups "(x)"
 * contribute no URL segment; "[param]" stays in the pattern so the route reads
 * the way it does in the App Router.
 */
function listAppGroupRoutes(dir: string = APP_DIR, route = ""): AppRoute[] {
  const found: AppRoute[] = [];
  if (PAGE_FILES.some((f) => existsSync(join(dir, f)))) {
    found.push({ route: route === "" ? "/" : route, dir });
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) continue;
    const segment = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
    found.push(...listAppGroupRoutes(join(dir, entry.name), route + segment));
  }
  return found;
}

const ROUTES = listAppGroupRoutes();

/** `export const metadata …` / `export async function generateMetadata …` */
const METADATA_EXPORT =
  /export\s+(?:const\s+metadata\b|(?:async\s+)?function\s+generateMetadata\b)/;

/**
 * The file that owns this route's title: its own page.tsx if that exports
 * metadata, else the nearest ancestor layout.tsx that does. Stops at (app):
 * falling through to the root layout is the bug, not a resolution.
 */
function titleOwner(r: AppRoute): { file: string; source: string } | null {
  // BOTH page extensions, because the walk above enumerates both. Resolving a
  // narrower set than you enumerate is how a guard reads the wrong file and
  // still goes green — a `page.mdx` exporting its own metadata would have been
  // credited to an ancestor layout instead. No .mdx page lives under (app)
  // today; the two lists still have to agree.
  for (const name of PAGE_FILES) {
    const page = join(r.dir, name);
    if (!existsSync(page)) continue;
    const source = readFileSync(page, "utf8");
    if (METADATA_EXPORT.test(source)) return { file: page, source };
  }
  let dir = r.dir;
  for (;;) {
    const layout = join(dir, "layout.tsx");
    if (existsSync(layout)) {
      const source = readFileSync(layout, "utf8");
      if (METADATA_EXPORT.test(source)) return { file: layout, source };
    }
    if (dir === APP_DIR) return null;
    const parent = dir.slice(0, dir.lastIndexOf(sep));
    if (!parent || parent === dir) return null;
    dir = parent;
  }
}

const TITLE_KEY = /(?:^|[\s,{(])title\s*:\s*/;
const HELPER_CALL = /^appPageTitle\(\s*(["'`])(.+?)\1\s*\)/;
const STRING_LITERAL = /^(["'`])(.+?)\1/;

type TitleValue = { kind: "helper"; route: string } | { kind: "literal"; value: string };

/**
 * The title the metadata export sets, parsed as a VALUE rather than as "the
 * rest of the line" — `export const metadata = { title: "X — ProcuLink" };`
 * written on one line is legal and has to resolve, not fail.
 */
function titleValue(source: string): TitleValue | null {
  const start = source.search(METADATA_EXPORT);
  if (start === -1) return null;
  const body = source.slice(start);
  const at = body.search(TITLE_KEY);
  if (at === -1) return null;
  const after = body.slice(at).replace(TITLE_KEY, "");

  const helper = HELPER_CALL.exec(after);
  if (helper) return { kind: "helper", route: helper[2] };
  const literal = STRING_LITERAL.exec(after);
  if (literal) return { kind: "literal", value: literal[2] };
  return null;
}

/** The rendered `<title>` for a route, or an explanation of why it has none. */
function resolveTitle(r: AppRoute): { title: string } | { problem: string } {
  const owner = titleOwner(r);
  if (!owner) {
    return {
      problem:
        "no metadata export in its own page.tsx and none in any ancestor layout.tsx " +
        "— this route inherits the root layout's generic title",
    };
  }
  const value = titleValue(owner.source);
  if (!value) {
    return {
      problem: `${owner.file} exports metadata but sets no title this guard can read (expected a string literal or appPageTitle("<route>"))`,
    };
  }
  if (value.kind === "literal") return { title: value.value };
  if (value.route !== r.route) {
    return {
      problem: `${owner.file} calls appPageTitle("${value.route}") but owns ${r.route} — wrong route, so the tab would name a different page`,
    };
  }
  return { title: appPageTitle(value.route) };
}

describe("every authenticated route names itself in the browser tab", () => {
  // ANTI-VACUITY. A walk that silently matches nothing passes every assertion
  // below it, and this repo has shipped exactly that failure before. 22 routes
  // exist under (app) today; the floor is deliberately just under it so adding
  // a route never has to touch this number, but deleting the corpus fails.
  it("walks the whole (app) route tree", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(20);
    expect(ROUTES.map((r) => r.route)).toContain("/settings");
    expect(ROUTES.map((r) => r.route)).toContain("/library/suppliers/[id]");
  });

  it.each(ROUTES.map((r) => [r.route, r] as const))("%s has a title", (_route, r) => {
    const resolved = resolveTitle(r);
    if ("problem" in resolved) throw new Error(`${r.route}: ${resolved.problem}`);
    expect(resolved.title, `${r.route} title`).not.toBe(GENERIC_TITLE);
    // "<Name> — ProcuLink…": the page is named BEFORE the product, because a
    // tab strip truncates from the right. The tail is loose on purpose — the
    // two admin runbooks qualify it ("… — ProcuLink admin") and are correct to.
    expect(resolved.title, `${r.route} title`).toMatch(/^[^—]+\s+—\s+.*ProcuLink/);
  });

  it("builds every title it owns as '<Name> — ProcuLink'", () => {
    for (const route of Object.keys(APP_PAGE_TITLES)) {
      expect(appPageTitle(route)).toBe(`${APP_PAGE_TITLES[route]}${TITLE_SUFFIX}`);
      expect(appPageTitle(route).endsWith(TITLE_SUFFIX)).toBe(true);
    }
    expect(() => appPageTitle("/not-a-route")).toThrow(/No tab title/);
  });

  it("gives no two routes the same tab title", () => {
    const titles = new Map<string, string>();
    for (const r of ROUTES) {
      const resolved = resolveTitle(r);
      if ("problem" in resolved) continue;
      const clash = titles.get(resolved.title);
      expect(clash, `${r.route} and ${clash} both title themselves "${resolved.title}"`).toBeUndefined();
      titles.set(resolved.title, r.route);
    }
  });
});

// THE MIRROR. src/lib/pageTitles.ts cannot import HUB_TABS — it is read from
// `export const metadata`, which runs in the RSC layer, where a "use client"
// module is a client-reference proxy and its constants read as empty (the build
// error is quoted in that file's header). So the labels are copied, and these
// tests are what makes the copy safe: they run in vitest, where "use client" is
// inert and the real HUB_TABS is importable.
//
// Pinned in BOTH directions on purpose. One direction ("every mirrored entry
// matches its label") lets a NEW tab ship with no title at all; the other
// ("every hub href is mirrored") lets a DELETED tab leave a title behind. A
// one-way mirror guard is how a duplicate list rots in the first place.
describe("tab titles are the words the navigation teaches", () => {
  const hubEntries = Object.entries(
    Object.fromEntries(Object.values(HUB_TABS).flat().map((t) => [t.href, t.label])),
  );

  it("reads a non-empty hub registry", () => {
    expect(hubEntries.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(HUB_TAB_TITLES).length).toBe(hubEntries.length);
  });

  it.each(hubEntries)("%s is mirrored with its tab label", (href, label) => {
    expect(
      HUB_TAB_TITLES[href],
      `HUB_TABS labels ${href} "${label}" — update HUB_TAB_TITLES in src/lib/pageTitles.ts to match`,
    ).toBe(label);
  });

  it("mirrors no href the hub strip no longer has", () => {
    const live = new Set(hubEntries.map(([href]) => href));
    for (const href of Object.keys(HUB_TAB_TITLES)) {
      expect(live.has(href), `HUB_TAB_TITLES still carries ${href}, which HUB_TABS dropped`).toBe(true);
    }
  });

  it("pins a different title only for a route that really has a tab", () => {
    const live = new Set(hubEntries.map(([href]) => href));
    expect(Object.keys(LABEL_PINNED_TO_A_DIFFERENT_TITLE).length).toBeGreaterThan(0);
    for (const [href, title] of Object.entries(LABEL_PINNED_TO_A_DIFFERENT_TITLE)) {
      expect(live.has(href), `${href} is pinned away from a tab label it does not have`).toBe(true);
      // A pin that agrees with the label is not a pin — it is a stale exception
      // that would survive the next rename unnoticed.
      expect(title, `${href} is pinned to the label it already has`).not.toBe(HUB_TAB_TITLES[href]);
      expect(APP_PAGE_TITLES[href]).toBe(title);
    }
  });

  it("hand-writes a title only for a route with no tab to derive one from", () => {
    const live = new Set(hubEntries.map(([href]) => href));
    for (const href of Object.keys(OFF_HUB_TITLES)) {
      expect(live.has(href), `${href} has a hub tab — mirror its label instead of hand-writing one`).toBe(false);
    }
  });
});
