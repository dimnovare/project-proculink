import { describe, it, expect } from "vitest";
import type { DetectFormatResult } from "@/lib/api-client";
import { detectionQualifier, detectionDotColour } from "./UploadWorkbench";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT THIS PAIRS WITH, VERBATIM.
//
// The backend stopped fabricating confidences for deterministic detections
// (ProcuLink PR #210): a `%PDF-` signature at byte 0 is a byte comparison, so it
// now sends `Confidence: null` with `Basis: "magic_bytes"`, and the `unknown`
// arms send null instead of 0.0.
//
// The frontend typed `confidence` as a non-nullable `number` and rendered
//
//   {Math.round(detection.confidence * 100)}%
//
// `Math.round(null * 100)` is 0 — because `null * 100` is 0, not NaN. So every
// detected PDF would have read "Detected: PDF · 0%" with a grey dot: on a
// percentage ramp 0% means "certainly wrong", which is a LOUDER lie than the
// invented 95% the backend fix removed, and it would have appeared on the
// detection the backend is most certain about.
//
// No existing frontend test asserted anything about `confidence`, so nothing
// would have caught it. This file is that assertion.
//
// It tests the two exported helpers rather than the DOM on purpose: jsdom applies
// no Tailwind, so both breakpoint trees of this screen mount and a text query for
// "0%" would be answering a different question than the one that matters.
// ─────────────────────────────────────────────────────────────────────────────

function detection(over: Partial<DetectFormatResult>): DetectFormatResult {
  return {
    format: "pdf",
    confidence: null,
    basis: "magic_bytes",
    suggestedParser: "PdfOrderParser",
    detectedPoNumber: null,
    detectedSupplier: null,
    estimatedLineCount: null,
    reasoning: [],
    seenCount: null,
    ...over,
  };
}

/**
 * The whole set of shapes the backend can send, so a case that stops being covered
 * fails rather than shrinking silently. Mirrors FormatDetectionBasis plus the
 * unknown-value arm.
 */
const SHAPES = [
  { name: "magic bytes, no score", value: detection({ confidence: null, basis: "magic_bytes" }) },
  { name: "heuristic with a score", value: detection({ confidence: 0.72, basis: "heuristic" }) },
  { name: "undetermined, no score", value: detection({ format: "unknown", confidence: null, basis: "undetermined" }) },
  { name: "a basis this build does not know", value: detection({ confidence: null, basis: "something_newer" }) },
] as const;

describe("format-detection chip — an absent confidence is not a zero", () => {
  it("covers every shape the API can send", () => {
    expect(SHAPES).toHaveLength(4);
  });

  it.each(SHAPES.filter((s) => s.value.confidence === null))(
    "never renders a percentage when there is no score ($name)",
    ({ value }) => {
      const qualifier = detectionQualifier(value);

      // The defect, stated as the assertion: null must never become 0%.
      expect(qualifier).not.toBe("0%");
      expect(qualifier ?? "").not.toMatch(/\d+\s*%/);
    },
  );

  it("names the evidence for a deterministic signature instead of scoring it", () => {
    expect(detectionQualifier(detection({ confidence: null, basis: "magic_bytes" })))
      .toBe("file signature");
  });

  it("says so plainly when nothing determined the format", () => {
    expect(detectionQualifier(detection({ format: "unknown", confidence: null, basis: "undetermined" })))
      .toBe("format not determined");
  });

  it("adds nothing at all for an unrecognised basis with no score", () => {
    expect(detectionQualifier(detection({ confidence: null, basis: "something_newer" }))).toBeNull();
  });

  // Anti-vacuity: the assertions above would all pass against a helper that
  // returned null for everything. A real score must still render as a percentage.
  it("still renders a real heuristic score as a percentage", () => {
    expect(detectionQualifier(detection({ confidence: 0.72, basis: "heuristic" }))).toBe("72%");
    expect(detectionQualifier(detection({ confidence: 0.925, basis: "heuristic" }))).toBe("93%");
  });

  // A genuine zero is a different thing from an absent score, and the backend can
  // no longer send one — but if it ever does, it means "scored, and scored zero",
  // which is exactly what 0% should say.
  it("distinguishes a scored zero from no score at all", () => {
    expect(detectionQualifier(detection({ confidence: 0, basis: "heuristic" }))).toBe("0%");
    expect(detectionQualifier(detection({ confidence: null, basis: "heuristic" }))).toBeNull();
  });
});

describe("format-detection chip — the dot", () => {
  it("shows a deterministic signature as the strongest answer, not the weakest", () => {
    // The old chain was `confidence >= 0.8 ? green : confidence >= 0.5 ? amber : faint`.
    // With a null both comparisons are false, so the most certain detection the
    // backend has would have rendered in the same grey as "we have no idea".
    const green = detectionDotColour(detection({ confidence: 0.95, basis: "heuristic" }));
    expect(detectionDotColour(detection({ confidence: null, basis: "magic_bytes" }))).toBe(green);
  });

  it("keeps the three-band ramp for a real score", () => {
    expect(detectionDotColour(detection({ confidence: 0.9, basis: "heuristic" }))).toBe("#1E6D29");
    expect(detectionDotColour(detection({ confidence: 0.6, basis: "heuristic" }))).toBe("#B36D14");
    expect(detectionDotColour(detection({ confidence: 0.2, basis: "heuristic" }))).toBe("var(--ink-faint)");
  });

  it("stays faint when nothing determined the format", () => {
    expect(detectionDotColour(detection({ format: "unknown", confidence: null, basis: "undetermined" })))
      .toBe("var(--ink-faint)");
  });
});
