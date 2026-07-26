import { existsSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import {
  GUIDES,
  GUIDE_SECTIONS,
  SECTION_BLURB,
  getGuideByPath,
  getGuideBySlug,
  guidesInSection,
  publicGuides,
} from "./guides";
import { HELP_ARTICLES } from "./help-articles";
import { guideMetadata } from "./seo";
import sitemap from "@/app/sitemap";

const REPO_ROOT = join(__dirname, "..", "..");

/**
 * The route file a guide's href implies. Client guides are `page.mdx` under the
 * marketing help tree; admin guides are a gated `page.tsx` with the prose in a
 * sibling `content.mdx`.
 */
function routeFilesFor(href: string): string[] {
  if (href.startsWith("/help/guides/")) {
    const slug = href.replace("/help/guides/", "");
    return [join(REPO_ROOT, "src", "app", "(marketing)", "help", "guides", slug, "page.mdx")];
  }
  const slug = href.replace("/admin/guides/", "");
  return [
    join(REPO_ROOT, "src", "app", "(app)", "admin", "guides", slug, "page.tsx"),
    join(REPO_ROOT, "src", "app", "(app)", "admin", "guides", slug, "content.mdx"),
  ];
}

describe("guide registry", () => {
  it("has unique slugs and hrefs", () => {
    expect(new Set(GUIDES.map((g) => g.slug)).size).toBe(GUIDES.length);
    expect(new Set(GUIDES.map((g) => g.href)).size).toBe(GUIDES.length);
  });

  it("puts every guide's href under the route prefix its audience is served from", () => {
    for (const guide of GUIDES) {
      const prefix = guide.audience === "admin" ? "/admin/guides/" : "/help/guides/";
      expect(guide.href, guide.slug).toBe(`${prefix}${guide.slug}`);
    }
  });

  it("declares a section that the index knows how to render", () => {
    for (const guide of GUIDES) {
      expect(GUIDE_SECTIONS, guide.slug).toContain(guide.section);
      expect(SECTION_BLURB[guide.section]).toBeTruthy();
    }
  });

  it("only marks a guide live when its route files exist", () => {
    for (const guide of GUIDES.filter((g) => g.status === "live")) {
      for (const file of routeFilesFor(guide.href)) {
        expect(existsSync(file), `${guide.slug} → ${file}`).toBe(true);
      }
    }
  });

  it("has no written route left marked planned", () => {
    // A planned guide renders as a non-link row. If someone writes the page but
    // forgets the registry flip, the guide would be invisible — catch it here.
    for (const guide of GUIDES.filter((g) => g.status !== "live")) {
      for (const file of routeFilesFor(guide.href)) {
        expect(existsSync(file), `${guide.slug} → ${file}`).toBe(false);
      }
    }
  });

  it("gives every live guide a read-time estimate", () => {
    for (const guide of GUIDES.filter((g) => g.status === "live")) {
      expect(guide.minutes, guide.slug).toBeGreaterThan(0);
    }
  });

  it("references only help articles that exist", () => {
    const known = new Set(HELP_ARTICLES.map((a) => a.slug));
    for (const guide of GUIDES) {
      for (const slug of guide.related ?? []) {
        expect(known, `${guide.slug} → ${slug}`).toContain(slug);
      }
    }
  });

  it("resolves a pathname to a guide, with or without a trailing slash", () => {
    expect(getGuideByPath("/help/guides/receive-orders-by-email")?.slug).toBe(
      "receive-orders-by-email",
    );
    expect(getGuideByPath("/help/guides/receive-orders-by-email/")?.slug).toBe(
      "receive-orders-by-email",
    );
    expect(getGuideByPath("/admin/guides/onboard-a-new-client")?.audience).toBe("admin");
    expect(getGuideByPath("/help/first-upload")).toBeUndefined();
    expect(getGuideByPath(null)).toBeUndefined();
    expect(getGuideByPath("")).toBeUndefined();
  });

  it("looks a guide up by slug", () => {
    expect(getGuideBySlug("onboard-a-new-client")?.section).toBe("Admin");
    expect(getGuideBySlug("nope")).toBeUndefined();
  });

  it("sorts live guides ahead of planned ones within a section", () => {
    const receive = guidesInSection("Receive orders");
    expect(receive[0].status).toBe("live");
    const statuses = receive.map((g) => g.status);
    expect(statuses.indexOf("planned")).toBeGreaterThan(statuses.lastIndexOf("live"));
  });

  it("excludes admin guides from the public set", () => {
    expect(publicGuides().every((g) => g.audience === "client")).toBe(true);
    expect(publicGuides().map((g) => g.slug)).not.toContain("onboard-a-new-client");
  });
});

describe("guide metadata", () => {
  it("canonicalises to the registry href", () => {
    const meta = guideMetadata({
      slug: "receive-orders-by-email",
      title: "t",
      description: "d",
    });
    expect(meta.alternates?.canonical).toBe("/help/guides/receive-orders-by-email");
    expect(meta.robots).toBeUndefined();
  });

  it("forces noindex on an admin guide", () => {
    const meta = guideMetadata({ slug: "onboard-a-new-client", title: "t", description: "d" });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("refuses an unknown or planned slug", () => {
    expect(() => guideMetadata({ slug: "nope", title: "t", description: "d" })).toThrow(
      /No guide registered/,
    );
    expect(() =>
      guideMetadata({ slug: "receive-orders-over-api", title: "t", description: "d" }),
    ).toThrow(/planned/);
  });
});

describe("sitemap", () => {
  const urls = sitemap().map((entry) => entry.url);

  it("lists the guide index and every live public guide", () => {
    expect(urls).toContain("https://proculink.eu/help/guides");
    expect(urls).toContain("https://proculink.eu/help/guides/receive-orders-by-email");
  });

  it("never lists an admin guide or a planned one", () => {
    expect(urls.some((u) => u.includes("/admin"))).toBe(false);
    expect(urls).not.toContain("https://proculink.eu/help/guides/receive-orders-over-api");
  });
});
