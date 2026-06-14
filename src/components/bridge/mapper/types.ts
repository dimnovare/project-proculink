// Phase-3-only VIEW types for the unified three-pane mapper. Kept OUT of the shared
// `@/lib/api/types.ts` so the lane/shell components churn here without re-touching the
// parallel-safety hazard file. These wrap the Phase-2 engine contracts (re-exported
// below) with discovery/render state.

import type {
  MappingSuggestion,
  FieldValidationState,
  CatalogPriceHint,
  CanonicalFieldScope,
} from "@/lib/api/types";

/**
 * A source field as shown in the SourceUniverse pane. Wraps a SourceToken with
 * discovery state (group, mapped/suggested flags). Raw-bag tokens (Phase-1
 * SourceCapture) carry group="raw" and are collapsed by default.
 */
export interface SourceField {
  id: string;
  label: string;
  value: string;
  group: "header" | "parties" | "line" | "raw";
  /** True when this token is already wired to a canonical/target field. */
  mapped: boolean;
  /** Present when AI proposed this token for some target/canonical key. */
  suggestedFor?: string | null;
  suggestionConfidence?: number | null;
}

/** The five filter chips above the source list. */
export type FieldFilter = "all" | "unmapped" | "mapped" | "ai" | "hasValue";

/** A canonical spine node — id IS the canonical field key. */
export interface CanonicalNode {
  /** id === canonical field key (PoNumber, …, or a Tier-2 custom key). */
  id: string;
  label: string;
  scope: CanonicalFieldScope;
  system: boolean;
  standardsRef?: string | null;
}

/** A target/output field row (right lane). */
export interface TargetField {
  /** Output path in the delivered doc (e.g. "ItemCode"). */
  outputPath: string;
  label: string;
  scope: CanonicalFieldScope;
}

export type { MappingSuggestion, FieldValidationState, CatalogPriceHint };
