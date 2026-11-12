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
    expect(matchGuide("/operations/log")?.route).toBe("/operations/log");
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
  });

  it("disambiguates /inbox from /inbox/[orderId]", () => {
    expect(matchGuide("/inbox")?.route).toBe("/inbox");
    expect(matchGuide("/inbox")?.title).toBe("Inbox");
    expect(matchGuide("/inbox/008412")?.route).toBe("/inbox/[orderId]");
    expect(matchGuide("/inbox/008412")?.title).toBe("Order review");
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
  // 10 since plan 13b removed the supplier, buyer, mapping, standards and connection
  // screens (seven guides) with their pages. 8 since the inbound invoice and shipping-notice
  // screens went too.
  it("has 8 entries with unique routes", () => {
    expect(SECTION_GUIDES).toHaveLength(8);
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

  // The dashboard CSV bullet used to read "it covers your most recent 100
  // orders". That 100 was a literal hand-copied from `pageSize: 100` in
  // BridgeDashboard — a second copy of a number, in a file that cannot see the
  // first one change. It was also simply wrong: the export writes the orders in
  // the SELECTED time window, so with the window on "Today" the file can hold
  // twelve rows. The exported CSV already states its own exact count on its
  // first line, derived at write time; this sentence must not compete with it.
  it("the dashboard CSV bullet promises no count of its own", () => {
    const dashboard = SECTION_GUIDES.find((g) => g.route === "/bridge");
    expect(dashboard, "/bridge guide").toBeDefined();

    // ANTI-VACUITY FLOOR: the bullet still exists and still describes the
    // export. Deleting it would pass every assertion below for free.
    const csv = dashboard?.bullets.filter((b) => /\bCSV\b/.test(b.text)) ?? [];
    expect(csv, "the CSV export bullet").toHaveLength(1);
    expect(csv[0].text).toMatch(/export/i);

    // No digits: any number here is a copy of a value this file cannot read.
    expect(csv[0].text).not.toMatch(/\d/);
    // …and it says what actually bounds the file, which is the window.
    expect(csv[0].text).toMatch(/time window/i);
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
