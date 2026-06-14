// Pure render helpers for MapperWireLayer's VISUAL pass (the interaction/polish layer).
// No React, no DOM — TDD'd in jsdom. These answer three questions the SVG renderer asks
// every render, but which are pure given the wire endpoints + the hovered id:
//
//   1. wireDrawDelayMs(i)        — the staggered draw-in delay for the i-th wire so the
//      wires "draw in" top-to-bottom on first mount instead of all snapping at once.
//   2. estimatePathLength(...)   — an estimate of a bezier wire's length, used to seed the
//      CSS stroke-dasharray/offset so the draw-in covers the whole wire regardless of span.
//   3. isWireEmphasised(...)     — given the hovered id (which may be a SOURCE TOKEN id, a
//      CANONICAL field key, or an OUTPUT path), decide whether a given wire is the one the
//      user is pointing at. The founder's complaint: hovering an INCOMING row (a token id)
//      must highlight ITS wire — but a source→canonical wire is keyed by canonical field, so
//      a naive `canonicalField === hoveredId` check misses the token-id case. This resolves
//      the token id → its canonical field via the wire's own tokenId, closing that gap.

/** A source→canonical wire, reduced to the only fields the emphasis check needs. */
export interface SourceWireLite {
  canonicalField: string;
  tokenId: string;
}

/** A canonical→target wire, reduced to the only fields the emphasis check needs. */
export interface TargetWireLite {
  canonicalField: string;
  outputPath: string;
}

/**
 * Staggered draw-in delay for the i-th persistent wire (ms). A gentle ramp capped so a
 * busy mapping doesn't take forever to settle: 38ms/wire, clamped to 320ms total.
 */
export function wireDrawDelayMs(index: number, step = 38, cap = 320): number {
  if (index <= 0) return 0;
  return Math.min(index * step, cap);
}

/**
 * Estimate the on-screen length of the wire's bezier so the draw-in dash covers it fully.
 * The bezier (wireMath.bezier) is a gentle S-curve; the chord length plus a small curve
 * factor is a good-enough seed for stroke-dasharray (it only needs to be >= the true length,
 * a slight over-estimate just starts the wire fully hidden — which is what we want).
 */
export function estimatePathLength(hx: number, hy: number, zx: number, zy: number): number {
  const chord = Math.hypot(zx - hx, zy - hy);
  // The horizontal control offset bulges the curve; +18% covers it with margin.
  return Math.ceil(chord * 1.18) + 16;
}

/**
 * Is this source→canonical wire the one the user is pointing at? True when the hovered id is
 * the wire's canonical field OR the wire's source token id (hovering the incoming row). Null
 * hovered id → nothing emphasised (caller treats that as "no hover, full opacity").
 */
export function isSourceWireEmphasised(wire: SourceWireLite, hoveredId: string | null): boolean {
  if (!hoveredId) return false;
  return wire.canonicalField === hoveredId || wire.tokenId === hoveredId;
}

/**
 * Is this canonical→target wire the one the user is pointing at? True when the hovered id is
 * the wire's canonical field OR its output path (hovering either the spine node or the output
 * row both light the same wire).
 */
export function isTargetWireEmphasised(wire: TargetWireLite, hoveredId: string | null): boolean {
  if (!hoveredId) return false;
  return wire.canonicalField === hoveredId || wire.outputPath === hoveredId;
}

/**
 * Opacity for a wire given the global hover/drag state. The de-clutter rule: when the user
 * hovers any field, the pointed-at wire is full strength and every other wire dims hard so a
 * single wire reads cleanly out of a dense bundle; during a drag everything dims uniformly so
 * the live drag ghost is the only bright line. No hover, no drag → full strength.
 */
export function wireOpacity(opts: {
  dragging: boolean;
  hovering: boolean;
  emphasised: boolean;
  dimmedOpacity?: number;
  hoverDimOpacity?: number;
}): number {
  const { dragging, hovering, emphasised, dimmedOpacity = 0.45, hoverDimOpacity = 0.12 } = opts;
  if (dragging) return dimmedOpacity;
  if (hovering) return emphasised ? 1 : hoverDimOpacity;
  return 1;
}
