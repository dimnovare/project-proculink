import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

import nextConfig from "../../next.config";
import { HELP_ARTICLES } from "@/lib/help-articles";
import { GUIDES } from "@/lib/guides";
import { SECTION_GUIDES } from "@/lib/section-guides";
import { ROOT, listAppRoutes, matchesAny, normalizePath, isInternalPageLink } from "./appRoutes";
import { extractLinks, stripComments, syntaxFor } from "./linkExtract";

/**
 * Zero dead links.
 *
 * Every internal link we ship — in a help article, on a marketing page, in the sidebar, in a hub tab
 * bar, in the command palette, in a per-screen guide, on ANY in-app screen — must land on a page
 * that exists, or on a path we deliberately redirect. This crawl reads the links out of the source
 * instead of driving a browser so it runs in CI in seconds and covers every file whether or not a
 * test happens to visit it.
 *
 * ── WHY THIS FILE WAS REWRITTEN ──────────────────────────────────────────────────────────────
 * The first version read only `(marketing)/help/**`, `(marketing)/**`, `(home)/**`,
 * `components/marketing/**` and three nav files, with five naive regexes. Two guaranteed-404 links
 * were planted — `href="/library/templates-that-never-existed"` in a component under
 * `src/components/bridge/`, and `href="/totally-dead-route-xyz"` under
 * `src/app/(app)/library/suppliers/` — and the entire suite stayed green (104 files / 1174 tests).
 * All of `src/app/(app)/**` and every non-marketing component were invisible, and the extractor
 * could not see `href={"/x"}`, `router.replace()` or `redirect()` even where it did look.
 *
 * So the crawl now walks EVERY `.ts` / `.tsx` / `.mdx` under `src/`, and extraction moved to
 * `./linkExtract` (comment stripping, string-literal masking, balanced value regions — see that
 * file for why each one is load-bearing). Both probes are caught; the proof is in PR #47.
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
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...walk(full, test));
    } else if (test(entry)) out.push(full);
  }
  return out;
}

const isTestFile = (f: string) => /\.(test|spec)\.(ts|tsx)$/.test(f);
const isSourceFile = (f: string) => /\.(ts|tsx|mdx)$/.test(f) && !isTestFile(f);

/**
 * Registries whose raw text carries hrefs the UI never renders as links. Reading them raw reports a
 * PHANTOM dead link — a path that ships as inert data, not as something a user can click.
 *
 * `src/lib/guides.ts` is the case: a `status: "planned"` guide is rendered by
 * `GuideIndex.tsx` (GuideRow, `if (guide.status !== "live")`) as a plain `<span>` plus a
 * "Coming soon" badge, never a `<Link>`. Its `href` is a plan. So the file is excluded here and
 * asserted instead through the same filter the component applies — see the dedicated test below,
 * which still checks every guide that DOES render as a link.
 */
const REGISTRY_FILES = ["src/lib/guides.ts"];

/**
 * Every shipped source file, with its links.
 *
 * `src/test/` is excluded: it is the harness, not the product — a fixture path in a test navigates
 * nobody, and this very file names two probe paths.
 */
function crawlableFiles(...dirs: string[]): string[] {
  const testDir = join(ROOT, "src", "test");
  const registries = REGISTRY_FILES.map((f) => join(ROOT, f));
  return dirs
    .flatMap((dir) => walk(dir, isSourceFile))
    .filter((f) => !f.startsWith(testDir))
    .filter((f) => !registries.includes(f));
}

/**
 * A path we can actually check. An href with an interpolated segment (`/help/${article.slug}`) has
 * no value at scan time, so there is nothing to resolve: the slug comes from a registry at runtime.
 *
 * Guessing is worse than skipping in BOTH directions. Requiring the route segment to be dynamic
 * would flag `/help/${article.slug}` — genuinely correct, since every article is its own static
 * page — as a 404. Accepting any single segment would make `/library/suppliers/${id}` "resolve"
 * against anything at all. So computed links are skipped HERE and their registries are asserted
 * exhaustively instead: HELP_ARTICLES, GUIDES and SECTION_GUIDES each get their own test below, and
 * between them they cover every computed href the app builds.
 */
const isVerifiablePath = (href: string) => !href.includes("${");

function linksIn(file: string): Array<{ from: string; href: string }> {
  return extractLinks(readFileSync(file, "utf8"), syntaxFor(file)).map((href) => ({
    from: relative(ROOT, file).split("\\").join("/"),
    href,
  }));
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
    if (!isVerifiablePath(href)) continue;
    if (!(await resolves(href))) dead.push(`${from} → ${href}`);
  }
  expect(dead, `dead internal links (would 404):\n  ${dead.join("\n  ")}`).toEqual([]);
}

describe("link crawl — nothing we ship points at a 404", () => {
  it("every source file under src/ links only to live pages", async () => {
    const files = crawlableFiles(join(ROOT, "src"));
    // Floors, so a broken walker or a bad filter cannot pass this vacuously. The first version of
    // this gate read 40-odd files; anything near that number means the widening was undone.
    expect(files.length).toBeGreaterThan(250);

    const entries = files.flatMap(linksIn);
    expect(entries.length).toBeGreaterThan(300);

    // The widening is only real if the previously-invisible trees are genuinely in the set.
    const scanned = new Set(files.map((f) => relative(ROOT, f).split("\\").join("/")));
    expect([...scanned].some((f) => f.startsWith("src/app/(app)/"))).toBe(true);
    expect([...scanned].some((f) => f.startsWith("src/components/bridge/"))).toBe(true);

    await assertAllResolve(entries);
  });

  it("help centre articles link only to live pages", async () => {
    const files = crawlableFiles(join(ROOT, "src", "app", "(marketing)", "help"));
    expect(files.length).toBeGreaterThan(30); // the crawl is actually reading the articles

    const entries = files.flatMap(linksIn);
    expect(entries.length).toBeGreaterThan(50);
    await assertAllResolve(entries);
  });

  it("every registered help article has a page", async () => {
    // This is what covers `/help/${article.slug}`, the computed href the sweep above skips: the
    // index renders EVERY registry entry as a link, so the registry IS the link list.
    const dead: string[] = [];
    for (const article of HELP_ARTICLES) {
      if (!(await resolves(`/help/${article.slug}`))) dead.push(article.slug);
    }
    expect(dead, `help-articles.ts lists slugs with no page: ${dead.join(", ")}`).toEqual([]);
  });

  it("every guide that renders as a link points at a page that exists", async () => {
    // The registry rule for src/lib/guides.ts. GuideIndex renders a `status: "planned"` guide as a
    // <span> + "Coming soon" badge, never a <Link>, so its href is a plan and not a dead link. Every
    // LIVE guide, though, IS a link on the index — and must resolve.
    const live = GUIDES.filter((g) => g.status === "live");
    expect(live.length).toBeGreaterThan(5); // the filter has not swallowed the registry

    const dead: string[] = [];
    for (const guide of live) {
      if (!(await resolves(guide.href))) dead.push(`${guide.slug} → ${guide.href}`);
    }
    expect(dead, `live guides with no page:\n  ${dead.join("\n  ")}`).toEqual([]);

    // …and the planned ones are still recorded as planned, so this test cannot quietly become
    // vacuous by everything flipping to "live" or the field disappearing.
    expect(GUIDES.some((g) => g.status === "planned")).toBe(true);
  });

  it("in-app navigation links only to live pages", async () => {
    // Still called out separately from the src/ sweep above: these three files are what puts a path
    // in front of a user on every screen, so a dead link in one of them is a different severity —
    // and a floor here catches a nav registry that silently stopped being parsed.
    const NAV_SOURCES = [
      "src/components/bridge/BridgeSidebar.tsx",
      "src/components/bridge/layout/HubTabs.tsx",
      "src/components/bridge/CommandPalette.tsx",
    ];
    const entries = NAV_SOURCES.flatMap((file) => linksIn(join(ROOT, file)));
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

describe("link extraction — the decisions that make the crawl able to fail", () => {
  const ex = (text: string, syntax?: "js" | "mdx") => extractLinks(text, syntax);

  it("sees the shapes the old regexes could not", () => {
    // href={"/x"} — a braced literal. The old pattern required a quote IMMEDIATELY after `href=`.
    expect(ex(`<Link href={"/pricing"}>P</Link>`)).toContain("/pricing");
    // A ternary yields BOTH branches.
    expect(ex(`<Link href={ok ? "/bridge" : "/sign-in"}>x</Link>`)).toEqual(
      expect.arrayContaining(["/bridge", "/sign-in"]),
    );
    // router.replace / redirect — navigations the user never clicks, and both were invisible.
    expect(ex(`router.replace("/inbox")`)).toContain("/inbox");
    expect(ex(`redirect("/operations/health")`)).toContain("/operations/health");
    // The footer's [label, href] tuple registry: there is no literal href= for these anywhere.
    expect(ex(`{ links: [["Pricing", "/pricing"]] }`)).toContain("/pricing");
    // Markdown, in an MDX article.
    expect(ex(`See the [inbox guide](/help/inbox-basics).`, "mdx")).toContain("/help/inbox-basics");
  });

  it("does not invent links out of comments, selectors or siblings", () => {
    // A link in a comment navigates nobody — crawling it would blame a file for a 404 it cannot
    // cause, and (in the reachability direction) let a comment fake a live target.
    expect(ex(`// <Link href="/orphan-line">x</Link>`)).toEqual([]);
    expect(ex(`/* <Link href="/orphan-block">x</Link> */`)).toEqual([]);
    expect(ex(`/**\n * href="/orphan-jsdoc" is prose\n */`)).toEqual([]);
    // …but a "//" inside a string literal is data, and must not eat the rest of the line.
    expect(ex(`const d = "https://example.com/x"; <Link href="/real">R</Link>`)).toContain("/real");
    // …nor may a regex literal containing an escaped slash pair.
    expect(ex(`const re = /\\/\\//g; <Link href="/real-2">R</Link>`)).toContain("/real-2");
    // An anchor-shaped substring INSIDE a literal is data, not code.
    expect(ex(`document.querySelector('a[href="/not-a-link"]')`)).toEqual([]);
    // One value region is ONE literal — the next JSX attribute and the sibling object key stay out.
    expect(ex(`<a href="/a" title="/b">x</a>`)).toEqual(["/a"]);
    expect(ex(`{ href: "/a", other: "/b" }`)).toEqual(["/a"]);
    // A bare path array (src/app/sitemap.ts) is a crawler hint, not navigation.
    expect(ex(`const routes = ["/", "/pricing", "/formats"];`)).toEqual([]);
  });

  it("strips MDX comments without eating help-centre prose", () => {
    expect(ex(`{/* [old](/orphan-mdx) */}`, "mdx")).toEqual([]);
    expect(ex(`<!-- [old](/orphan-html) -->`, "mdx")).toEqual([]);
    // "//" is prose in MDX — the JS stripper would delete the rest of this line.
    expect(ex(`Use sftp://host/path. See [the guide](/help/inbox-basics).`, "mdx")).toEqual([
      "/help/inbox-basics",
    ]);
    // And the MDX stripper must not be applied to JS.
    expect(stripComments(`// gone\nkept`, "js").trim()).toBe("kept");
    expect(stripComments(`// kept\nkept`, "mdx")).toContain("// kept");
  });
});
