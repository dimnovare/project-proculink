import { describe, it, expect } from "vitest";
import type { DocumentDetail } from "@/lib/api/documents";
import { editKey, reviewMarks } from "./reviewMarks";

const loc = (page: number) => ({ page, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, address: null });
const f = (key: string, value: string | null, confidence: number, extra = {}) =>
  ({ key, label: key, value, type: "text", meaning: null, confidence, location: loc(37), notOnPage: false, listed: true, edited: false, ...extra });
const fail = (code: string, fieldKey: string | null, message = "m") => ({ code, passed: false, fieldKey, message });
const detail = (fields: unknown[], checks: unknown[], cells: number[] = []) => ({
  summary: { id: "d", status: "needs_review" }, contentType: "application/pdf",
  read: { kindLabel: null, truncated: false, fields, tables: [{ key: "lines", label: "Lines", listed: true, columns: [{ key: "qty", label: "Qty", type: "number", meaning: null }],
    rows: cells.map((c) => ({ cells: { qty: { value: "1", confidence: c, location: null, notOnPage: false, edited: false } } })) }] },
  checks,
}) as unknown as DocumentDetail;

describe("reviewMarks", () => {
  it("marks what needs a look, in words, and nothing it cannot know", () => {
    const m = reviewMarks(detail([
      f("date", "2026-05-20", 0.72), f("supplier", null, 0), f("vat", null, 0), f("total", "12", 0.5, { edited: true }),
      f("po", "A-1", 0.61), f("ref", "R", 0), f("currency", "EUR", 0.97), f("issuer", "Example Ltd", 0.95),
    ], [fail("low_confidence", "date"), fail("required_missing", "supplier"), fail("type_invalid", "total", "total is not number we can read."),
        fail("arithmetic_mismatch", "lines"), fail("duplicate", null), fail("custom", "gone"), fail("not_on_page", "issuer")], [0.97, 0.5]), true);
    expect(m.looks.get(editKey({ field: "date" }))).toEqual({ kind: "unsure", text: "Check this one. We are 72% sure of it." });
    expect(m.looks.get(editKey({ field: "supplier" }))).toEqual({ kind: "missing", text: "Not found on the page. Type it." });
    expect(m.looks.get(editKey({ field: "issuer" }))).toEqual({ kind: "unsure", text: "Not in the page's text. Check it." }); // e.g. read from a logo
    expect(m.looks.has(editKey({ field: "vat" }))).toBe(false);                                   // empty, no check: no mark, no number
    expect(m.looks.get(editKey({ field: "total" }))?.text).toBe("Check this one. total is not number we can read."); // edited, but a check names it
    expect(m.looks.get(editKey({ field: "po" }))?.text).toBe("Check this one. We are 61% sure of it.");  // below 0.75 with no check
    expect(m.looks.get(editKey({ field: "ref" }))?.text).toBe("Check this one. We couldn't read it clearly."); // never "0%"
    expect(m.looks.has(editKey({ field: "currency" }))).toBe(false);
    expect(m.looks.get(editKey({ table: "lines", row: 1, column: "qty" }))?.text).toBe("Check this one. We are 50% sure of it.");
    expect(m.looks.has(editKey({ table: "lines", row: 0, column: "qty" }))).toBe(false);
    expect(m.count).toBe(7);
    expect(m.unattached.map((c) => c.code)).toEqual(["arithmetic_mismatch", "duplicate", "custom"]);
    expect(m.places.every((p) => p.page === 37)).toBe(true);
    expect(m.allClear).toBe(false);                                                                   // vat is empty and unmarked
    const sent = reviewMarks(detail([f("date", "2026-05-20", 0.72)], [fail("low_confidence", "date")]), false);
    expect([sent.count, sent.unattached.length]).toEqual([0, 1]);                                      // nothing to change: nothing marked
  });

  it("marks a value not in the page's text even when no check names it, so the page never reads as all clear", () => {
    const m = reviewMarks(detail([f("city", "Tallinn", 0.95, { notOnPage: true }), f("typed", "X", 0.95, { notOnPage: true, edited: true })], []), true);
    expect(m.looks.get(editKey({ field: "city" }))?.text).toBe("Not in the page's text. Check it.");
    expect([m.count, m.allClear]).toEqual([1, true]);
  });
});
