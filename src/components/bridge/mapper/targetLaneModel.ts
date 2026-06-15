// Pure helpers for the TargetLane (right pane — the arbitrary OUTPUT schema). No React.
//
// The target field list is fundamentally a PROP (the declared output schema differs per
// supplier/connection). But the inbox order path doesn't carry a separate schema — its
// targets are the field PATHS already present in the order's OrderMappingOverride.output
// (header + lines), which default to the canonical spine when no override exists. This
// helper derives that prop from an OutputMappingConfig so the inbox host can feed the same
// prop-driven lane the connection editor feeds from its declared schema.

import { CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS } from "@/lib/api/types";
import type { OutputMappingConfig } from "@/lib/api/types";
import { getFieldStandards } from "@/lib/standards/catalog";
import type { TargetField } from "./types";

/**
 * Derive the TargetField[] for the order path from the order's output config. Each declared
 * output path (header first, then line) becomes a target row. When `output` is null/empty
 * (no override → byte-identical transform), the targets default to the canonical spine
 * field names so the lane is never blank on a fresh order.
 *
 * Order is preserved as authored; duplicates (same path in both scopes) are de-duped,
 * first-scope-wins, so a wire/drop-zone id is unique.
 */
export function deriveTargetFields(
  output: OutputMappingConfig | null | undefined,
  mergeCanonical = false,
): TargetField[] {
  // ORDER path (mergeCanonical=true): the canonical spine is ALWAYS shown and authored paths
  // (a wired field, a fixed value, an added custom column like "Identity") are LAYERED on top —
  // so wiring or adding ONE field never collapses the OUTGOING DOCUMENT. The previous
  // "authored keys REPLACE the spine" logic made the whole document vanish the instant a single
  // wire/field was added (the "outgoing document disappears" regression).
  // CONNECTION path (mergeCanonical=false): the supplier's DECLARED output schema IS the output
  // (replace), so a connection that declares exactly {OrderRef, ItemCode, Qty} gets exactly
  // those columns; falls back to the canonical spine only when nothing is declared.
  let headerPaths: string[];
  let linePaths: string[];
  if (mergeCanonical) {
    headerPaths = mergeCanonicalPaths(CANONICAL_HEADER_FIELDS, output?.header);
    linePaths = mergeCanonicalPaths(CANONICAL_LINE_FIELDS, output?.lines);
  } else {
    const headerKeys = output?.header ? Object.keys(output.header) : [];
    const lineKeys = output?.lines ? Object.keys(output.lines) : [];
    headerPaths = headerKeys.length > 0 ? headerKeys : [...CANONICAL_HEADER_FIELDS];
    linePaths = lineKeys.length > 0 ? lineKeys : [...CANONICAL_LINE_FIELDS];
  }

  const seen = new Set<string>();
  const out: TargetField[] = [];
  for (const path of headerPaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(toTargetField(path, "header"));
  }
  for (const path of linePaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(toTargetField(path, "line"));
  }
  return out;
}

/**
 * Canonical spine first (always shown), then any EXTRA authored output paths the user added
 * that aren't canonical fields. De-dupes so a canonical field that's been wired/fixed appears
 * once, in its canonical position — never collapsing the lane.
 */
function mergeCanonicalPaths(
  canonical: readonly string[],
  authored: Record<string, unknown> | null | undefined,
): string[] {
  const out: string[] = [...canonical];
  const known = new Set<string>(canonical);
  if (authored) {
    for (const path of Object.keys(authored)) {
      if (!known.has(path)) {
        out.push(path);
        known.add(path);
      }
    }
  }
  return out;
}

function toTargetField(outputPath: string, scope: "header" | "line"): TargetField {
  return {
    outputPath,
    // Use the canonical catalog label when the output path matches a canonical key,
    // otherwise the raw path is its own label (arbitrary supplier-specific column).
    label: getFieldStandards(outputPath)?.label ?? outputPath,
    scope,
  };
}

/** True when an output path maps a real source (vs. an unmapped/blank target). */
export function isTargetWired(
  outputPath: string,
  outputConnections: Partial<Record<string, string>> | undefined,
): boolean {
  return Boolean(outputConnections?.[outputPath]);
}

/**
 * Whether the output-path RENAME affordance should render. It requires BOTH:
 *   • the lane being editable (connection variant + not a published/read-only revision), and
 *   • a real onRenamePath handler wired by the host.
 * The second clause matters: ThreePaneMapper mounts TargetLane WITHOUT onRenamePath, so an
 * `editable`-only gate would show a rename button that accepts input then silently reverts on
 * Enter (onRenamePath?.() is a no-op). Never render a control that does nothing.
 */
export function isRenameAffordanceShown(
  editable: boolean,
  onRenamePath: ((oldPath: string, newPath: string) => void) | undefined,
): boolean {
  return editable && typeof onRenamePath === "function";
}
