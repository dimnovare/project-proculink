// pipelineIndicator — words for the five dots.
//
// The inbox's Pipeline column rendered <StatusJourney compact/> and nothing else:
// five 11px dots in 184px with no role, no accessible name, no caption and no legend
// anywhere on the page. A screen reader announced the empty string; a sighted
// operator was asked to count dots against a key that did not exist. At 390px the
// column does not render at all (the table is lg-only), so the mobile card carried no
// pipeline information whatsoever.
//
// These helpers are pure so the caption, the accessible name and the legend all derive
// from ONE stage list — an accessible name that disagreed with the visible caption
// would be worse than no name at all.

import type { OrderStage } from "./StatusJourney";

/**
 * The five nodes, in order. Mirrors STAGES in StatusJourney.tsx, which renders them as
 * labels in its `full` variant; the compact variant has no room for words, which is why
 * this module exists. CLAUDE.md §9 locks the names — this packet makes them legible,
 * it does not rename them.
 */
export const PIPELINE_STAGE_NAMES = [
  "Parse",
  "Normalize",
  "Validate",
  "Transform",
  "Deliver",
] as const;

export type PipelineStageName = (typeof PIPELINE_STAGE_NAMES)[number];

/** The node an OrderStage sits on, whether it is progressing or failed. */
export function pipelineNodeIndex(stage: OrderStage): number {
  return typeof stage === "object" ? stage.failed : stage;
}

/** The node's own name, e.g. `2` → "Validate". */
export function pipelineStageName(stage: OrderStage): PipelineStageName {
  return PIPELINE_STAGE_NAMES[pipelineNodeIndex(stage)];
}

/**
 * The caption for a row this build cannot place on the track at all.
 *
 * A status the frontend has never heard of is a routine event — frontend and backend
 * deploy separately — and the ONLY dishonest thing to print for one is a node. Every
 * other caption here names a step, so an unknown row needs words that name none: no
 * "1 of 5", no stage name, nothing an operator could act on by mistake.
 */
export const UNKNOWN_STAGE_CAPTION = "Progress unknown";

/**
 * The visible caption under the dots, and the whole of the mobile card's pipeline line.
 *
 *   progressing → "3 of 5 · Validate"
 *   failed      → "Failed at Transform"
 *
 * A failed row deliberately drops the "n of 5": the number reads as progress, and a
 * transform failure has not progressed to 4 of 5 — it stopped there.
 */
export function pipelineCaption(stage: OrderStage): string {
  const name = pipelineStageName(stage);
  if (typeof stage === "object") return `Failed at ${name}`;
  return `${stage + 1} of 5 · ${name}`;
}

/**
 * The cell's accessible name. It names the NODE and the STATUS together, because the
 * acceptance criterion is that the two agree — a name that said only "step 4 of 5"
 * could not be checked against the label by anyone, sighted or not.
 *
 *   pipelineAccessibleName(2, "Needs review")
 *     → "Step 3 of 5: Validate. Needs review."
 *   pipelineAccessibleName({ failed: 3 }, "Couldn't build output")
 *     → "Failed at step 4 of 5: Transform. Couldn't build output."
 */
export function pipelineAccessibleName(stage: OrderStage, statusLabel: string): string {
  const name = pipelineStageName(stage);
  const n = pipelineNodeIndex(stage) + 1;
  const head =
    typeof stage === "object"
      ? `Failed at step ${n} of 5: ${name}.`
      : `Step ${n} of 5: ${name}.`;
  return `${head} ${statusLabel}.`;
}

/**
 * The mobile card's line — the same words, prefixed so it reads as a sentence fragment.
 *
 * `null` means "this build cannot place the order on the track" (see
 * UNKNOWN_STAGE_CAPTION). It is accepted here rather than resolved by the caller so
 * that both viewports and the desktop cell all print ONE set of words for that case.
 */
export function pipelineCardLine(stage: OrderStage | null): string {
  if (stage === null) return UNKNOWN_STAGE_CAPTION;
  if (typeof stage === "object") return `Failed at step ${pipelineNodeIndex(stage) + 1} of 5 · ${pipelineStageName(stage)}`;
  return `Step ${pipelineCaption(stage)}`;
}
