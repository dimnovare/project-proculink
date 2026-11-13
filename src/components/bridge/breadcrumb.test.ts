// breadcrumb unit tests — covers the pure crumb label/href helpers.
// Founder-reported bug: the order-detail crumb showed a raw, truncated UUID and
// was not a link. These tests pin the two fixes:
//   • a readable label resolves from cached data (PO/supplier/connection name),
//     and falls back to a noun + short id — never a bare full UUID;
//   • every crumb except the current page links to its cumulative path.

import { describe, it, expect } from "vitest";
import {
  formatCrumbLabel,
  crumbHref,
  buildCrumbTrail,
  isLonePageCrumb,
  looksLikeId,
  shortId,
  truncateLabel,
  titleCaseSegment,
} from "./breadcrumb";

const UUID = "a8c18df7-dec8-4a1b-9c2d-1f2e3a4b5c6d";

describe("looksLikeId", () => {
  it("treats a UUID as an id", () => {
    expect(looksLikeId(UUID)).toBe(true);
  });
  it("treats a long opaque token as an id", () => {
    expect(looksLikeId("008412abcd99")).toBe(true);
  });
  it("does not treat a known static segment as an id", () => {
    expect(looksLikeId("flows")).toBe(false);
    expect(looksLikeId("lookups")).toBe(false);
  });
  it("does not treat a short slug as an id", () => {
    expect(looksLikeId("preview")).toBe(false);
  });
});

describe("shortId", () => {
  it("keeps the first hyphen group unchanged when it is <= 8 chars", () => {
    // UUID first group is exactly 8 hex chars — recognisable, no ellipsis needed.
    expect(shortId(UUID)).toBe("a8c18df7");
  });
  it("ellipsises a long first group", () => {
    expect(shortId("0123456789abcdef-tail")).toBe("01234567…");
  });
  it("returns short tokens unchanged", () => {
    expect(shortId("abc123")).toBe("abc123");
  });
});

describe("truncateLabel", () => {
  it("leaves short labels intact", () => {
    expect(truncateLabel("PO-2026-001")).toBe("PO-2026-001");
  });
  it("ellipsises overly long labels", () => {
    const long = "A very long connection name that should not fit in the bar";
    const out = truncateLabel(long, 28);
    expect(out.length).toBeLessThanOrEqual(28);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("titleCaseSegment", () => {
  it("title-cases a slug", () => {
    expect(titleCaseSegment("order-detail")).toBe("Order Detail");
  });
});

describe("formatCrumbLabel — static segments", () => {
  it("maps known segments to their vocabulary label", () => {
    expect(formatCrumbLabel("operations", 0, ["operations"])).toBe("Activity");
    expect(formatCrumbLabel("log", 1, ["operations", "log"])).toBe("Deliveries");
  });
});

describe("formatCrumbLabel — guide slugs", () => {
  const segs = ["admin", "guides", "onboard-a-new-client"];

  it("uses the guide's real title instead of treating the slug as an id", () => {
    expect(formatCrumbLabel("onboard-a-new-client", 2, segs)).toBe(
      "Onboard a new client end-to-end",
    );
  });

  it("falls back to the normal rules for an unregistered slug under /guides", () => {
    expect(formatCrumbLabel("not-a-guide", 2, ["admin", "guides", "not-a-guide"])).toBe(
      "Not A Guide",
    );
  });

  it("only claims the segment when /guides is its immediate parent", () => {
    // Same slug elsewhere in the tree keeps the generic id handling, which is
    // what produced "Item onboard" before the registry lookup was added.
    expect(formatCrumbLabel("onboard-a-new-client", 1, ["flows", "onboard-a-new-client"])).toBe(
      "Flow onboard",
    );
  });
});

describe("formatCrumbLabel — dynamic segments", () => {
  it("unknown dynamic parent gets a generic noun, never a raw UUID", () => {
    const segs = ["mystery", UUID];
    expect(formatCrumbLabel(UUID, 1, segs, {})).toBe("Item a8c18df7");
  });
});

describe("crumbHref", () => {
  it("builds a cumulative, root-anchored path", () => {
    const segs = ["lookups", UUID];
    expect(crumbHref(segs, 0)).toBe("/lookups");
    expect(crumbHref(segs, 1)).toBe(`/lookups/${UUID}`);
  });
});

describe("buildCrumbTrail", () => {
  it("links every crumb except the last (current page has no href)", () => {
    const trail = buildCrumbTrail(`/lookups/${UUID}`, { lookupName: "Item codes" });
    expect(trail).toEqual([
      { label: "Lookups", href: "/lookups" },
      { label: "Item codes", href: null },
    ]);
  });

  it("returns an empty trail for the root path", () => {
    expect(buildCrumbTrail("/", {})).toEqual([]);
  });

  it("drops the page-less /operations group root (the nav already names it)", () => {
    expect(buildCrumbTrail("/operations/log", {})).toEqual([{ label: "Deliveries", href: null }]);
  });
});

// FE-2: a trail of exactly one crumb names the current page and links nowhere.
// The topbar uses this to drop its context row wherever the primary nav row is
// visible — that row already names the page, so the crumb was a second navbar.
describe("isLonePageCrumb", () => {
  it("is true for a top-level page (no ancestor to link to)", () => {
    expect(isLonePageCrumb("/documents")).toBe(true);
    expect(isLonePageCrumb("/upload")).toBe(true);
    expect(isLonePageCrumb("/operations/log")).toBe(true);
    expect(isLonePageCrumb("/settings")).toBe(true);
  });

  it("is false when the trail carries an ancestor crumb", () => {
    expect(isLonePageCrumb("/lookups/a8c18df7-dec8-4a1b-9c2d-1f2e3a4b5c6d")).toBe(false);
  });

  it("is false for the root path (no trail at all)", () => {
    expect(isLonePageCrumb("/")).toBe(false);
  });
});

describe("flow document trail", () => {
  const f = "fba42463-1111-4a1b-9c2d-1f2e3a4b5c6d";
  const d = "af13dd5e-2222-4a1b-9c2d-1f2e3a4b5c6d";
  it("names the flow and file, and never links the page-less documents crumb", () => {
    const trail = buildCrumbTrail(`/flows/${f}/documents/${d}`, { flowName: "Invoices", documentName: "june.pdf" });
    expect(trail.map((c) => c.label)).toEqual(["Flows", "Invoices", "Documents", "june.pdf"]);
    expect(trail[2].href).toBeNull();
    expect(buildCrumbTrail(`/flows/${f}/documents/${d}`).map((c) => c.label).slice(1)).toEqual([
      "Flow fba42463", "Documents", "Document af13dd5e",
    ]);
    const adv = buildCrumbTrail(`/flows/${f}/outputs/${d}/advanced`, { flowName: "Invoices", outputName: "Invoices CSV" });
    expect(adv.map((c) => c.label)).toEqual(["Flows", "Invoices", "Outputs", "Invoices CSV", "Advanced view"]);
    expect(adv.map((c) => c.href).slice(2)).toEqual([null, null, null]);
    expect(buildCrumbTrail(`/lookups/${f}`, { lookupName: "Item codes" }).map((c) => c.label)).toEqual(["Lookups", "Item codes"]);
    expect(buildCrumbTrail(`/lookups/${f}`).map((c) => c.label)[1]).toBe("Lookup fba42463");
  });
});
