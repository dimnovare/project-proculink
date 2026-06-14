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
export function deriveTargetFields(output: OutputMappingConfig | null | undefined): TargetField[] {
  const headerPaths = output?.header ? Object.keys(output.header) : [...CANONICAL_HEADER_FIELDS];
  const linePaths = output?.lines ? Object.keys(output.lines) : [...CANONICAL_LINE_FIELDS];

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
