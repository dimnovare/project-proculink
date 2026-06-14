// Pure, bank-aware drag routing for MapperWireLayer. Extracted so the dispatch wiring
// (which BANK a drag started in → which set of zones it snaps to → which onConnect it
// fires) is unit-testable in jsdom, where the pixel-measure loop is not (no layout).
//
// The unified engine draws BOTH sides:
//   • a drag from the SOURCE bank (a source-token chip) snaps to a CANONICAL zone   → onSourceConnect(tokenId, canonicalField)
//   • a drag from the CANONICAL bank (a node handle) snaps to a TARGET zone         → onTargetConnect(canonicalField, outputPath)
// A drag can NEVER cross into its own bank (no source→source / canonical→canonical),
// which is enforced here by only ever scanning the OTHER bank's zones.

import { nearestZone, type Pt } from "./wireMath";

/** Which lane a drag originated in. */
export type WireBank = "source" | "canonical";

export interface DragPoint {
  x: number;
  y: number;
  /** The id of the dragged handle (token id for source bank, canonical key for canonical bank). */
  sourceId?: string;
}

export interface ConnectResolution {
  /** "source" = a source→canonical wire; "target" = a canonical→target wire. */
  kind: "source" | "target";
  /** The dragged handle's id (token id or canonical key), passed straight through. */
  from: string | undefined;
  /** The snapped destination zone id (canonical field key or output path). */
  to: string;
}

/**
 * Resolve the drop a drag would make. A `source`-bank drag only considers `canonicalZones`;
 * a `canonical`-bank drag only considers `targetZones`. Returns null when no zone in the
 * relevant bank is within `snapPx`. Pure — reuses `nearestZone` from wireMath.
 */
export function pickConnectTarget(
  bank: WireBank,
  drag: DragPoint,
  canonicalZones: Pt[],
  targetZones: Pt[],
  snapPx: number,
): ConnectResolution | null {
  if (bank === "source") {
    const to = nearestZone(canonicalZones, drag.x, drag.y, snapPx);
    return to ? { kind: "source", from: drag.sourceId, to } : null;
  }
  // canonical bank → target zones only
  const to = nearestZone(targetZones, drag.x, drag.y, snapPx);
  return to ? { kind: "target", from: drag.sourceId, to } : null;
}
