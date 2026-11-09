"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { Box } from "@/lib/api/documents";
import { SourceHighlight } from "./SourceHighlight";

type Pt = { x: number; y: number };
const MIN = 0.005;
const DRAG_PX = 8;

/** Corner to corner, any direction; sums stay <= 1 because the backend compares them exactly. */
function boxOf(a: Pt, b: Pt): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.min(Math.abs(a.x - b.x), 1 - x);
  const height = Math.min(Math.abs(a.y - b.y), 1 - y);
  return { x, y, width, height };
}

/** Draw a box on the page: drag, or click two corners. Place inside the `relative` page wrapper. */
export function RegionPicker({ page, onBox }: { page: number; onBox(box: Box): void }) {
  const anchor = useRef<Pt | null>(null);
  const down = useRef<Pt>({ x: 0, y: 0 }); // client px, to tell a click from a drag
  const [corner, setCorner] = useState<Pt | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);

  const pt = (e: PointerEvent<HTMLDivElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    return { x: clamp(e.clientX - r.left, r.width) / r.width, y: clamp(e.clientY - r.top, r.height) / r.height };
  };
  const finish = (b: Box) => {
    if (b.width < MIN || b.height < MIN) return false;
    onBox(b);
    return true;
  };

  return (
    <div
      role="group"
      aria-label={`Draw a box on page ${page}`}
      className="absolute inset-0 cursor-crosshair touch-manipulation"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        anchor.current = pt(e);
        down.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerCancel={() => {
        anchor.current = null;
        setDraft(null);
      }}
      onPointerMove={(e) => anchor.current && setDraft(boxOf(anchor.current, pt(e)))}
      onPointerUp={(e) => {
        const a = anchor.current;
        anchor.current = null;
        setDraft(null);
        if (!a) return;
        const p = pt(e);
        if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) >= DRAG_PX && finish(boxOf(a, p))) return setCorner(null);
        // Too short to be a drag: a click. The first marks a corner, the second completes the box.
        if (corner && finish(boxOf(corner, p))) return setCorner(null);
        setCorner(p);
      }}
    >
      {draft && <SourceHighlight box={draft} />}
      {corner && !draft && <SourceHighlight box={boxOf(corner, { x: Math.min(corner.x + 0.01, 1), y: Math.min(corner.y + 0.01, 1) })} />}
    </div>
  );
}
