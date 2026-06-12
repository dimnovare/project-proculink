// parseStall — pure threshold logic for the worker-down honesty escalation on
// the parse-polling screens (MagicMappingPreview). No React — unit-tested in
// parseStall.test.ts.
//
// Honesty contract (G9): when an order has been stuck in `parsing` beyond the
// threshold, the UI escalates its copy to "processing may be paused — check
// system health" and links /operations/health. It NEVER claims failure (the
// Worker may just be catching up) and polling continues unchanged.

/** How long an order may sit in `parsing` before the UI escalates. */
export const PARSE_STALL_THRESHOLD_MS = 90_000;

/**
 * True when the elapsed time since parsing was first observed exceeds the
 * stall threshold. Non-finite/negative elapsed values are treated as "not
 * stalled" (never escalate on bad clock input).
 */
export function isParseStalled(
  elapsedMs: number,
  thresholdMs: number = PARSE_STALL_THRESHOLD_MS,
): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  return elapsedMs > thresholdMs;
}
