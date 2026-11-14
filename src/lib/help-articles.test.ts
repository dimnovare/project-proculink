import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { describe, it, expect } from "vitest";
import { RETIRED_ROUTES } from "@/lib/retired-routes";
import { publicGuides } from "@/lib/guides";
import { extractLinks, syntaxFor } from "@/test/linkExtract";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  HELP_ARTICLES,
  POPULAR_ARTICLE_SLUGS,
  getAdjacentArticles,
  getArticleBySlug,
  resolveArticles,
} from "@/lib/help-articles";

describe("HELP_ARTICLES registry shape", () => {
  it("has unique slugs", () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("no longer contains the deleted delivery-config article", () => {
    expect(getArticleBySlug("delivery-config")).toBeUndefined();
  });

  it("every article has a category with meta, a positive readMin, and keywords", () => {
    for (const a of HELP_ARTICLES) {
      expect(CATEGORY_ORDER, `category of ${a.slug}`).toContain(a.category);
      expect(CATEGORY_META[a.category], `meta for ${a.category}`).toBeDefined();
      expect(a.readMin, `readMin of ${a.slug}`).toBeGreaterThan(0);
      expect(a.keywords.length, `keywords of ${a.slug}`).toBeGreaterThan(0);
      for (const k of a.keywords) {
        expect(k.trim().length, `keyword "${k}" on ${a.slug}`).toBeGreaterThan(0);
      }
    }
  });

  it("array order follows the category learning path", () => {
    // Registry order drives the prev/next pager; categories must appear in
    // CATEGORY_ORDER sequence (articles of the same category stay adjacent).
    const indices = HELP_ARTICLES.map((a) => CATEGORY_ORDER.indexOf(a.category));
    for (let i = 1; i < indices.length; i++) {
      expect(
        indices[i],
        `${HELP_ARTICLES[i].slug} is out of learning-path order`,
      ).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });

  it("Account soft tint does not duplicate Getting started", () => {
    expect(CATEGORY_META.Account.soft).not.toBe(CATEGORY_META["Getting started"].soft);
  });
});

describe("resolveArticles", () => {
  it("resolves known slugs in order", () => {
    const out = resolveArticles(["lookups", "billing-faq"]);
    expect(out.map((a) => a.slug)).toEqual(["lookups", "billing-faq"]);
  });

  it("silently skips slugs without a published article", () => {
    const out = resolveArticles(["not-written-yet", "lookups", "another-future-article"]);
    expect(out.map((a) => a.slug)).toEqual(["lookups"]);
  });

  it("caps at max AFTER skipping unknowns (forward-compatible curation)", () => {
    const out = resolveArticles(
      ["not-written-yet", "lookups", "destinations", "billing-faq", "troubleshooting"],
      3,
    );
    expect(out.map((a) => a.slug)).toEqual(["lookups", "destinations", "billing-faq"]);
  });

  it("returns [] for undefined or empty input", () => {
    expect(resolveArticles(undefined)).toEqual([]);
    expect(resolveArticles([])).toEqual([]);
  });

  it("popular curation resolves to at least 3 published articles", () => {
    // The slideover's no-guide fallback shows the top 3; the curated list may
    // name unwritten articles, but at least 3 must already be real.
    expect(resolveArticles(POPULAR_ARTICLE_SLUGS, 3)).toHaveLength(3);
  });
});

describe("getAdjacentArticles", () => {
  it("first article has no prev, last has no next", () => {
    const first = HELP_ARTICLES[0];
    const last = HELP_ARTICLES[HELP_ARTICLES.length - 1];
    expect(getAdjacentArticles(first.slug).prev).toBeUndefined();
    expect(getAdjacentArticles(last.slug).next).toBeUndefined();
  });

  it("returns {} for an unknown slug", () => {
    expect(getAdjacentArticles("nope")).toEqual({});
  });
});

describe("per-tool video wiring (offer⇔works)", () => {
  const TOOL_VIDEO_PREFIX = "https://assets.proculink.eu/marketing/tools/";
  const withVideo = HELP_ARTICLES.filter((a) => a.videoUrl);

  it("every videoUrl is a hosted assets.proculink.eu/marketing/tools/ mp4", () => {
    for (const a of withVideo) {
      expect(
        a.videoUrl!.startsWith(TOOL_VIDEO_PREFIX),
        `${a.slug} videoUrl must start with ${TOOL_VIDEO_PREFIX}`,
      ).toBe(true);
      expect(a.videoUrl!.endsWith(".mp4"), `${a.slug} videoUrl must end with .mp4`).toBe(true);
    }
  });

  it("every videoUrl also carries a poster on the same host", () => {
    for (const a of withVideo) {
      expect(a.videoPosterUrl, `${a.slug} must carry a poster`).toBeTruthy();
      expect(a.videoPosterUrl!.startsWith(TOOL_VIDEO_PREFIX)).toBe(true);
    }
  });

  it("no two articles share a videoUrl (one article = at most one video)", () => {
    const urls = withVideo.map((a) => a.videoUrl!);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

// ── Help structure (plan 12b) ────────────────────────────────────────────────

const ROOT = process.cwd();
const HELP_DIR = join(ROOT, "src", "app", "(marketing)", "help");

/** Subdirectories of `dir` that hold a page.mdx — i.e. the slugs actually served. */
const slugsOnDisk = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "page.mdx")))
    .map((e) => e.name)
    .sort();

const articlePaths = HELP_ARTICLES.map((a) => `/help/${a.slug}`);
const guidePaths = publicGuides().map((g) => g.href);
const registeredPaths = new Set(["/help", "/help/guides", ...articlePaths, ...guidePaths]);

// Slugs of the registries as they stood on origin/main before the relaunch rewrite (slugs only,
// admin runbooks excluded: they are served from /admin/guides and did not move).
const OLD_ARTICLE_SLUGS = [
  "order-intake-options", "inbound-mode", "dashboard-and-statuses", "inbox-basics",
  "csv-xlsx-field-guide", "connections", "managing-suppliers", "mapping-basics", "item-codes",
  "catalog-csv-field-guide", "output-mapping-editor", "validation-rules", "delivery-setup",
  "output-templates", "cxml-setup", "oauth2-delivery-setup", "sftp-ftps-delivery-keys",
  "erp-erply-and-directo", "api-and-integrations", "api-order-schema-reference",
  "sftp-polling-setup", "s3-polling-setup", "imap-provider-setup", "x12-850", "edifact-orders",
  "sap-idoc-orders05", "ubl-and-peppol", "ai-suggestions", "billing-faq", "troubleshooting",
  "exceptions-and-stuck-orders",
];
const OLD_GUIDE_SLUGS = [
  "set-up-your-workspace", "first-order-end-to-end", "upload-orders-manually",
  "receive-orders-by-email", "poll-a-mailbox-over-imap", "receive-orders-over-api",
  "receive-orders-by-sftp", "receive-orders-from-s3", "add-a-supplier",
  "import-a-supplier-catalog", "keep-a-catalog-in-sync", "review-an-order", "resolve-item-codes",
  "map-supplier-po-fields", "automate-delivery", "set-up-supplier-delivery",
];

describe("help structure", () => {
  it("has a page for every registered article and guide, and no page without an entry", () => {
    expect(slugsOnDisk(HELP_DIR).filter((s) => s !== "guides")).toEqual(
      HELP_ARTICLES.map((a) => a.slug).sort(),
    );
    expect(slugsOnDisk(join(HELP_DIR, "guides"))).toEqual(
      publicGuides().filter((g) => g.status === "live").map((g) => g.slug).sort(),
    );
  });

  it("keeps every old slug alive: still registered, or a 308 to a registered page", () => {
    const old = [
      ...OLD_ARTICLE_SLUGS.map((s) => `/help/${s}`),
      ...OLD_GUIDE_SLUGS.map((s) => `/help/guides/${s}`),
    ];
    for (const path of old) {
      const redirect = RETIRED_ROUTES.find((r) => r.source === path);
      const target = redirect ? redirect.destination : path;
      expect(registeredPaths, `${path} -> ${target}`).toContain(target);
    }
  });

  it("points every in-app /help link at a registered page or a redirect", () => {
    const retired = new Set(RETIRED_ROUTES.map((r) => r.source));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return e.name === "test" || e.name === "node_modules" ? [] : walk(full);
        return /\.(ts|tsx|mdx)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
      });
    const dead: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const links = extractLinks(readFileSync(file, "utf8"), syntaxFor(file));
      for (const href of links) {
        const path = href.split(/[?#]/)[0].replace(/\/$/, "");
        if (!/^\/help(\/|$)/.test(path) || path.includes("${")) continue;
        if (!registeredPaths.has(path) && !retired.has(path)) {
          dead.push(`${relative(ROOT, file)} -> ${href}`);
        }
      }
    }
    expect(dead).toEqual([]);
  }, 60_000);
});
