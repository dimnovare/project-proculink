"use client";

// WireDragLayer — interactive canonical→output wire routing, desktop xl only.
//
// DESIGN CONTRACT:
//  • The decorative SpineConnectors SVG (aria-hidden, pointerEvents:none) is
//    unchanged — it stays the visual wires layer.
//  • THIS component is a SEPARATE interactive SVG layered above, with
//    pointerEvents:auto ONLY on the small drag handles / drop zones. The SVG
//    itself is aria-hidden; a11y is provided via a live-region announcement
//    and the keyboard "connect mode" (Enter → arrow → Enter).
//  • On a successful connect: calls onConnect(nodeId, outputLineId) which
//    calls upsertMappingOverride and triggers a re-measure via signatureToken.
//  • Mobile/tablet: never mounted (caller gates on xl).
//
// NO external drag library — native pointer events only (pointerdown/move/up).

import type React from "react";
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from "react";
import type { ConnectorNode } from "./SpineConnectors";

// The set of output line ids that are valid drop targets (keyed by node id).
// For the current scope: every canonical node can be routed to any output line.
export const OUTPUT_LINE_IDS = ["po", "date", "supplier", "buyer", "currency", "totals", "lines"] as const;
export type OutputLineId = typeof OUTPUT_LINE_IDS[number];

// Canonical field names that map to each node id (drives OutputFieldRule.canonicalField).
const NODE_TO_CANONICAL: Record<string, string> = {
  po:       "PoNumber",
  date:     "OrderDate",
  buyer:    "BuyerName",
  supplier: "SupplierName",
  currency: "Currency",
  lines:    "LineNumber",
  totals:   "LineTotal",
};

interface WireDragLayerProps {
  gridRef: React.RefObject<HTMLElement | null>;
  nodeEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  outLineEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  nodes: ConnectorNode[];
  /** Called when the user connects a canonical node to an output line. */
  onConnect: (nodeId: string, outputLineId: string) => void;
  /** Read-only current overrides (so we can pre-highlight existing manual wires). */
  existingConnections: Partial<Record<string, string>>; // outputLineId → nodeId
  /** Changing this causes a re-measure, mirroring SpineConnectors. */
  signature: string;
}

interface HandlePos {
  id: string;      // node id
  x: number;
  y: number;
  label: string;
}

interface DropZonePos {
  id: string;      // output line id
  x: number;
  y: number;
  label: string;
}

interface DragState {
  sourceId: string;
  currentX: number;
  currentY: number;
  startX: number;
  startY: number;
}

// ─── geometry helpers ────────────────────────────────────────────────────────

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = x1 + (x2 - x1) * 0.52;
  return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
}

// Small dot handle radius
const HANDLE_R = 6;
// Drop zone hit-target (invisible rect)
const ZONE_W = 18;
const ZONE_H = 14;
// Snap distance: if pointer is within this px of a drop zone centre, snap
const SNAP_PX = 32;

export function WireDragLayer({
  gridRef,
  nodeEls,
  outLineEls,
  nodes,
  onConnect,
  existingConnections,
  signature,
}: WireDragLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [handles, setHandles]     = useState<HandlePos[]>([]);
  const [dropZones, setDropZones] = useState<DropZonePos[]>([]);
  const [drag, setDrag]           = useState<DragState | null>(null);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  // keyboard connect mode
  const [kbSource, setKbSource]   = useState<string | null>(null);
  const [kbTarget, setKbTarget]   = useState<number>(0); // index into OUTPUT_LINE_IDS
  const [shown, setShown]         = useState(false);
  const announcerRef = useRef<HTMLDivElement>(null);

  // ── measure ──────────────────────────────────────────────────────────────────
  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const g = grid.getBoundingClientRect();
    if (g.width < 60) { setHandles([]); setDropZones([]); return; }

    const nextHandles: HandlePos[] = [];
    nodes.forEach((node) => {
      const el = nodeEls.current[node.id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      nextHandles.push({
        id: node.id,
        x: r.right - g.left,
        y: r.top - g.top + 18, // match the wire attach-y in SpineConnectors
        label: node.id,
      });
    });

    const nextZones: DropZonePos[] = [];
    OUTPUT_LINE_IDS.forEach((lid) => {
      const el = outLineEls.current[lid];
      if (!el) return;
      const r = el.getBoundingClientRect();
      nextZones.push({
        id: lid,
        x: r.left - g.left,
        y: r.top - g.top + r.height / 2,
        label: lid,
      });
    });

    setHandles(nextHandles);
    setDropZones(nextZones);
  }, [gridRef, nodeEls, outLineEls, nodes]);

  const rafRef = useRef<number | null>(null);
  const scheduleMeasure = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(measure);
    });
  }, [measure]);

  useLayoutEffect(() => { measure(); }, [measure, signature]);

  useEffect(() => {
    measure();
    const t = setTimeout(() => { measure(); setShown(true); }, 80);
    const ro = new ResizeObserver(scheduleMeasure);
    const seen = new Set<Element>();
    const obs = (el: Element | null | undefined) => { if (el && !seen.has(el)) { seen.add(el); ro.observe(el); } };
    obs(gridRef.current);
    Object.values(nodeEls.current).forEach(obs);
    Object.values(outLineEls.current).forEach(obs);
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      clearTimeout(t);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [measure, scheduleMeasure, gridRef, nodeEls, outLineEls]);

  // ── pointer drag ─────────────────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    const grid = gridRef.current;
    const g = grid?.getBoundingClientRect();
    if (!g) return;
    const x = e.clientX - g.left;
    const y = e.clientY - g.top;
    setDrag({ sourceId: nodeId, currentX: x, currentY: y, startX: x, startY: y });
  }, [gridRef]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const grid = gridRef.current;
    const g = grid?.getBoundingClientRect();
    if (!g) return;
    setDrag(prev => prev ? { ...prev, currentX: e.clientX - g.left, currentY: e.clientY - g.top } : null);

    // highlight nearest drop zone
    const cx = e.clientX - g.left;
    const cy = e.clientY - g.top;
    let nearest: string | null = null;
    let nearestDist = SNAP_PX;
    dropZones.forEach((z) => {
      const d = Math.hypot(z.x - cx, z.y - cy);
      if (d < nearestDist) { nearestDist = d; nearest = z.id; }
    });
    setHoveredZone(nearest);
  }, [drag, gridRef, dropZones]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const grid = gridRef.current;
    const g = grid?.getBoundingClientRect();
    if (g) {
      const cx = e.clientX - g.left;
      const cy = e.clientY - g.top;
      let nearest: string | null = null;
      let nearestDist = SNAP_PX;
      dropZones.forEach((z) => {
        const d = Math.hypot(z.x - cx, z.y - cy);
        if (d < nearestDist) { nearestDist = d; nearest = z.id; }
      });
      if (nearest) {
        onConnect(drag.sourceId, nearest);
        announce(`Connected ${drag.sourceId} → ${nearest}`);
      }
    }
    setDrag(null);
    setHoveredZone(null);
  }, [drag, gridRef, dropZones, onConnect]);

  // ── keyboard connect mode ─────────────────────────────────────────────────────
  // Enter on a handle → select it as source (kbSource set, kbTarget defaults to 0)
  // ArrowDown/ArrowUp → cycle through OUTPUT_LINE_IDS
  // Enter when source is active → commit the connection
  // Escape → cancel

  const handleHandleKeyDown = useCallback((e: React.KeyboardEvent, nodeId: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (kbSource === nodeId) {
        // second Enter → commit
        const targetId = OUTPUT_LINE_IDS[kbTarget];
        if (targetId) {
          onConnect(nodeId, targetId);
          announce(`Connected ${nodeId} → ${targetId}`);
        }
        setKbSource(null);
      } else {
        setKbSource(nodeId);
        setKbTarget(0);
        announce(`Connect mode: ${nodeId}. Use arrow keys to select output field, Enter to confirm, Escape to cancel.`);
      }
    } else if (kbSource === nodeId && e.key === "ArrowDown") {
      e.preventDefault();
      setKbTarget((prev) => (prev + 1) % OUTPUT_LINE_IDS.length);
    } else if (kbSource === nodeId && e.key === "ArrowUp") {
      e.preventDefault();
      setKbTarget((prev) => (prev - 1 + OUTPUT_LINE_IDS.length) % OUTPUT_LINE_IDS.length);
    } else if (e.key === "Escape") {
      setKbSource(null);
    }
  }, [kbSource, kbTarget, onConnect]);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setKbSource(null);
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  function announce(msg: string) {
    if (announcerRef.current) {
      announcerRef.current.textContent = "";
      requestAnimationFrame(() => {
        if (announcerRef.current) announcerRef.current.textContent = msg;
      });
    }
  }

  // ── find the handle position for the current drag source ─────────────────────
  const dragHandle = drag ? handles.find(h => h.id === drag.sourceId) : null;
  // kb target drop zone
  const kbDropZone = kbSource ? dropZones.find(z => z.id === OUTPUT_LINE_IDS[kbTarget]) : null;

  // Existing manual connections: reverse-lookup nodeId from existingConnections
  // existingConnections is outputLineId → canonicalField (not nodeId), so we map back.
  // "connected" handles = those that appear as a value in existingConnections
  // "connected" zones   = those that appear as a key in existingConnections

  return (
    <>
      {/* Screen-reader announcer */}
      <div
        ref={announcerRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
      />

      {/* Interactive SVG overlay — ONLY handles + drop zones have pointerEvents:auto */}
      <svg
        ref={svgRef}
        aria-hidden
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: drag ? "auto" : "none", // capture move/up during drag
          zIndex: 3, // above SpineConnectors (zIndex:2)
          opacity: shown ? 1 : 0,
          transition: "opacity 320ms ease-out",
        }}
        onPointerMove={drag ? handlePointerMove : undefined}
        onPointerUp={drag ? handlePointerUp : undefined}
        onPointerCancel={() => { setDrag(null); setHoveredZone(null); }}
      >
        {/* ── Live drag wire (ghost) ────────────────────────────────────────── */}
        {drag && dragHandle && (
          <path
            d={bezierPath(dragHandle.x, dragHandle.y, drag.currentX, drag.currentY)}
            fill="none"
            stroke="#1E66C9"
            strokeWidth={2}
            strokeDasharray="5 3"
            style={{ pointerEvents: "none", opacity: 0.7 }}
          />
        )}

        {/* ── Keyboard preview wire ─────────────────────────────────────────── */}
        {kbSource && kbDropZone && (() => {
          const h = handles.find(hh => hh.id === kbSource);
          if (!h) return null;
          return (
            <path
              d={bezierPath(h.x, h.y, kbDropZone.x, kbDropZone.y)}
              fill="none"
              stroke="#1E66C9"
              strokeWidth={2}
              strokeDasharray="5 3"
              style={{ pointerEvents: "none", opacity: 0.55 }}
            />
          );
        })()}

        {/* ── Drop zone hit targets + highlight rings ───────────────────────── */}
        {dropZones.map((z) => {
          const isHovered = hoveredZone === z.id || (kbSource !== null && OUTPUT_LINE_IDS[kbTarget] === z.id);
          const isConnected = Object.entries(existingConnections).some(
            ([lineId]) => lineId === z.id,
          );
          return (
            <g key={`dz-${z.id}`} style={{ pointerEvents: "auto" }}>
              {/* Visual highlight ring when hovered or connected */}
              {(isHovered || isConnected) && (
                <circle
                  cx={z.x}
                  cy={z.y}
                  r={8}
                  fill={isHovered ? "rgba(30,102,201,0.18)" : "rgba(46,142,58,0.15)"}
                  stroke={isHovered ? "#1E66C9" : "#2E8E3A"}
                  strokeWidth={1.5}
                  style={{ pointerEvents: "none" }}
                />
              )}
              {/* Invisible hit area */}
              <rect
                x={z.x - ZONE_W / 2}
                y={z.y - ZONE_H / 2}
                width={ZONE_W}
                height={ZONE_H}
                fill="transparent"
                style={{ cursor: drag ? "crosshair" : "default" }}
              />
            </g>
          );
        })}

        {/* ── Drag handles on canonical node right edges ────────────────────── */}
        {handles.map((h) => {
          const isSource = drag?.sourceId === h.id || kbSource === h.id;
          const hasConnection = Object.values(existingConnections).some(
            (canonField) => canonField === NODE_TO_CANONICAL[h.id],
          );
          return (
            <g
              key={`dh-${h.id}`}
              tabIndex={0}
              role="button"
              aria-label={`Drag to connect ${h.id} to an output field${kbSource === h.id ? " — connect mode active, use arrow keys" : ""}`}
              style={{ pointerEvents: "auto", cursor: "grab", outline: "none" }}
              onPointerDown={(e) => handlePointerDown(e, h.id)}
              onKeyDown={(e) => handleHandleKeyDown(e, h.id)}
            >
              {/* Outer glow ring (hover / source indicator) */}
              <circle
                cx={h.x}
                cy={h.y}
                r={HANDLE_R + 4}
                fill={isSource ? "rgba(30,102,201,0.15)" : hasConnection ? "rgba(46,142,58,0.12)" : "transparent"}
                style={{ transition: "fill 150ms" }}
              />
              {/* Main handle dot */}
              <circle
                cx={h.x}
                cy={h.y}
                r={HANDLE_R}
                fill={isSource ? "#1E66C9" : hasConnection ? "#2E8E3A" : "#FFFFFF"}
                stroke={isSource ? "#1E66C9" : hasConnection ? "#2E8E3A" : "#8A93A5"}
                strokeWidth={1.8}
                style={{ transition: "fill 150ms, stroke 150ms" }}
              />
              {/* Drag arrow glyph */}
              <text
                x={h.x}
                y={h.y + 3.5}
                textAnchor="middle"
                fontSize={7}
                fontWeight={700}
                fill={isSource ? "#FFFFFF" : hasConnection ? "#FFFFFF" : "#8A93A5"}
                style={{ pointerEvents: "none", userSelect: "none", fontFamily: "monospace" }}
              >
                {isSource ? "↗" : "→"}
              </text>
              {/* Tooltip / label (shown as title) */}
              <title>Drag to wire {h.id} → output field</title>
            </g>
          );
        })}
      </svg>
    </>
  );
}
