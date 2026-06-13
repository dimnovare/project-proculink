// calibrationDisplay unit tests — the V9 honesty contract for which confidence
// the UI shows + thresholds against. The chip's "calibrated vs raw" display
// decision is pure (confidenceDisplay), so it is tested directly here.

import { describe, it, expect } from "vitest";
import { confidenceDisplay, effectiveConfidence } from "./calibrationDisplay";
import type { AiMappingSuggestion } from "@/types/procurement";

const base: AiMappingSuggestion = {
  supplierItemCode: "SUP-1",
  confidence: 0.92,
  reason: "exact match",
  provenance: "catalog",
};

describe("confidenceDisplay — calibrated vs raw display decision", () => {
  it("uses the CALIBRATED number when the backend calibrated the suggestion", () => {
    const d = confidenceDisplay({ ...base, confidence: 0.92, calibratedConfidence: 0.6, isCalibrated: true, calibrationBasis: "calibrated from 23 of your past decisions" });
    expect(d.calibrated).toBe(true);
    expect(d.effective).toBe(0.6);   // calibrated, not the over-confident 0.92
    expect(d.raw).toBe(0.92);
    expect(d.basis).toBe("calibrated from 23 of your past decisions");
  });

  it("uses the RAW number when isCalibrated is false (never implies calibration)", () => {
    const d = confidenceDisplay({ ...base, confidence: 0.92, calibratedConfidence: 0.6, isCalibrated: false, calibrationBasis: "model estimate — not enough history yet" });
    expect(d.calibrated).toBe(false);
    expect(d.effective).toBe(0.92);  // raw wins — the calibrated number is ignored when not calibrated
    expect(d.raw).toBe(0.92);
    expect(d.basis).toBe("model estimate — not enough history yet");
  });

  it("treats an ABSENT calibration overlay (pre-V9 order) as not calibrated", () => {
    const d = confidenceDisplay(base); // no calibration fields at all
    expect(d.calibrated).toBe(false);
    expect(d.effective).toBe(0.92);
    expect(d.basis).toBeNull();
  });

  it("falls back to raw if calibrated but the calibrated number is missing/NaN", () => {
    const d = confidenceDisplay({ ...base, isCalibrated: true, calibratedConfidence: undefined });
    expect(d.effective).toBe(base.confidence);
    const dNaN = confidenceDisplay({ ...base, isCalibrated: true, calibratedConfidence: NaN });
    expect(dNaN.effective).toBe(base.confidence);
  });

  it("normalises an empty basis string to null", () => {
    expect(confidenceDisplay({ ...base, calibrationBasis: "" }).basis).toBeNull();
  });

  it("effectiveConfidence is the threshold-facing number (calibrated when calibrated)", () => {
    expect(effectiveConfidence({ ...base, confidence: 0.92, calibratedConfidence: 0.6, isCalibrated: true })).toBe(0.6);
    expect(effectiveConfidence({ ...base, confidence: 0.92, calibratedConfidence: 0.6, isCalibrated: false })).toBe(0.92);
    expect(effectiveConfidence(base)).toBe(0.92);
  });
});
