// buildFixQueue — PURE function that derives the Fix Queue card list from
// SERVER truth (the order + the last acceptance-validation result). No React,
// no side effects, fully unit-tested.
//
// Invariants (parity gate G3):
//   • Every send blocker has a card: open cards === lines with needsReview
//     (INCLUDING the flagged-but-coded class that the old `err` predicate
//     silently excluded — the invisible-blocker P0) + failing acceptance rules.
//   • Order is FROZEN against prevQueue: a resolved card keeps its index and
//     collapses in place (resolved: true) — the list NEVER reshuffles under
//     the operator's cursor. Newly-flagged issues APPEND at the end with
//     isNew: true (the UI announces them via an aria-live pill).
//   • Initial order (no prevQueue): severity rank, then line number, then key.

import type { Order, OrderValidationResult } from "@/types/procurement";

export type FixCardKind = "ai-suggestion" | "manual-code" | "review-flag" | "rule-failure";

export interface FixQueueCard {
  /** Stable identity: `line:{lineId}` | `rule:{fieldPath}:{line|h}#{n}`. */
  key: string;
  kind: FixCardKind;
  /** True for header-level rule failures (no line number) — rendered as header rows. */
  headerLevel?: boolean;
  /** Owning order line (line-scoped cards only). */
  lineId?: string;
  lineNumber?: number;
  /** Sort weight used ONLY for the initial (frozen-thereafter) ordering. */
  severity: number;
  /** Short human title, e.g. "Needs a supplier code". */
  title: string;
  /** Secondary detail, e.g. the rule message or the suggested code. */
  detail?: string;
  /** True once the server no longer reports this issue — collapsed in place. */
  resolved: boolean;
  /** True when the card appeared AFTER the initial queue build (appended). */
  isNew?: boolean;
}

const KIND_SEVERITY: Record<FixCardKind, number> = {
  "ai-suggestion": 0, // one-keystroke wins first
  "manual-code": 1,   // typing required
  "review-flag": 2,   // has a code, needs a human eye
  "rule-failure": 3,  // acceptance-profile failures (warnings rank +1)
};

/** Derive the CURRENT open-issue set from server truth (unsorted). */
function freshCards(order: Order, validationResult: OrderValidationResult | null | undefined): FixQueueCard[] {
  const cards: FixQueueCard[] = [];

  for (const l of order.lines) {
    if (!l.needsReview) continue;
    if (!l.supplierItemCode && l.aiSuggestion) {
      cards.push({
        key: `line:${l.id}`,
        kind: "ai-suggestion",
        lineId: l.id,
        lineNumber: l.lineNumber,
        severity: KIND_SEVERITY["ai-suggestion"],
        title: "AI suggestion to review",
        detail: l.aiSuggestion.supplierItemCode,
        resolved: false,
      });
    } else if (!l.supplierItemCode) {
      cards.push({
        key: `line:${l.id}`,
        kind: "manual-code",
        lineId: l.id,
        lineNumber: l.lineNumber,
        severity: KIND_SEVERITY["manual-code"],
        title: "Needs a supplier code",
        resolved: false,
      });
    } else {
      // Flagged WITH a code (e.g. scanned-PDF review flag). The old review
      // screen's `err` predicate excluded this class entirely, so it blocked
      // Send with zero affordance — it MUST be a card.
      cards.push({
        key: `line:${l.id}`,
        kind: "review-flag",
        lineId: l.id,
        lineNumber: l.lineNumber,
        severity: KIND_SEVERITY["review-flag"],
        title: "Flagged for review",
        detail: l.supplierItemCode,
        resolved: false,
      });
    }
  }

  if (validationResult) {
    // Key by fieldPath + line, disambiguating repeats by occurrence index so
    // identical failure sets produce identical keys across rebuilds.
    const seen = new Map<string, number>();
    for (const r of validationResult.results) {
      if (r.passed) continue;
      const base = r.lineNumber != null
        ? `rule:${r.rule.fieldPath}:${r.lineNumber}`
        : `rule:${r.rule.fieldPath}:h`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      cards.push({
        key: n === 0 ? base : `${base}#${n}`,
        kind: "rule-failure",
        headerLevel: r.lineNumber == null,
        lineNumber: r.lineNumber,
        severity: KIND_SEVERITY["rule-failure"] + (r.severity === "warning" ? 1 : 0),
        title: r.rule.fieldPath,
        detail: r.message,
        resolved: false,
      });
    }
  }

  return cards;
}

function initialSort(cards: FixQueueCard[]): FixQueueCard[] {
  return [...cards].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity - b.severity;
    const al = a.lineNumber ?? Number.MAX_SAFE_INTEGER;
    const bl = b.lineNumber ?? Number.MAX_SAFE_INTEGER;
    if (al !== bl) return al - bl;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Build the Fix Queue. Pass the previous queue to FREEZE ordering:
 *   • cards still open: updated in place (kind/detail may change, index doesn't)
 *   • cards no longer reported by the server: kept at index, resolved: true
 *   • cards not seen before: APPENDED in fresh order with isNew: true
 */
export function buildFixQueue(
  order: Order,
  validationResult: OrderValidationResult | null | undefined,
  prevQueue?: FixQueueCard[] | null,
): FixQueueCard[] {
  const fresh = initialSort(freshCards(order, validationResult));
  if (!prevQueue || prevQueue.length === 0) return fresh;

  const freshByKey = new Map(fresh.map(c => [c.key, c]));
  const out: FixQueueCard[] = [];

  for (const prev of prevQueue) {
    const cur = freshByKey.get(prev.key);
    if (cur) {
      // Still open — update content, keep position + isNew marker.
      out.push({ ...cur, isNew: prev.isNew, resolved: false });
      freshByKey.delete(prev.key);
    } else {
      // Server no longer reports it — resolved, collapse IN PLACE.
      out.push({ ...prev, resolved: true });
    }
  }

  // Anything left is newly flagged — APPEND (never re-sort the frozen list).
  for (const c of fresh) {
    if (freshByKey.has(c.key)) {
      out.push({ ...c, isNew: true });
    }
  }

  return out;
}

/** Open (unresolved) cards in the queue. */
export function openCardCount(queue: FixQueueCard[]): number {
  return queue.reduce((n, c) => n + (c.resolved ? 0 : 1), 0);
}

/**
 * The key of the adjacent OPEN card relative to `fromKey`, walking the frozen
 * queue in `dir` and WRAPPING around the ends. Drives focus auto-advance after
 * a server-confirmed resolve, "Skip — keep flagged", and the rail's roving
 * tabindex arrow navigation (one pure implementation for all three).
 *
 * • `fromKey` itself is never returned unless it is the ONLY open card.
 * • When `fromKey` is null/absent (e.g. nothing selected yet), returns the
 *   first open card for dir=1 and the last open card for dir=-1.
 * • Returns null when the queue has no open cards.
 */
export function adjacentOpenKey(
  queue: FixQueueCard[],
  fromKey: string | null,
  dir: 1 | -1 = 1,
): string | null {
  if (queue.length === 0) return null;
  const start = fromKey == null ? -1 : queue.findIndex(c => c.key === fromKey);
  if (start === -1) {
    // No anchor — first open (forward) / last open (backward).
    const open = queue.filter(c => !c.resolved);
    if (open.length === 0) return null;
    return dir === 1 ? open[0].key : open[open.length - 1].key;
  }
  const n = queue.length;
  for (let step = 1; step <= n; step++) {
    const c = queue[(((start + dir * step) % n) + n) % n];
    if (!c.resolved) return c.key;
  }
  return null;
}
