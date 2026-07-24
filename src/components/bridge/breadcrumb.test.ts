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
    expect(looksLikeId("inbox")).toBe(false);
    expect(looksLikeId("suppliers")).toBe(false);
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
    expect(formatCrumbLabel("inbox", 0, ["inbox"])).toBe("Inbox");
    expect(formatCrumbLabel("connections", 0, ["connections"])).toBe("Connections");
    expect(formatCrumbLabel("rules", 1, ["library", "rules"])).toBe("Validation rules");
  });
});

describe("formatCrumbLabel — order detail (the reported bug)", () => {
  const segs = ["inbox", UUID];
  it("uses the PO number from context when available", () => {
    expect(formatCrumbLabel(UUID, 1, segs, { orderPoNumber: "PO-2026-001" })).toBe("PO-2026-001");
  });
  it("falls back to 'Order' + short id — NEVER a bare UUID", () => {
    const label = formatCrumbLabel(UUID, 1, segs, {});
    expect(label).toBe("Order a8c18df7");
    expect(label).not.toBe(UUID);
    expect(label).not.toContain("dec8");
  });
  it("ignores an empty/whitespace PO and falls back", () => {
    expect(formatCrumbLabel(UUID, 1, segs, { orderPoNumber: "  " })).toBe("Order a8c18df7");
  });
  it("resolves under /upload/preview/[orderId] too", () => {
    const previewSegs = ["upload", "preview", UUID];
    expect(formatCrumbLabel(UUID, 2, previewSegs, { orderPoNumber: "PO-9" })).toBe("PO-9");
    expect(formatCrumbLabel(UUID, 2, previewSegs, {})).toBe("Order a8c18df7");
  });
});

describe("formatCrumbLabel — supplier + connection detail", () => {
  it("supplier name from context, else noun + short id", () => {
    const segs = ["library", "suppliers", UUID];
    expect(formatCrumbLabel(UUID, 2, segs, { supplierName: "Acme Tools OÜ" })).toBe("Acme Tools OÜ");
    expect(formatCrumbLabel(UUID, 2, segs, {})).toBe("Supplier a8c18df7");
  });
  it("connection name from context, else noun + short id", () => {
    const segs = ["connections", UUID];
    expect(formatCrumbLabel(UUID, 1, segs, { connectionName: "Directo XML v3" })).toBe("Directo XML v3");
    expect(formatCrumbLabel(UUID, 1, segs, {})).toBe("Connection a8c18df7");
  });
  it("unknown dynamic parent gets a generic noun, never a raw UUID", () => {
    const segs = ["mystery", UUID];
    expect(formatCrumbLabel(UUID, 1, segs, {})).toBe("Item a8c18df7");
  });
});

describe("crumbHref", () => {
  it("builds a cumulative, root-anchored path", () => {
    const segs = ["library", "suppliers", UUID];
    expect(crumbHref(segs, 0)).toBe("/library");
    expect(crumbHref(segs, 1)).toBe("/library/suppliers");
    expect(crumbHref(segs, 2)).toBe(`/library/suppliers/${UUID}`);
  });
});

describe("buildCrumbTrail", () => {
  it("links every crumb except the last (current page has no href)", () => {
    const trail = buildCrumbTrail(`/inbox/${UUID}`, { orderPoNumber: "PO-2026-001" });
    expect(trail).toHaveLength(2);
    expect(trail[0]).toEqual({ label: "Inbox", href: "/inbox" });
    expect(trail[1]).toEqual({ label: "PO-2026-001", href: null });
  });

  it("the inbox crumb is a working link back to /inbox", () => {
    const trail = buildCrumbTrail(`/inbox/${UUID}`, {});
    expect(trail[0].href).toBe("/inbox");
    // current page never a bare UUID
    expect(trail[1].href).toBeNull();
    expect(trail[1].label).toBe("Order a8c18df7");
  });

  it("returns an empty trail for the root path", () => {
    expect(buildCrumbTrail("/", {})).toEqual([]);
  });

  it("handles a three-level supplier detail trail (Library head is unlinked — /library 404s)", () => {
    const trail = buildCrumbTrail(`/library/suppliers/${UUID}`, { supplierName: "Northwind" });
    expect(trail.map((c) => c.label)).toEqual(["Library", "Suppliers", "Northwind"]);
    // "/library" has no index route, so its crumb must NOT link (would 404).
    expect(trail.map((c) => c.href)).toEqual([null, "/library/suppliers", null]);
  });
});

describe("buildCrumbTrail — unlinked group-root heads (no index route → never a 404 link)", () => {
  it("never links the /library group-root crumb", () => {
    const trail = buildCrumbTrail("/library/suppliers", {});
    expect(trail[0]).toEqual({ label: "Library", href: null });
    expect(trail[1]).toEqual({ label: "Suppliers", href: null }); // current page
  });

  it("never links the /operations group-root crumb", () => {
    const trail = buildCrumbTrail("/operations/health", {});
    expect(trail[0]).toEqual({ label: "Operations", href: null });
    expect(trail[1].label).toBe("System health");
  });

  it("never links the /inbound group-root crumb (Workbench head + unlinked Inbound)", () => {
    const trail = buildCrumbTrail("/inbound/invoices", {});
    // Workbench head (context) + Inbound group-root (no index route) + current page.
    expect(trail.map((c) => c.href)).toEqual([null, null, null]);
    expect(trail.map((c) => c.label)).toEqual(["Workbench", "Inbound", "Invoices"]);
  });

  it("no crumb in a hub trail ever points at a group-root 404", () => {
    for (const path of ["/library/suppliers", "/library/mappings", "/operations/exceptions", "/operations/connectors"]) {
      const trail = buildCrumbTrail(path, {});
      expect(trail.some((c) => c.href === "/library")).toBe(false);
      expect(trail.some((c) => c.href === "/operations")).toBe(false);
      expect(trail.some((c) => c.href === "/inbound")).toBe(false);
    }
  });
});

describe("buildCrumbTrail — Workbench group head (v2 nav)", () => {
  it("prefixes /drafts with an UNLINKED Workbench head crumb", () => {
    const trail = buildCrumbTrail("/drafts", {});
    expect(trail).toEqual([
      { label: "Workbench", href: null }, // no /workbench route — context, not a link
      { label: "Drafts", href: null },
    ]);
  });

  it("prefixes /inbound/* with the Workbench head crumb", () => {
    const trail = buildCrumbTrail("/inbound/invoices", {});
    expect(trail.map((c) => c.label)).toEqual(["Workbench", "Inbound", "Invoices"]);
    expect(trail[0].href).toBeNull();
  });

  it("leaves /inbox bare — matches the design captures", () => {
    expect(buildCrumbTrail("/inbox", {})).toEqual([{ label: "Inbox", href: null }]);
  });

  it("leaves Library/Operations trails untouched (already two-level)", () => {
    expect(buildCrumbTrail("/operations/exceptions", {}).map((c) => c.label)).toEqual([
      "Operations",
      "Exceptions",
    ]);
  });
});

// FE-2: a trail of exactly one crumb names the current page and links nowhere.
// The topbar uses this to drop its context row wherever the primary nav row is
// visible — that row already names the page, so the crumb was a second navbar.
describe("isLonePageCrumb", () => {
  it("is true for a top-level page (no ancestor to link to)", () => {
    expect(isLonePageCrumb("/bridge")).toBe(true);
    expect(isLonePageCrumb("/inbox")).toBe(true);
    expect(isLonePageCrumb("/upload")).toBe(true);
    expect(isLonePageCrumb("/settings")).toBe(true);
  });

  it("is false when the trail carries an ancestor crumb", () => {
    // Workbench / Drafts — the head crumb is context the nav row does not show.
    expect(isLonePageCrumb("/drafts")).toBe(false);
    expect(isLonePageCrumb("/library/suppliers")).toBe(false);
    expect(isLonePageCrumb("/operations/exceptions")).toBe(false);
    expect(isLonePageCrumb("/inbox/a8c18df7-dec8-4a1b-9c2d-1f2e3a4b5c6d")).toBe(false);
  });

  it("is false for the root path (no trail at all)", () => {
    expect(isLonePageCrumb("/")).toBe(false);
  });
});
