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

import { BINDABLE_HEADER_FIELDS, BINDABLE_LINE_FIELDS } from "@/lib/api/types";
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
 * The full canonical spine (header + line) — used to decide whether a 1:1 default exists.
 *
 * WP-14: the BINDABLE set, not the narrow default spine. An output column named "ShipToCity" now
 * genuinely does resolve 1:1 from the backend row bag, so reporting it as unmapped would be a lie
 * in the honest direction that still misleads: the operator would go looking for a wire that is
 * not needed.
 */
const CANONICAL_SPINE = new Set<string>([...BINDABLE_HEADER_FIELDS, ...BINDABLE_LINE_FIELDS]);

/** How an output field gets its value, for the small source tag. */
export type OutgoingSourceKind = "wired" | "fixed" | "auto" | "none";

/** The honest, per-output status the OutgoingPane row renders. */
export interface OutgoingFieldStatus {
  outputPath: string;
  /** True when the field resolves to a value (wired, fixed, OR a 1:1 auto default). */
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
 * Compute the honest status for ONE output field. Precedence:
 *   1. explicit fixed value  → kind "fixed", value = the literal.
 *   2. explicit canonical wire → kind "wired", value = the resolved canonical value.
 *   3. implicit 1:1 default (outputPath is itself a canonical spine key) → kind "auto".
 *   4. otherwise → unmapped (kind "none"); loud only if required.
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
    return { outputPath: path, mapped: true, kind: "fixed", source: `= ${fixed}`, valuePreview: fixed, required, auto: false };
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
    };
  }

  // 3. Implicit 1:1 default — the output path is itself a canonical spine key, so the default
  //    transform carries the parsed value straight through. Honest "auto", muted (not red).
  if (CANONICAL_SPINE.has(path)) {
    const value = resolveCanonicalValue(path, input);
    return { outputPath: path, mapped: true, kind: "auto", source: "auto", valuePreview: value, required, auto: true };
  }

  // 4. Genuinely unmapped — quiet unless required.
  return { outputPath: path, mapped: false, kind: "none", source: null, valuePreview: null, required, auto: false };
}

/** A small header summary chip: "N of M mapped". */
export interface OutgoingSummary {
  mappedCount: number;
  total: number;
  /** Count of REQUIRED outputs still unmapped — the "needs a source" badge feed. */
  requiredUnmapped: number;
}

/** Compute the whole-pane status list + the header summary in one pass. */
export function computeOutgoingStatuses(
  fields: TargetField[],
  input: OutgoingStatusInput,
): { statuses: OutgoingFieldStatus[]; summary: OutgoingSummary } {
  const statuses = fields.map((f) => computeOutgoingStatus(f, input));
  const mappedCount = statuses.filter((s) => s.mapped).length;
  const requiredUnmapped = statuses.filter((s) => s.required && !s.mapped).length;
  return { statuses, summary: { mappedCount, total: statuses.length, requiredUnmapped } };
}
