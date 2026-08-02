import { describe, it, expect } from "vitest";
import { supplierReasonText, SUPPLIER_REASON_MAX } from "../supplierReasonText";

/**
 * The case that produced this: the first authenticated production pass sent an order to a supplier
 * whose endpoint 404'd with an HTML error page, and the operator was shown its markup as the reason
 * the order failed (`docs/qa/2026-08-01-wp-39-authenticated-production-pass.md` §4.4).
 */
describe("supplierReasonText — a supplier's body, made fit to read", () => {
  it("passes a real sentence through untouched", () => {
    const sentence = "Order rejected: PO number already received on 2026-07-14.";
    expect(supplierReasonText(sentence)).toBe(sentence);
  });

  it("returns null for an HTML error page rather than showing its markup", () => {
    const page =
      "<!DOCTYPE html><html><head><title>404 Not Found</title>" +
      "<style>body{font-family:sans-serif}</style></head>" +
      "<body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>";
    const out = supplierReasonText(page);
    expect(out).not.toBeNull();
    expect(out).not.toContain("<");
    expect(out).not.toContain("DOCTYPE");
    expect(out).toContain("Not Found");
    // The <style> body is chrome, never a reason.
    expect(out).not.toContain("font-family");
  });

  it("keeps words apart across block boundaries", () => {
    // Without this, "<p>Rejected</p><p>Bad SKU</p>" fuses into "RejectedBad SKU".
    expect(supplierReasonText("<p>Rejected</p><p>Bad SKU</p>")).toBe("Rejected Bad SKU");
  });

  it("returns null when nothing legible survives, so the caller's own copy wins", () => {
    expect(supplierReasonText("<html><body><div><span></span></div></body></html>")).toBeNull();
    expect(supplierReasonText("   ")).toBeNull();
    expect(supplierReasonText(null)).toBeNull();
    expect(supplierReasonText(undefined)).toBeNull();
  });

  it("returns null for a JSON payload with no sentence — an id blob is not an explanation", () => {
    expect(supplierReasonText('{"traceId":"9f2b-41","code":404}')).toBeNull();
  });

  it("lifts the sentence out of a JSON body rather than discarding it", () => {
    // Suppliers commonly answer `{"error":"..."}`. Showing the operator a brace-blob is bad; so is
    // throwing away a message the supplier actually wrote.
    expect(supplierReasonText('{"error":"PO already received","code":409}')).toBe(
      "PO already received",
    );
    expect(supplierReasonText('{"message":"Unknown ship-to code"}')).toBe("Unknown ship-to code");
  });

  it("decodes the entities a stripped page leaves behind", () => {
    expect(supplierReasonText("<p>Rejected &amp; returned &#39;as-is&#39;</p>")).toBe(
      "Rejected & returned 'as-is'",
    );
  });

  it("clamps a long body and does not sever a word", () => {
    const long = `Rejected because ${"the supplier catalogue is being reindexed ".repeat(12)}`;
    const out = supplierReasonText(long)!;
    expect(out.length).toBeLessThanOrEqual(SUPPLIER_REASON_MAX + 1); // +1 for the ellipsis
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s\S{1,3}…$/); // no severed fragment before the ellipsis
  });

  it("does not reformat a long plain sentence beyond clamping it", () => {
    const plain = "Rejected: line 4 references SKU BRK-99 which was discontinued.";
    expect(supplierReasonText(plain)).toBe(plain);
  });
});
