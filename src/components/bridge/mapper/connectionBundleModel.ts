// Pure parse/merge helpers for the CONNECTION (author-once) variant of the mapper. A
// connection draft stores its mapping across TWO bundle JSON fields:
//   • inputMappingJson  — the source→canonical map (our OrderMappingOverride.sourceMap),
//   • outputMappingJson — the canonical→target config (our OrderMappingOverride.output).
// The mapper reads both as ONE internal override (so the wire engine is variant-agnostic)
// and writes both back. These helpers are pure (no React/network) so they are unit-testable
// in jsdom and shared by useMapperModel.
//
// DATA-LOSS NOTE: the bundle PUT replaces the WHOLE revision bundle, so the SAVE side (in
// useMapperModel) must additionally carry every OTHER bundle field through unchanged. These
// helpers only own the two MAPPING sides.

import type { OrderMappingOverride } from "@/lib/api/types";

/** Parse a connection draft's outputMappingJson into the OUTPUT side of an override. */
export function outputConfigFromJson(outputMappingJson: string | null | undefined): OrderMappingOverride["output"] {
  if (!outputMappingJson) return null;
  try {
    const parsed = JSON.parse(outputMappingJson);
    // Accept a bare OutputMappingConfig ({header,lines}) or a wrapped { output }.
    if (parsed && (parsed.header || parsed.lines)) {
      return { header: parsed.header ?? {}, lines: parsed.lines ?? {} };
    }
    if (parsed && typeof parsed === "object" && parsed.output) {
      return { header: parsed.output.header ?? {}, lines: parsed.output.lines ?? {} };
    }
  } catch {
    // Malformed JSON → no output side (the editor re-authors it) rather than crash.
  }
  return null;
}

/** Parse a connection draft's inputMappingJson into the sourceMap (source→canonical) side. */
export function sourceMapFromJson(inputMappingJson: string | null | undefined): OrderMappingOverride["sourceMap"] {
  if (!inputMappingJson) return null;
  try {
    const parsed = JSON.parse(inputMappingJson);
    // We write { sourceMap }; also tolerate a bare sourceMap object.
    if (parsed && typeof parsed === "object") {
      if (parsed.sourceMap && typeof parsed.sourceMap === "object") return parsed.sourceMap;
      // Heuristic: a bare map of canonicalField → { sourceToken } also counts.
      const looksLikeSourceMap = Object.values(parsed).every(
        (v) => v && typeof v === "object" && ("sourceToken" in (v as object) || "manipulators" in (v as object) || "fixedValue" in (v as object)),
      );
      if (looksLikeSourceMap && Object.keys(parsed).length > 0) return parsed;
    }
  } catch {
    // Malformed JSON → no source side.
  }
  return null;
}

/**
 * Merge a connection draft's two bundle JSON sides (inputMappingJson source→canonical +
 * outputMappingJson canonical→target) into the ONE internal override the wire engine reads.
 */
export function overrideFromConnectionBundle(
  inputMappingJson: string | null | undefined,
  outputMappingJson: string | null | undefined,
): OrderMappingOverride {
  return {
    customFields: [],
    output: outputConfigFromJson(outputMappingJson),
    sourceMap: sourceMapFromJson(inputMappingJson),
  };
}

/** Serialize an override's sourceMap side for the draft's inputMappingJson (null when empty). */
export function inputMappingJsonFromOverride(o: OrderMappingOverride): string | null {
  return o.sourceMap ? JSON.stringify({ sourceMap: o.sourceMap }) : null;
}

/** Serialize an override's output side for the draft's outputMappingJson (null when empty). */
export function outputMappingJsonFromOverride(o: OrderMappingOverride): string | null {
  return o.output ? JSON.stringify(o.output) : null;
}
