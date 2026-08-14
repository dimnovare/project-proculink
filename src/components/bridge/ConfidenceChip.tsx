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

/**
 * What produced the number on the chip. This is the chip's own guard rail, not
 * decoration — see `ConfidenceChip` below.
 *
 *  - `"model"`         a scorer produced this. The only basis allowed to wear an
 *                      "AI" label.
 *  - `"heuristic"`     a real measurement, but not a model: client-side
 *                      Levenshtein/token similarity, a supplier auto-detect
 *                      score. Honest to show, dishonest to call AI.
 *  - `"deterministic"` a lookup or an echo. There is no score at all, so there is
 *                      no chip.
 */
export type ConfidenceBasis = "model" | "heuristic" | "deterministic";

/** An "AI"-flavoured label: the word AI standing alone, not the "ai" in "plain". */
const AI_CLAIM = /\bAI\b/i;

/**
 * `label` names WHAT scored this, and it defaults to the neutral "Confidence" on
 * purpose. The chip used to hard-code "AI confidence", which made every call site
 * an AI claim whether or not a model was involved — including a supplier
 * auto-detect heuristic and, worse, a saved supplier mapping the suggester is
 * never even invoked for. Call sites that really do render a model score pass
 * `label="AI confidence"` and read exactly as before; anything else says less and
 * says it truthfully.
 *
 * ── Why the label alone was not enough ──────────────────────────────────────
 *
 * Making the label a free string moved the decision to the call site and then
 * trusted every call site to get it right. They did not. `PoMappingEditor`
 * passed `label="AI confidence"` gated only on `score != null`, so a heuristic
 * Levenshtein match — the LIVE fallback whenever the suggest-fields call fails,
 * 404s, or returns an unparseable body — rendered `aria-label="AI confidence
 * 89%"`. The same file already computed `isModelSuggestion` for exactly this
 * reason and used it only to colour the surrounding card.
 *
 * So the rule now lives HERE, where it cannot be forgotten by a fourth call site:
 *
 *   1. **No number, no chip.** A nullish `value` renders nothing. A basis of
 *      `"deterministic"` renders nothing. Previously a caller that forgot to
 *      check would print `0%` or `NaN%` — and `0%` on the confidence ramp is a
 *      red "we are certain this is wrong", which is a louder lie than the
 *      fabricated 95% this change removes.
 *   2. **An AI label requires `basis="model"`.** Any other basis (including an
 *      omitted one) downgrades the wording to a truthful neutral — the chip still
 *      shows the number, because a heuristic score is a real measurement; it just
 *      stops attributing it to a model. The downgrade applies to BOTH the visible
 *      text and the accessible name, because the original defect lived in an
 *      `aria-label` that a DOM-text assertion would have walked straight past.
 *
 * Pinned by ConfidenceChip.test.tsx.
 */
export function ConfidenceChip({
  value,
  sm = false,
  label = "Confidence",
  basis,
}: {
  value: number | null | undefined;
  sm?: boolean;
  label?: string;
  basis?: ConfidenceBasis;
}) {
  // Rule 1 — nothing measured this, so there is nothing to draw. Not "0%".
  if (value == null || Number.isNaN(value)) return null;
  if (basis === "deterministic") return null;

  // Rule 2 — the AI claim has to be earned.
  const effectiveLabel =
    AI_CLAIM.test(label) && basis !== "model"
      ? basis === "heuristic"
        ? "Match"
        : "Confidence"
      : label;

  // Call sites pass either a 0..1 score (API suggestions) or a whole percent
  // (mapping rows). Normalise before tiering, or a 0.92 would tier as "danger".
  const pct = Math.round(value <= 1 ? value * 100 : value);
  const tone = confidenceTone(pct);
  return (
    <span
      aria-label={`${effectiveLabel} ${pct}%`}
      title={`${effectiveLabel} · ${pct}%`}
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
