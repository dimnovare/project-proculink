import { describe, it, expect } from "vitest";
import { SECTION_GUIDES, guideSeenKey, matchGuide } from "@/lib/section-guides";

describe("matchGuide", () => {
  it("matches exact static routes", () => {
    expect(matchGuide("/settings")?.route).toBe("/settings");
    expect(matchGuide("/operations/log")?.route).toBe("/operations/log");
  });

  it("ignores trailing slashes and query/hash noise", () => {
    expect(matchGuide("/operations/log/")?.route).toBe("/operations/log");
    expect(matchGuide("/settings?tab=billing")?.route).toBe("/settings");
    expect(matchGuide("/settings#billing")?.route).toBe("/settings");
  });

  it("returns null when no entry matches", () => {
    expect(matchGuide("/")).toBeNull();
    expect(matchGuide("/admin")).toBeNull();
    expect(matchGuide("/operations/log/a")).toBeNull();
    expect(matchGuide("/nonexistent")).toBeNull();
    expect(matchGuide("/library")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchGuide(null)).toBeNull();
    expect(matchGuide(undefined)).toBeNull();
    expect(matchGuide("")).toBeNull();
  });
});

describe("guideSeenKey", () => {
  it("builds the plk-prefixed key from the registry route", () => {
    expect(guideSeenKey("/operations/log")).toBe("plk-guide-seen:/operations/log");
    expect(guideSeenKey("/flows/[flowId]")).toBe("plk-guide-seen:/flows/[flowId]");
  });
});

describe("SECTION_GUIDES registry shape", () => {
  // 18 since FE #130 deleted /operations/webhooks and its guide with it — the
  // page was a duplicate of Settings ▸ Connectors that nothing navigated to.
  // 17 since /operations/connectors went the same way: a read-only page nothing
  // linked to, whose guide described an overview the page could not produce.
  // 10 since plan 13b removed the supplier, buyer, mapping, standards and connection
  // screens (seven guides) with their pages. 8 since the inbound invoice and shipping-notice
  // screens went too. 6 since the Issues and Pipeline health pages went (2026-11-13).
  // 2 since the order screens went the same day: /bridge, /upload's order
  // workbench, /inbox and /inbox/[orderId] took their four guides with them.
  it("has 2 entries with unique routes", () => {
    expect(SECTION_GUIDES).toHaveLength(2);
    const routes = SECTION_GUIDES.map((g) => g.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("every route starts with /", () => {
    for (const g of SECTION_GUIDES) {
      expect(g.route.startsWith("/"), `route ${g.route}`).toBe(true);
    }
  });

  it("every entry has non-empty title, purpose, and firstStep text", () => {
    for (const g of SECTION_GUIDES) {
      expect(g.title.trim().length, `title of ${g.route}`).toBeGreaterThan(0);
      expect(g.purpose.trim().length, `purpose of ${g.route}`).toBeGreaterThan(0);
      expect(g.firstStep.text.trim().length, `firstStep of ${g.route}`).toBeGreaterThan(0);
    }
  });

  it("every entry has 1–5 bullets", () => {
    for (const g of SECTION_GUIDES) {
      expect(g.bullets.length, `bullets of ${g.route}`).toBeGreaterThanOrEqual(1);
      expect(g.bullets.length, `bullets of ${g.route}`).toBeLessThanOrEqual(5);
    }
  });

  it("every href starts with / or ? (in-app routes and tab deep-links only)", () => {
    for (const g of SECTION_GUIDES) {
      const hrefs = [
        ...g.bullets.map((b) => b.href),
        g.firstStep.href,
      ].filter((h): h is string => typeof h === "string");
      for (const href of hrefs) {
        expect(/^[/?]/.test(href), `href "${href}" on ${g.route}`).toBe(true);
      }
    }
  });

  it("articleSlugs, when present, are non-empty kebab-case slugs, unique per entry", () => {
    const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const g of SECTION_GUIDES) {
      if (g.articleSlugs === undefined) continue;
      expect(g.articleSlugs.length, `articleSlugs of ${g.route}`).toBeGreaterThan(0);
      expect(
        new Set(g.articleSlugs).size,
        `duplicate articleSlugs on ${g.route}`,
      ).toBe(g.articleSlugs.length);
      for (const slug of g.articleSlugs) {
        expect(typeof slug, `slug type on ${g.route}`).toBe("string");
        expect(SLUG.test(slug), `slug "${slug}" on ${g.route} is not kebab-case`).toBe(true);
      }
    }
  });

  // HelpSlideover renders guide copy verbatim since the party tokens went
  // (2026-11-13), so a `{token}` left in the registry would reach the screen.
  it("carries no unresolved {token} placeholders", () => {
    for (const g of SECTION_GUIDES) {
      const texts = [g.title, g.purpose, g.firstStep.text, ...g.bullets.map((b) => b.text)];
      for (const text of texts) {
        expect(text).not.toMatch(/\{[^}]+\}/);
      }
    }
  });
});
