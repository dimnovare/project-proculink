import { describe, it, expect } from "vitest";
import { supplierReasonText, SUPPLIER_REASON_MAX } from "../supplierReasonText";
import { PRODUCTION_404_ATTEMPT_MESSAGE, PRODUCTION_404_ERROR_MESSAGE } from "./productionDefectStrings";

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

    // "No severed word" stated as the thing itself, rather than as "the last token is longer
    // than three characters". That heuristic reads a whole short word ("…reindexed the…") as
    // corruption and a long severed one ("…reindexe…") as clean — it only happened to be right
    // at the old ceiling. The real claim is that whatever the ellipsis follows is a word the
    // supplier actually wrote.
    const lastToken = out.slice(0, -1).trimEnd().split(/\s+/).pop()!;
    expect(long).toMatch(new RegExp(`\\b${lastToken}\\b`));
  });

  it("does not reformat a long plain sentence beyond clamping it", () => {
    const plain = "Rejected: line 4 references SKU BRK-99 which was discontinued.";
    expect(supplierReasonText(plain)).toBe(plain);
  });
});

describe("the exact string production showed an operator", () => {
  const out = () => supplierReasonText(PRODUCTION_404_ERROR_MESSAGE);

  it("keeps the part that says what happened", () => {
    expect(out()).toContain("HTTP 404");
  });

  it("shows no markup at all — not a tag, not a doctype, not a comment", () => {
    const text = out() ?? "";
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
    expect(text).not.toContain("DOCTYPE");
    // The body opened with an HTML comment. Its text is advice for a developer calling an API,
    // never a reason a purchase order failed.
    expect(text).not.toContain("Tip:");
    expect(text).not.toContain("Accept header");
  });

  it("does not end on a lead-in whose content was stripped away", () => {
    // "…returned an error. Response summary:" promises a summary and then stops. An operator
    // reading that learns nothing and reasonably assumes the screen is broken.
    expect(out()?.trimEnd().endsWith(":")).toBe(false);
    expect(out()).not.toContain("Response summary");
  });
});

describe("markup that hides behind a '>' inside it", () => {
  it("drops an HTML comment even when the comment itself contains '>'", () => {
    // A naive `<[^>]*>` stops at the first '>', which is INSIDE the comment, leaving its tail
    // on screen. The production body opened with a comment, so this is the same shape one
    // character away.
    const out = supplierReasonText(
      "<!-- if qty > 10 use the bulk endpoint --><p>Rejected: unknown ship-to code.</p>",
    );
    expect(out).toBe("Rejected: unknown ship-to code.");
  });
});

describe("the ceiling is tall enough for our own operator copy", () => {
  // The longest sentence the backend can put on a delivery attempt is the 403 row of
  // SupplierResponseClassification.NamedCauses (289 characters). If the clamp cuts that, the
  // panel truncates ProcuLink's own instructions — which name the fix and where to make it.
  const LONGEST_BACKEND_HINT =
    "The supplier's endpoint recognised our credentials but refused the request (HTTP 403). " +
    "The account most likely lacks permission to post orders, or the supplier has not " +
    "allow-listed us yet — confirm both with the supplier, check this supplier's delivery " +
    "settings, then send the order again.";

  it("passes the longest backend-authored failure sentence through whole", () => {
    expect(LONGEST_BACKEND_HINT.length).toBeGreaterThan(280); // guards the fixture itself
    expect(supplierReasonText(LONGEST_BACKEND_HINT)).toBe(LONGEST_BACKEND_HINT);
  });

  it("keeps the production 404 sentence intact, including the half that says what to do", () => {
    const out = supplierReasonText(PRODUCTION_404_ATTEMPT_MESSAGE);
    expect(out).toBe(PRODUCTION_404_ATTEMPT_MESSAGE);
    expect(out).toContain("correct it there, then send the order again");
  });

  it("still refuses to paste an unbounded body", () => {
    const wall = "x".repeat(5_000);
    expect(supplierReasonText(wall)!.length).toBeLessThanOrEqual(SUPPLIER_REASON_MAX + 1);
  });
});
