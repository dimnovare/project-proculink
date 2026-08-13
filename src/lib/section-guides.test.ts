import { describe, it, expect } from "vitest";
import {
  SECTION_GUIDES,
  guideSeenKey,
  matchGuide,
  resolveGuideText,
  type GuidePartyLabels,
} from "@/lib/section-guides";

// Mirrors partyLabels() in useOrderDirection (structural slice only, so the
// test does not import the 'use client' hook module and its api-client deps).
const OUTBOUND: GuidePartyLabels = {
  counterpartyNoun: "Supplier",
  counterpartyPlural: "Suppliers",
};
const INBOUND: GuidePartyLabels = {
  counterpartyNoun: "Customer",
  counterpartyPlural: "Customers",
};

describe("matchGuide", () => {
  it("matches exact static routes", () => {
    expect(matchGuide("/bridge")?.route).toBe("/bridge");
    expect(matchGuide("/settings")?.route).toBe("/settings");
    expect(matchGuide("/library/standards")?.route).toBe("/library/standards");
    expect(matchGuide("/operations/exceptions")?.route).toBe("/operations/exceptions");
  });

  it("ignores trailing slashes and query/hash noise", () => {
    expect(matchGuide("/inbox/")?.route).toBe("/inbox");
    expect(matchGuide("/settings?tab=billing")?.route).toBe("/settings");
    expect(matchGuide("/upload#zone")?.route).toBe("/upload");
  });

  it("matches dynamic segments against any single non-empty segment", () => {
    expect(matchGuide("/inbox/3f2b1a90-0c4d-4e5f-9a1b-2c3d4e5f6a7b")?.route).toBe(
      "/inbox/[orderId]",
    );
    expect(matchGuide("/library/suppliers/8d2e77aa-1111-2222-3333-444455556666")?.route).toBe(
      "/library/suppliers/[id]",
    );
    expect(matchGuide("/connections/abc-123")?.route).toBe(
      "/connections/[connectionId]",
    );
  });

  it("disambiguates /inbox from /inbox/[orderId]", () => {
    expect(matchGuide("/inbox")?.route).toBe("/inbox");
    expect(matchGuide("/inbox")?.title).toBe("Inbox");
    expect(matchGuide("/inbox/008412")?.route).toBe("/inbox/[orderId]");
    expect(matchGuide("/inbox/008412")?.title).toBe("Order review");
  });

  it("disambiguates /library/suppliers from /library/suppliers/[id]", () => {
    expect(matchGuide("/library/suppliers")?.route).toBe("/library/suppliers");
    expect(matchGuide("/library/suppliers/abc")?.route).toBe("/library/suppliers/[id]");
  });

  it("returns null when no entry matches", () => {
    expect(matchGuide("/")).toBeNull();
    expect(matchGuide("/admin")).toBeNull();
    expect(matchGuide("/inbox/a/b")).toBeNull();
    expect(matchGuide("/nonexistent")).toBeNull();
    expect(matchGuide("/library")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchGuide(null)).toBeNull();
    expect(matchGuide(undefined)).toBeNull();
    expect(matchGuide("")).toBeNull();
  });
});

describe("resolveGuideText", () => {
  it("resolves all four token casings (outbound)", () => {
    expect(resolveGuideText("{supplier}", OUTBOUND)).toBe("supplier");
    expect(resolveGuideText("{suppliers}", OUTBOUND)).toBe("suppliers");
    expect(resolveGuideText("{Supplier}", OUTBOUND)).toBe("Supplier");
    expect(resolveGuideText("{Suppliers}", OUTBOUND)).toBe("Suppliers");
  });

  it("resolves all four token casings (inbound → customer)", () => {
    expect(resolveGuideText("{supplier}", INBOUND)).toBe("customer");
    expect(resolveGuideText("{suppliers}", INBOUND)).toBe("customers");
    expect(resolveGuideText("{Supplier}", INBOUND)).toBe("Customer");
    expect(resolveGuideText("{Suppliers}", INBOUND)).toBe("Customers");
  });

  it("resolves mixed tokens inside a sentence", () => {
    expect(
      resolveGuideText(
        "{Suppliers}: add a {supplier}, then track each {supplier}'s {suppliers}.",
        INBOUND,
      ),
    ).toBe("Customers: add a customer, then track each customer's customers.");
  });

  it("leaves text without tokens unchanged", () => {
    const plain = "Filter by Needs review, Ready to send, Delivered, or Failed";
    expect(resolveGuideText(plain, OUTBOUND)).toBe(plain);
    expect(resolveGuideText(plain, INBOUND)).toBe(plain);
  });
});

describe("guideSeenKey", () => {
  it("builds the plk-prefixed key from the registry route", () => {
    expect(guideSeenKey("/inbox")).toBe("plk-guide-seen:/inbox");
    expect(guideSeenKey("/inbox/[orderId]")).toBe("plk-guide-seen:/inbox/[orderId]");
  });
});

describe("SECTION_GUIDES registry shape", () => {
  // 18 since FE #130 deleted /operations/webhooks and its guide with it — the
  // page was a duplicate of Settings ▸ Connectors that nothing navigated to.
  // 17 since /operations/connectors went the same way: a read-only page nothing
  // linked to, whose guide described an overview the page could not produce.
  it("has 17 entries with unique routes", () => {
    expect(SECTION_GUIDES).toHaveLength(17);
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

  it("honestly-unavailable screens carry no related articles", () => {
    // /inbound/asns documents an unavailable feature — linking articles from it
    // would violate offer⇔works. (/drafts used to be the other one; the screen
    // itself was retired rather than kept as a permanently empty list.)
    for (const route of ["/inbound/asns"]) {
      const g = SECTION_GUIDES.find((e) => e.route === route);
      expect(g, route).toBeDefined();
      expect(g?.articleSlugs, `articleSlugs of ${route}`).toBeUndefined();
    }
  });

  it("uses only the four known party tokens", () => {
    const KNOWN = new Set(["supplier", "suppliers", "Supplier", "Suppliers"]);
    for (const g of SECTION_GUIDES) {
      const texts = [
        g.title,
        g.purpose,
        g.firstStep.text,
        ...g.bullets.map((b) => b.text),
      ];
      for (const text of texts) {
        for (const m of text.matchAll(/\{([^}]+)\}/g)) {
          expect(KNOWN.has(m[1]), `token {${m[1]}} on ${g.route}`).toBe(true);
        }
      }
    }
  });

  it("resolves every entry's copy without leaving unreplaced tokens", () => {
    for (const g of SECTION_GUIDES) {
      const texts = [g.title, g.purpose, g.firstStep.text, ...g.bullets.map((b) => b.text)];
      for (const text of texts) {
        expect(resolveGuideText(text, INBOUND)).not.toMatch(/\{[^}]+\}/);
      }
    }
  });
});
