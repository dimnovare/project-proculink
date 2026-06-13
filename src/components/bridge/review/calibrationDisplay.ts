// calibrationDisplay — PURE helpers for the V9 confidence-calibration display
// decision. No React, fully unit-tested. ONE place decides "show the calibrated
// number or the raw one", so the per-suggestion chip and the bulk-accept
// threshold can never disagree about what reality is.
//
// HONESTY CONTRACT (enforced here, asserted in calibrationDisplay.test.ts):
//   • The calibrated number ALWAYS comes from the backend (`calibratedConfidence`)
//     — it is never computed client-side.
//   • We display "calibrated" ONLY when the backend set `isCalibrated === true`.
//     Cold-start / thin-bucket / AI-off suggestions show the RAW confidence with
//     the backend's honest basis string and are NEVER labelled calibrated.
//   • `calibrationBasis` is shown verbatim from the backend — never invented.

import type { AiMappingSuggestion } from "@/types/procurement";

/** The minimal calibration-bearing shape (subset of AiMappingSuggestion). */
export interface CalibrationFields {
  /** RAW model confidence, 0–1. */
  confidence: number;
  calibratedConfidence?: number | null;
  isCalibrated?: boolean | null;
  calibrationBasis?: string | null;
}

export interface ConfidenceDisplay {
  /** True only when the backend marked this suggestion calibrated. */
  calibrated: boolean;
  /**
   * The confidence to SHOW + threshold against, 0–1. Calibrated value when the
   * backend calibrated it (falling back to raw if the calibrated number is
   * somehow absent), else the raw model confidence.
   */
  effective: number;
  /** Always the raw model confidence, 0–1 — for the "raw N% → calibrated M%" detail. */
  raw: number;
  /** Backend basis string, or null when none was provided. */
  basis: string | null;
}

/**
 * Resolve which confidence to DISPLAY (and threshold against) for an AI
 * suggestion, honouring the backend calibration overlay. Treats an absent
 * `isCalibrated` (order fetched before V9 shipped, or AI off) as NOT calibrated.
 */
export function confidenceDisplay(s: CalibrationFields): ConfidenceDisplay {
  const raw = s.confidence;
  const calibrated = s.isCalibrated === true;
  // Guard: only trust the calibrated number when the backend both flagged it
  // AND provided a finite value. Never recompute it locally.
  const hasCalibratedNumber =
    typeof s.calibratedConfidence === "number" && Number.isFinite(s.calibratedConfidence);
  const effective = calibrated && hasCalibratedNumber ? (s.calibratedConfidence as number) : raw;
  return {
    calibrated,
    effective,
    raw,
    basis: s.calibrationBasis != null && s.calibrationBasis !== "" ? s.calibrationBasis : null,
  };
}

/**
 * The confidence (0–1) the bulk "Accept all ≥threshold" action must test a
 * suggestion against: the CALIBRATED value when calibrated, else RAW. So an
 * over-confident raw 0.92 that empirically accepts at 0.6 no longer auto-qualifies.
 */
export function effectiveConfidence(s: AiMappingSuggestion): number {
  return confidenceDisplay(s).effective;
}
