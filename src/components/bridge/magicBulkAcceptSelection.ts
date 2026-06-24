// B11 — selecting which AI-suggested lines a "bulk accept" should act on.
//
// A line the user locally REJECTED (the row reducer's `rejected` mode) never changes the
// server-side `status`, so the old count `status !== "resolved" && aiSuggestedSupplierCode
// !== null` still included it and the bulk accept clobbered the rejection. The selection must
// exclude locally-rejected line numbers from BOTH the count and the lines actually accepted.
//
// Pure + framework-free so it can be unit-tested directly and reused by the count + the action.

export interface BulkSelectableLine {
  lineNumber: number;
  status: "suggested" | "resolved" | "unresolved";
  aiSuggestedSupplierCode: string | null;
  confidence: number | null;
}

export interface BulkAcceptSelectionArgs {
  lines: BulkSelectableLine[];
  /** Minimum confidence to include (0 = every suggested line; 0.85 = the conservative subset). */
  minConfidence: number;
  /** Line numbers the user locally rejected this session (must be skipped). */
  rejectedLineNumbers: ReadonlySet<number>;
}

/**
 * The lines a bulk accept at `minConfidence` would act on: not server-resolved, carry an AI
 * suggestion, meet the threshold, and are NOT locally rejected. The count shown on the button
 * and the lines actually sent are both derived from this one function so they can't drift.
 *
 * Null confidence counts as 0.0 (matches the backend, which treats a null-confidence suggestion
 * as acceptable at minConfidence=0).
 */
export function bulkAcceptLines({
  lines,
  minConfidence,
  rejectedLineNumbers,
}: BulkAcceptSelectionArgs): BulkSelectableLine[] {
  return lines.filter(
    (l) =>
      l.status !== "resolved" &&
      l.aiSuggestedSupplierCode !== null &&
      (l.confidence ?? 0) >= minConfidence &&
      !rejectedLineNumbers.has(l.lineNumber),
  );
}

/** Just the count — the button badge. Same selection, so badge === acted-on always. */
export function bulkAcceptCount(args: BulkAcceptSelectionArgs): number {
  return bulkAcceptLines(args).length;
}

/**
 * The explicit resolutions to POST when there ARE local rejections — each surviving suggested
 * line resolved to its AI code. Used in place of the broad server-side accept-all endpoint
 * (which has no per-line exclusion) so a rejected line is never re-accepted. The backend
 * commitMappings route is unchanged.
 */
export function bulkAcceptResolutions(
  args: BulkAcceptSelectionArgs,
): { lineNumber: number; supplierItemCode: string }[] {
  return bulkAcceptLines(args).map((l) => ({
    lineNumber: l.lineNumber,
    supplierItemCode: l.aiSuggestedSupplierCode as string, // non-null by the filter above
  }));
}
