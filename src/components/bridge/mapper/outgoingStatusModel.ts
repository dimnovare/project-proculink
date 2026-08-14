// Pure status model for the OUTGOING pane (the reworked TargetLane). No React, no DOM —
// TDD'd in jsdom. The structural redesign replaces the old "every row shouts red unmapped"
// rendering with an HONEST per-output status:
//
//   • MAPPED      → show the resolved value preview (mono) + a small source tag
//                   ("← PO number", "= fixed", "auto").
//   • AUTO        → a 1:1 default pass-through (no explicit wire/fixed) that still produces a
//                   value. Quiet "auto" tag, muted — NOT an error.
//   • UNMAPPED    → loud ONLY when the output is REQUIRED (quiet amber "needs a source").
//                   Optional unmapped outputs stay silent/neutral.
//
// The value preview is resolved by chasing the override projections the engine already
// builds (outputConnections: outputPath→canonicalField; sourceConnections:
// canonicalField→sourceTokenId; fixedValues: outputPath→literal) against the order's source
// token values. Everything here is a pure function of those projections so it is testable
// without mounting the wire engine.

import { CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS } from "@/lib/api/types";
import type { TargetField } from "./types";

/** Canonical fields the supplier dispatcher treats as required (a missing source is loud). */
const REQUIRED_CANONICAL = new Set<string>([
  "PoNumber",
  "Quantity",
  "UnitPrice",
  // A line must identify the item to the supplier — at least one code. We treat
  // SupplierItemCode as the required line identifier (the buyer code is the fallback input).
  "SupplierItemCode",
]);

/**
 * The DEFAULT outgoing spine (header + line) — used to decide whether a 1:1 default exists.
 *
 * <b>Deliberately the DEFAULT spine, not the BINDABLE set.</b> WP-14 briefly widened this to all 53
 * bindable names on the reasoning that "ShipToCity resolves 1:1 from the backend row bag". It does
 * — but only for a rule that NAMES it. The default transform emits these 13 and nothing else, so
 * for a configured output column called `ShipToCity` with no rule the backend emits nothing while
 * this pane reported `mapped: true, kind: "auto"` and rendered a value preview taken from the
 * parsed order. Confidently wrong is worse than the amber it replaced.
 *
 * "Bindable" and "emitted by default" are two different sets and this is the one that answers
 * "do I need a wire here?". Pinned by outgoingStatusModel.test.ts.
 */
const CANONICAL_SPINE = new Set<string>([...CANONICAL_HEADER_FIELDS, ...CANONICAL_LINE_FIELDS]);

/** How an output field gets its value, for the small source tag. */
export type OutgoingSourceKind = "wired" | "fixed" | "auto" | "none";

/**
 * Whether this output will actually carry a value to the supplier.
 *
 * Deliberately three states and deliberately NOT a boolean. `mapped` answers "is there a rule
 * that emits this column"; that is a different question, and for months the Send gate asked the
 * first one while believing it had asked the second. `"unknown"` exists because the value
 * lookups are empty in the shipped connection editor whenever there is no sample order — and an
 * absent lookup is not evidence of an absent value.
 */
export type OutgoingResolution = "resolved" | "missing" | "unknown";

/** The honest, per-output status the OutgoingPane row renders. */
export interface OutgoingFieldStatus {
  outputPath: string;
  /**
   * True when SOMETHING emits this output — a fixed literal, an explicit wire, or the implicit
   * 1:1 auto default. It does NOT promise a value: the auto and wired branches both stay
   * `mapped` when the value behind them is null, because the column is still emitted (empty).
   *
   * This comment used to read "True when the field resolves to a value", which the code has
   * never done, and `requiredUnmapped` was computed from `!mapped` on the strength of it.
   * Ask `resolution` about values.
   */
  mapped: boolean;
  /** Where the value comes from (drives the source tag + tone). */
  kind: OutgoingSourceKind;
  /** A short human source label ("PO number", "= EUR", "auto"); null when none. */
  source: string | null;
  /** The resolved value preview (real data when known), mono in the row; null when unknown. */
  valuePreview: string | null;
  /** True when this output is required by the supplier (an unmapped required is loud amber). */
  required: boolean;
  /** True when the value comes from an implicit 1:1 default (canonical key === output path). */
  auto: boolean;
  /** Whether the rule behind `mapped` resolves to a value — the Send gate's real question. */
  resolution: OutgoingResolution;
}

/** Inputs the status computation needs — all already derived by useMapperModel. */
export interface OutgoingStatusInput {
  /** outputPath → canonicalField (an explicit canonical→output wire). */
  outputConnections: Partial<Record<string, string>>;
  /** canonicalField → sourceTokenId (an explicit source→canonical wire). */
  sourceConnections: Partial<Record<string, string>>;
  /** outputPath → fixed literal value. */
  fixedValues: Partial<Record<string, string>>;
  /** sourceTokenId → its raw value (from the order's SourceToken set). */
  tokenValueById: Map<string, string>;
  /** canonicalField → the order's parsed value (drives the auto 1:1 preview). */
  canonicalValueByKey: Map<string, string>;
  /** Human label for a canonical field key (for the "← PO number" tag). */
  labelForCanonical: (key: string) => string;
  /**
   * True when `tokenValueById` + `canonicalValueByKey` are AUTHORITATIVE for this scope — an
   * order's parsed values are loaded, so a key that is absent from them is genuinely absent
   * from the order.
   *
   * False on the connection editor with no sample order, where both maps are empty because
   * nobody looked. Required rather than optional on purpose: an omitted flag would silently
   * default to one of the two verdicts, which is the whole failure mode this field exists to
   * prevent. Callers pass `model.hasIncomingSource`.
   */
  valuesKnown: boolean;
}

/** True when an output path is required (loud when unmapped). */
export function isRequiredOutput(field: TargetField): boolean {
  return REQUIRED_CANONICAL.has(field.outputPath);
}

/**
 * Resolve the EFFECTIVE value of a canonical field: an explicit source wire's token value
 * first, then the order's parsed canonical value. Returns null when neither is known.
 */
function resolveCanonicalValue(
  canonicalField: string,
  input: OutgoingStatusInput,
): string | null {
  const tokenId = input.sourceConnections[canonicalField];
  if (tokenId) {
    const v = input.tokenValueById.get(tokenId);
    if (v != null && v !== "") return v;
  }
  const parsed = input.canonicalValueByKey.get(canonicalField);
  return parsed != null && parsed !== "" ? parsed : null;
}

/**
 * Classify a chased value. `null`/empty is only an accusation when we actually had the order's
 * values to chase it through; otherwise it is the third answer.
 */
function resolutionOf(value: string | null, valuesKnown: boolean): OutgoingResolution {
  if (value != null && value !== "") return "resolved";
  return valuesKnown ? "missing" : "unknown";
}

/**
 * Compute the honest status for ONE output field. Precedence:
 *   1. explicit fixed value  → kind "fixed", value = the literal.
 *   2. explicit canonical wire → kind "wired", value = the resolved canonical value.
 *   3. implicit 1:1 default (outputPath is itself a canonical spine key) → kind "auto".
 *   4. otherwise → unmapped (kind "none"); loud only if required.
 *
 * Branches 2 and 3 stay `mapped: true` with a null value — the column IS emitted, just empty —
 * and report that emptiness through `resolution`. Branch 4 is `"missing"` unconditionally: no
 * rule emits it, which is knowable without resolving a single value.
 */
export function computeOutgoingStatus(
  field: TargetField,
  input: OutgoingStatusInput,
): OutgoingFieldStatus {
  const required = isRequiredOutput(field);
  const path = field.outputPath;

  // 1. Fixed literal.
  const fixed = input.fixedValues[path];
  if (fixed != null && fixed !== "") {
    // A literal needs no lookup, so it is resolved even where nothing else could be judged.
    return { outputPath: path, mapped: true, kind: "fixed", source: `= ${fixed}`, valuePreview: fixed, required, auto: false, resolution: "resolved" };
  }

  // 2. Explicit canonical→output wire.
  const wiredCanonical = input.outputConnections[path];
  if (wiredCanonical) {
    const value = resolveCanonicalValue(wiredCanonical, input);
    return {
      outputPath: path,
      mapped: true,
      kind: "wired",
      source: `← ${input.labelForCanonical(wiredCanonical)}`,
      valuePreview: value,
      required,
      auto: false,
      resolution: resolutionOf(value, input.valuesKnown),
    };
  }

  // 3. Implicit 1:1 default — the output path is itself a canonical spine key, so the default
  //    transform carries the parsed value straight through. Honest "auto", muted (not red).
  if (CANONICAL_SPINE.has(path)) {
    const value = resolveCanonicalValue(path, input);
    return { outputPath: path, mapped: true, kind: "auto", source: "auto", valuePreview: value, required, auto: true, resolution: resolutionOf(value, input.valuesKnown) };
  }

  // 4. Genuinely unmapped — quiet unless required.
  return { outputPath: path, mapped: false, kind: "none", source: null, valuePreview: null, required, auto: false, resolution: "missing" };
}

/**
 * True when this output is REQUIRED and we KNOW nothing reaches the supplier through it — the one
 * predicate behind every "needs a source" marker, count and split.
 *
 * `resolution === "missing"`, never `!mapped`. `mapped` answers "does a rule emit this column",
 * and every required canonical name is a CANONICAL_SPINE member that branch 3 claims with
 * `mapped: true`, so `required && !mapped` is structurally false — it cannot fire, and three
 * separate call sites hand-wrote it anyway. It lives here, beside the tri-state it reads, so the
 * header count, the row marker and the workbench split can never disagree about which fields are
 * blocking.
 *
 * `"unknown"` is deliberately NOT included: a required field whose order was never loaded has no
 * verdict to give, and calling it missing would accuse the connection editor of four absent
 * sources it never looked for.
 */
export function needsSourceStatus(status: OutgoingFieldStatus): boolean {
  return status.required && status.resolution === "missing";
}

/**
 * True when a row still needs a human — the attention-first output split's predicate.
 *
 * Two genuinely different reasons, not one written twice:
 *   • `!mapped` — no rule emits this column at all (branch 4). Applies to optional outputs too;
 *     an unmapped column is unmapped whether or not the supplier demands it.
 *   • `needsSourceStatus` — a rule DOES emit it, but we know it carries nothing.
 *
 * The call site read `!mapped || (required && !mapped)`, whose second term is subsumed by the
 * first, so the split saw only the first reason and filed every empty-but-emitted required field
 * under "already mapped". A required field with `resolution: "unknown"` stays out of attention.
 */
export function needsAttentionStatus(status: OutgoingFieldStatus): boolean {
  return !status.mapped || needsSourceStatus(status);
}

/** A small header summary chip: "N of M mapped". */
export interface OutgoingSummary {
  mappedCount: number;
  total: number;
  /**
   * Count of REQUIRED outputs we KNOW will carry nothing — the "needs a source" badge feed and
   * the Send gate's term.
   *
   * This was `required && !mapped`, and `mapped` is true for every required field by
   * construction (REQUIRED_CANONICAL ⊂ CANONICAL_SPINE, so branch 3 claims them all), so the
   * count could not leave 0 and every warning that read it was unreachable.
   */
  requiredUnmapped: number;
  /**
   * Count of REQUIRED outputs we could not evaluate, because the order's values were never
   * loaded. Kept as its own number rather than folded into either verdict: adding it to
   * `requiredUnmapped` would accuse the connection editor of four missing sources it never
   * looked for, and dropping it would let "we don't know" render as a clean bill of health.
   */
  requiredUnknown: number;
}

/** Compute the whole-pane status list + the header summary in one pass. */
export function computeOutgoingStatuses(
  fields: TargetField[],
  input: OutgoingStatusInput,
): { statuses: OutgoingFieldStatus[]; summary: OutgoingSummary } {
  const statuses = fields.map((f) => computeOutgoingStatus(f, input));
  const mappedCount = statuses.filter((s) => s.mapped).length;
  const requiredUnmapped = statuses.filter(needsSourceStatus).length;
  const requiredUnknown = statuses.filter((s) => s.required && s.resolution === "unknown").length;
  return { statuses, summary: { mappedCount, total: statuses.length, requiredUnmapped, requiredUnknown } };
}
