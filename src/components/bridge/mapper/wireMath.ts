// One source of truth for the mapper's wire geometry + routing. Lifted verbatim from
// WireDragLayer.tsx (bezier:99-105, resolveWireSource:54-60, nearestZone:215-219) and
// SourceWireDragLayer.tsx (resolveSourceWires:69-89), generalized so the node↔canonical
// map is a PARAMETER instead of a module constant — that is the whole unify trick.
//
// These are pure functions (no React, no DOM). They are behavior-preserving extractions:
// the existing WireDragLayer / SourceWireDragLayer re-export wrappers feed their old
// module-constant maps, so the shipped components keep identical behavior + tests green.

export interface Pt { id: string; x: number; y: number; }

/**
 * Cubic-bezier path string for a wire from (x1,y1) to (x2,y2). The horizontal
 * control-point offset is clamped to [24, 80] of |dx|*0.5 → a tidy S-curve with no
 * giant bulge over large vertical spans. Verbatim from WireDragLayer.bezier /
 * SourceWireDragLayer.bezier.
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  // Handoff §8: dx = max(34, |x2-x1| * 0.42).
  const off = Math.sign(dx || 1) * Math.max(34, Math.abs(dx) * 0.42);
  return `M ${x1} ${y1} C ${x1 + off} ${y1} ${x2 - off} ${y2} ${x2} ${y2}`;
}

/**
 * Resolve the canonical SOURCE node that currently feeds an output line. Default is
 * identity (output line ← its own node); a per-order override canonicalField re-points
 * it. The node↔canonical map is now a PARAMETER (was the WireDragLayer module constant)
 * so the same logic serves the unified mapper, whose nodes ARE canonical keys.
 *
 * Behavior is identical to the original: an unknown canonical falls back to lineId and
 * is NOT flagged as an override; a canonical equal to the line's default source is not
 * an override either.
 */
export function resolveWireSource(
  lineId: string,
  overrideField: string | undefined | null,
  nodeToCanonical: Record<string, string>,
): { sourceNode: string; isOverride: boolean } {
  const canonicalToNode = Object.fromEntries(Object.entries(nodeToCanonical).map(([n, c]) => [c, n]));
  const sourceNode = overrideField ? (canonicalToNode[overrideField] ?? lineId) : lineId;
  return { sourceNode, isOverride: overrideField != null && sourceNode !== lineId };
}

/**
 * Build the persistent source→canonical wires from the current SourceMap. For each
 * node id (a canonical field key in the unified mapper), look up its SourceMap rule;
 * if the rule's `sourceToken` is still present in the file, draw a wire. A stale token
 * (file re-parsed to a different shape) draws no wire rather than a dangling one.
 *
 * Lifted from SourceWireDragLayer.resolveSourceWires, generalized: the original mapped
 * node ids → canonical field names via a module constant before the lookup; here the
 * node ids ARE the canonical field keys (the unify shape), so `canonicalField === nodeId`.
 * The shipped SourceWireDragLayer keeps its node→canonical mapping in its own wrapper.
 */
export function resolveSourceWires(
  nodeIds: string[],
  sourceMap: Record<string, { sourceToken?: string | null } | undefined> | null | undefined,
  knownTokenIds: ReadonlySet<string>,
): { nodeId: string; canonicalField: string; tokenId: string }[] {
  if (!sourceMap) return [];
  const out: { nodeId: string; canonicalField: string; tokenId: string }[] = [];
  for (const nodeId of nodeIds) {
    const rule = sourceMap[nodeId];
    const tokenId = rule?.sourceToken ?? null;
    if (tokenId && knownTokenIds.has(tokenId)) out.push({ nodeId, canonicalField: nodeId, tokenId });
  }
  return out;
}

/**
 * Return the id of the nearest drop zone within `snapPx` of (x,y), else null. Pure
 * version of the `nearestZone` closures in WireDragLayer:215-219 / SourceWireDragLayer
 * (SNAP_PX is now a parameter). Euclidean distance; ties resolve to the first scanned.
 */
export function nearestZone(zones: Pt[], x: number, y: number, snapPx: number): string | null {
  let best: string | null = null;
  let bestD = snapPx;
  for (const z of zones) {
    const d = Math.hypot(z.x - x, z.y - y);
    if (d < bestD) { bestD = d; best = z.id; }
  }
  return best;
}

/** A resolved 2-bank wire (incoming id → output path) with its canonical metadata. */
export interface ResolvedMapperWire {
  sourceId: string;
  outputPath: string;
  canonicalField: string;
  isOverride: boolean;
}

/**
 * Resolve the persistent INCOMING→OUTPUT wires for the rebuilt 2-column mapper. Pure so the
 * engine's wire set is unit-testable without mounting React. Precedence per output path:
 *   1. explicit user wire   — outputConnections[path] names the incoming canonical id; an
 *      override iff that id differs from the path itself.
 *   2. implicit 1:1 default — the output path equals a canonical key AND an incoming row of
 *      that id exists (knownSourceIds) → a faint default wire (never an override).
 * A raw-token fixed value carries no incoming anchor, so it produces no wire here (the row
 * shows a fixed badge instead). Output order is preserved.
 */
export function resolveMapperWires(
  outputPaths: string[],
  outputConnections: Partial<Record<string, string>>,
  knownSourceIds: ReadonlySet<string>,
): ResolvedMapperWire[] {
  const out: ResolvedMapperWire[] = [];
  for (const path of outputPaths) {
    const explicit = outputConnections[path];
    if (explicit) {
      out.push({ sourceId: explicit, outputPath: path, canonicalField: explicit, isOverride: explicit !== path });
      continue;
    }
    if (knownSourceIds.has(path)) {
      out.push({ sourceId: path, outputPath: path, canonicalField: path, isOverride: false });
    }
  }
  return out;
}
