"use client";

// ConfidenceChip — THE AI-confidence percentage chip. One implementation, one
// set of thresholds.
//
// There used to be four, and they disagreed, so the same score rendered a
// different colour depending on which pane you were looking at:
//
//   DSPrimitives.tsx           >=90 / >=75   exported, imported by nobody
//   mapper/ConfidenceChip.tsx  >=85 / >=65   the two mapper panes
//   PoMappingEditor.tsx        >=85 / >=60   a local copy
//   SupplierDockProfile.tsx    >=90 / >=75   via the .conf-* CSS classes
//
// An 88% read GREEN in the mapper and in PoMappingEditor but AMBER in the
// supplier profile; a 62% read AMBER in PoMappingEditor and RED everywhere else.
// None of the four had a test.
//
// The surviving thresholds are CLAUDE.md §6's contract — >=90 green, 75-89
// amber, <75 red — which is exactly `confidenceTier` in src/lib/ds-tokens.ts.
// This file imports that helper rather than restating the numbers, so there is
// one threshold function in the codebase. Pinned at the boundaries by
// ConfidenceChip.test.tsx.
//
// NOT folded in: ghostWireModel.ghostConfidenceTier (0.85 / 0.60). Be honest
// about WHY, because the first stated reason was wrong: it is NOT "because it
// runs on a 0..1 score". This chip normalises 0..1 itself two functions below
// (`value <= 1 ? value * 100 : value`, pinned by its own test), so that
// distinction collapses, and ghostWireModel.ts concedes it uses "the SAME
// tiering language as ds-tokens.confidenceTier". It is, plainly, a FIFTH
// threshold ladder with the same "ok"|"warn"|"danger" output.
//
// The real reasons to leave it alone: 0.85/0.60 is a deliberate plan
// requirement for ghost-wire risk (a different question from field
// confidence), it is the only confidence helper that already has unit tests,
// and folding it in would change TESTED behaviour to satisfy no stated need.
// Right call, corrected rationale.

import { confidenceTier } from "@/lib/ds-tokens";

/**
 * Chip colours for a whole-percent confidence. Exported because supplier
 * auto-detect scores the same way visually (high = green, mid = amber, low =
 * red) but is a HEURISTIC, not a model output — it reuses the ramp, never the
 * "AI confidence" label.
 *
 * Contrast, computed (WCAG 2.1), foreground on the chip's own background:
 *   ok 5.57:1 · warn 5.62:1 · danger 4.83:1 — all AA for the 9.5px text.
 */
export function confidenceTone(pct: number): { fg: string; bg: string; bd: string } {
  const tier = confidenceTier(pct);
  if (tier === "ok") return { fg: "#1E6D29", bg: "#E9F1EA", bd: "#CDE7D1" };
  // --amber-text, not --amber: #B36D14 on this fill is 3.65:1 and fails AA.
  if (tier === "warn") return { fg: "#8A5310", bg: "#FAF1DD", bd: "#EAD9AE" };
  return { fg: "#B43838", bg: "#FBE3E3", bd: "#F0C9C9" };
}

export function ConfidenceChip({ value, sm = false }: { value: number; sm?: boolean }) {
  // Call sites pass either a 0..1 score (API suggestions) or a whole percent
  // (mapping rows). Normalise before tiering, or a 0.92 would tier as "danger".
  const pct = Math.round(value <= 1 ? value * 100 : value);
  const tone = confidenceTone(pct);
  return (
    <span
      aria-label={`AI confidence ${pct}%`}
      title={`AI confidence · ${pct}%`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
        fontSize: sm ? 9 : 9.5, lineHeight: 1,
        padding: sm ? "2px 5px" : "2px 6px", borderRadius: 999,
        color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`,
        flexShrink: 0, fontVariantNumeric: "tabular-nums",
      }}
    >
      {pct}%
    </span>
  );
}
