// B11 — "Accept all AI suggestions" must skip lines the user locally rejected, in BOTH the
// count and the lines actually accepted.

import { describe, it, expect } from "vitest";
import {
  bulkAcceptLines,
  bulkAcceptCount,
  bulkAcceptResolutions,
  type BulkSelectableLine,
} from "./magicBulkAcceptSelection";

const lines: BulkSelectableLine[] = [
  { lineNumber: 1, status: "suggested", aiSuggestedSupplierCode: "S-1", confidence: 0.9 },
  { lineNumber: 2, status: "suggested", aiSuggestedSupplierCode: "S-2", confidence: 0.6 },
  { lineNumber: 3, status: "resolved", aiSuggestedSupplierCode: "S-3", confidence: 1.0 }, // already resolved
  { lineNumber: 4, status: "unresolved", aiSuggestedSupplierCode: null, confidence: null }, // no suggestion
  { lineNumber: 5, status: "suggested", aiSuggestedSupplierCode: "S-5", confidence: null }, // null conf = 0.0
];

describe("bulkAcceptLines / count / resolutions (B11)", () => {
  it("with no rejections, includes every suggested-unresolved line at minConfidence 0", () => {
    const sel = bulkAcceptLines({ lines, minConfidence: 0, rejectedLineNumbers: new Set() });
    expect(sel.map((l) => l.lineNumber)).toEqual([1, 2, 5]);
    expect(bulkAcceptCount({ lines, minConfidence: 0, rejectedLineNumbers: new Set() })).toBe(3);
  });

  it("EXCLUDES a locally-rejected line from both the count and the resolutions", () => {
    const rejectedLineNumbers = new Set([2]);
    const count = bulkAcceptCount({ lines, minConfidence: 0, rejectedLineNumbers });
    const res = bulkAcceptResolutions({ lines, minConfidence: 0, rejectedLineNumbers });
    expect(count).toBe(2);
    expect(res.map((r) => r.lineNumber)).toEqual([1, 5]); // line 2 skipped
    // The count and the acted-on lines MATCH (the whole point of B11).
    expect(res).toHaveLength(count);
  });

  it("honours the ≥85% threshold and still skips rejected lines", () => {
    // Only line 1 (0.9) clears 0.85; rejecting it leaves nothing.
    expect(bulkAcceptCount({ lines, minConfidence: 0.85, rejectedLineNumbers: new Set() })).toBe(1);
    expect(bulkAcceptCount({ lines, minConfidence: 0.85, rejectedLineNumbers: new Set([1]) })).toBe(0);
  });

  it("resolutions carry the AI code for each surviving line", () => {
    const res = bulkAcceptResolutions({ lines, minConfidence: 0, rejectedLineNumbers: new Set([1]) });
    expect(res).toEqual([
      { lineNumber: 2, supplierItemCode: "S-2" },
      { lineNumber: 5, supplierItemCode: "S-5" },
    ]);
  });
});
